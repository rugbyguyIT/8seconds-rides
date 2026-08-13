// ─────────────────────────────────────────────────────────────
// 8 Second Rides — driver-initiated vehicle assignment requests
//   POST /api/vehicle-requests               driver picks/changes their vehicle
//   GET  /api/vehicle-requests?status=        dispatch/admin: all (optionally
//                                              filtered); driver: their own only
//   POST /api/vehicle-requests/{id}/decide    dispatch/admin approve/deny
//   POST /api/vehicle-requests/{id}/cancel    driver cancels their own pending one
//
// A driver can set up their OWN vehicle's plate/photo/hang tag freely
// (see fleet.js) — but WHICH vehicle they're driving is a request that
// needs a dispatch/admin nod, made at the start of a show/shift or any
// time they want to switch. Approving performs the actual assignment
// (same clear-then-set as an admin's direct assign in fleet.js).
// ─────────────────────────────────────────────────────────────
const { app } = require('@azure/functions');
const { query } = require('../db');
const { json, err, requireAuth, requireRole, logAudit } = require('../middleware');
const { sendPushToProfile } = require('../push');

const SELECT = `
  SELECT r.*, d.full_name AS driver_name, d.photo_url AS driver_photo,
         v.label AS vehicle_label, v.photo_url AS vehicle_photo, v.class AS vehicle_class
  FROM public.vehicle_assignment_requests r
  JOIN public.profiles d ON d.id = r.driver_id
  JOIN public.vehicles v ON v.id = r.vehicle_id`;

app.http('vehicleRequestsCreate', {
  methods: ['POST'], authLevel: 'anonymous', route: 'vehicle-requests',
  handler: async (request) => {
    const { user, error, status } = await requireRole(request, 'driver');
    if (error) return err(error, status);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { vehicle_id } = body || {};
    if (!vehicle_id) return err('vehicle_id required');
    const v = await query(`SELECT id, label, active FROM public.vehicles WHERE id = $1`, [vehicle_id]);
    if (!v.rows.length) return err('Vehicle not found', 404);
    if (!v.rows[0].active) return err('That vehicle is retired', 400);

    // One live request per driver — update the existing pending one in
    // place (so changing your pick before dispatch decides doesn't pile
    // up rows) rather than erroring or creating a duplicate.
    const existing = await query(
      `SELECT id FROM public.vehicle_assignment_requests WHERE driver_id = $1 AND status = 'pending'`, [user.sub]);
    let reqId;
    if (existing.rows.length) {
      reqId = existing.rows[0].id;
      await query(`UPDATE public.vehicle_assignment_requests SET vehicle_id = $1, requested_at = now() WHERE id = $2`,
        [vehicle_id, reqId]);
    } else {
      const r = await query(
        `INSERT INTO public.vehicle_assignment_requests (vehicle_id, driver_id) VALUES ($1,$2) RETURNING id`,
        [vehicle_id, user.sub]);
      reqId = r.rows[0].id;
    }

    const staff = await query(`SELECT id FROM public.profiles WHERE role IN ('dispatch','admin') AND status = 'active'`);
    const me = await query(`SELECT full_name FROM public.profiles WHERE id = $1`, [user.sub]);
    const driverName = me.rows[0]?.full_name || 'A driver';
    for (const s of staff.rows) {
      sendPushToProfile(s.id, {
        title: 'Vehicle request',
        body: `${driverName} wants ${v.rows[0].label}`,
        url: '/pages/admin.html#sec-drivers',
      }).catch(() => {});
    }
    await logAudit(request, {
      profile_id: user.sub, email: user.email, action: 'vehicle_request_created',
      detail: `${driverName} requested ${v.rows[0].label}`,
    });

    const full = await query(`${SELECT} WHERE r.id = $1`, [reqId]);
    return json(full.rows[0], 201);
  },
});

app.http('vehicleRequestsList', {
  methods: ['GET'], authLevel: 'anonymous', route: 'vehicle-requests',
  handler: async (request) => {
    const { user, error, status } = await requireAuth(request);
    if (error) return err(error, status);
    if (!['driver', 'dispatch', 'admin'].includes(user.role)) return err('Forbidden', 403);
    const params = new URL(request.url).searchParams;
    const st = params.get('status'); // comma-separated
    const conds = []; const vals = []; let i = 1;
    if (st) { conds.push(`r.status = ANY($${i++})`); vals.push(st.split(',')); }
    if (user.role === 'driver') { conds.push(`r.driver_id = $${i++}`); vals.push(user.sub); }
    // dispatch/admin see every driver's requests
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const r = await query(`${SELECT} ${where} ORDER BY r.requested_at DESC LIMIT 200`, vals);
    return json(r.rows);
  },
});

app.http('vehicleRequestDecide', {
  methods: ['POST'], authLevel: 'anonymous', route: 'vehicle-requests/{id}/decide',
  handler: async (request) => {
    const { user, error, status } = await requireRole(request, 'dispatch', 'admin');
    if (error) return err(error, status);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { decision, note } = body || {};
    if (!['approve', 'deny'].includes(decision)) return err('decision must be "approve" or "deny"');
    const cur = await query(`${SELECT} WHERE r.id = $1`, [request.params.id]);
    const reqRow = cur.rows[0];
    if (!reqRow) return err('Not found', 404);
    if (reqRow.status !== 'pending') return err('Already decided', 409);

    if (decision === 'approve') {
      // Same clear-then-set as an admin's direct assign in fleet.js —
      // a driver can only be assigned one vehicle at a time.
      await query(`UPDATE public.vehicles SET driver_id = NULL WHERE driver_id = $1 AND id != $2`,
        [reqRow.driver_id, reqRow.vehicle_id]);
      await query(`UPDATE public.vehicles SET driver_id = $1 WHERE id = $2`, [reqRow.driver_id, reqRow.vehicle_id]);
    }
    await query(
      `UPDATE public.vehicle_assignment_requests SET status = $1, decided_at = now(), decided_by = $2, note = $3 WHERE id = $4`,
      [decision === 'approve' ? 'approved' : 'denied', user.sub, note || null, request.params.id]);

    await logAudit(request, {
      profile_id: user.sub, email: user.email,
      action: decision === 'approve' ? 'vehicle_request_approved' : 'vehicle_request_denied',
      detail: `${reqRow.driver_name} → ${reqRow.vehicle_label}${note ? ` (${note})` : ''}`,
    });

    sendPushToProfile(reqRow.driver_id, decision === 'approve'
      ? { title: 'Vehicle approved', body: `You're set in ${reqRow.vehicle_label}.`, url: '/pages/driver.html' }
      : { title: 'Vehicle request denied', body: note || `${reqRow.vehicle_label} wasn't approved.`, url: '/pages/driver.html' }
    ).catch(() => {});

    const full = await query(`${SELECT} WHERE r.id = $1`, [request.params.id]);
    return json(full.rows[0]);
  },
});

app.http('vehicleRequestCancel', {
  methods: ['POST'], authLevel: 'anonymous', route: 'vehicle-requests/{id}/cancel',
  handler: async (request) => {
    const { user, error, status } = await requireRole(request, 'driver');
    if (error) return err(error, status);
    const cur = await query(`SELECT * FROM public.vehicle_assignment_requests WHERE id = $1`, [request.params.id]);
    if (!cur.rows.length) return err('Not found', 404);
    if (cur.rows[0].driver_id !== user.sub) return err('Forbidden', 403);
    if (cur.rows[0].status !== 'pending') return err('Already decided', 409);
    await query(`UPDATE public.vehicle_assignment_requests SET status = 'cancelled', decided_at = now() WHERE id = $1`,
      [request.params.id]);
    return json({ ok: true });
  },
});
