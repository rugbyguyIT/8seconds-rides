// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — rides
//   POST /api/rides                    create request (rider/handler/dispatch/admin)
//   GET  /api/rides?status=&scope=     role-scoped list
//   GET  /api/rides/{id}/events        timeline
//   POST /api/rides/{id}/action        { action, reason?, driver_id?, vehicle_id?, alert_kind?, note? }
// All mutations flow through rides-core.performAction() — single code path.
// ─────────────────────────────────────────────────────────────
const { app } = require('@azure/functions');
const { query } = require('../db');
const { json, err, requireAuth } = require('../middleware');
const { performAction, emitRequested } = require('../rides-core');
const { flushOutbox } = require('../notifier');

const RIDE_SELECT = `
  SELECT r.*, p.full_name AS enduser_name, p.enduser_class, p.photo_url AS enduser_photo,
         pl.name AS pickup_name, dl.name AS dropoff_name,
         ra.driver_id, ra.vehicle_id, d.full_name AS driver_name, d.photo_url AS driver_photo,
         v.label AS vehicle_label, v.color_desc AS vehicle_desc
  FROM public.rides r
  JOIN public.profiles p ON p.id = r.enduser_id
  LEFT JOIN public.locations pl ON pl.id = r.pickup_location_id
  LEFT JOIN public.locations dl ON dl.id = r.dropoff_location_id
  LEFT JOIN public.ride_assignments ra ON ra.ride_id = r.id AND ra.active = TRUE
  LEFT JOIN public.profiles d ON d.id = ra.driver_id
  LEFT JOIN public.vehicles v ON v.id = ra.vehicle_id`;

app.http('ridesCreate', {
  methods: ['POST'], authLevel: 'anonymous', route: 'rides',
  handler: async (request) => {
    const { user, error, status } = await requireAuth(request);
    if (error) return err(error, status);
    if (!['rider', 'handler', 'dispatch', 'admin'].includes(user.role)) return err('Forbidden', 403);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { enduser_id, pickup_location_id, dropoff_location_id, pickup_text, dropoff_text,
            pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
            scheduled_at, party_size, ada_required, round_trip, notes } = body || {};

    let target = user.sub;
    if (user.role === 'rider') {
      if (enduser_id && enduser_id !== user.sub) return err('Riders can only request for themselves', 403);
    } else {
      if (!enduser_id) return err('enduser_id required');
      target = enduser_id;
      if (user.role === 'handler') {
        const ok = await query(
          `SELECT 1 FROM public.handler_assignments WHERE handler_id=$1 AND enduser_id=$2 AND active=TRUE`,
          [user.sub, target]);
        if (!ok.rows.length) return err('Not assigned to this rider', 403);
      }
    }
    if (!pickup_location_id && !pickup_text) return err('Pickup required');
    if (!dropoff_location_id && !dropoff_text) return err('Drop-off required');

    const cls = await query(`SELECT enduser_class FROM public.profiles WHERE id = $1`, [target]);
    const r = await query(
      `INSERT INTO public.rides (enduser_id, requested_by, pickup_location_id, dropoff_location_id,
         pickup_text, dropoff_text, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
         scheduled_at, party_size, ada_required, round_trip, notes, priority_class)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,1),COALESCE($13,FALSE),COALESCE($14,FALSE),$15,$16)
       RETURNING id`,
      [target, user.sub, pickup_location_id || null, dropoff_location_id || null,
       pickup_text || null, dropoff_text || null,
       pickup_location_id ? null : (pickup_lat ?? null), pickup_location_id ? null : (pickup_lng ?? null),
       dropoff_location_id ? null : (dropoff_lat ?? null), dropoff_location_id ? null : (dropoff_lng ?? null),
       scheduled_at || null, party_size, ada_required, round_trip, notes || null, cls.rows[0]?.enduser_class || null]);
    await emitRequested(r.rows[0].id, user);
    flushOutbox(25).catch(() => {}); // best-effort immediate delivery; cron sweeps the rest
    const full = await query(`${RIDE_SELECT} WHERE r.id = $1`, [r.rows[0].id]);
    return json(full.rows[0], 201);
  },
});

app.http('ridesList', {
  methods: ['GET'], authLevel: 'anonymous', route: 'rides',
  handler: async (request) => {
    const { user, error, status } = await requireAuth(request);
    if (error) return err(error, status);
    const params = new URL(request.url).searchParams;
    const st = params.get('status'); // comma-separated
    const conds = []; const vals = []; let i = 1;
    if (st) { conds.push(`r.status = ANY($${i++})`); vals.push(st.split(',')); }

    if (user.role === 'rider') { conds.push(`r.enduser_id = $${i++}`); vals.push(user.sub); }
    else if (user.role === 'handler') {
      conds.push(`(r.enduser_id IN (SELECT enduser_id FROM public.handler_assignments
                   WHERE handler_id = $${i} AND active = TRUE) OR r.enduser_id = $${i})`);
      vals.push(user.sub); i++;
    }
    else if (user.role === 'driver') { conds.push(`ra.driver_id = $${i++}`); vals.push(user.sub); }
    // dispatch/admin/display: all rides

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const r = await query(`${RIDE_SELECT} ${where}
      ORDER BY COALESCE(r.scheduled_at, r.created_at) ASC LIMIT 200`, vals);
    return json(r.rows);
  },
});

app.http('rideEvents', {
  methods: ['GET'], authLevel: 'anonymous', route: 'rides/{id}/events',
  handler: async (request) => {
    const { user, error, status } = await requireAuth(request);
    if (error) return err(error, status);
    const r = await query(
      `SELECT e.event, e.actor_role, e.reason, e.created_at, a.full_name AS actor_name
       FROM public.ride_events e LEFT JOIN public.profiles a ON a.id = e.actor_id
       WHERE e.ride_id = $1 ORDER BY e.created_at`, [request.params.id]);
    return json(r.rows);
  },
});

app.http('rideAction', {
  methods: ['POST'], authLevel: 'anonymous', route: 'rides/{id}/action',
  handler: async (request) => {
    const { user, error, status } = await requireAuth(request);
    if (error) return err(error, status);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { action, reason, driver_id, vehicle_id, alert_kind, note } = body || {};
    if (!action) return err('action required');
    try {
      const result = await performAction(request.params.id, action, user,
        { reason, driverId: driver_id, vehicleId: vehicle_id, alertKind: alert_kind, note });
      flushOutbox(25).catch(() => {});
      const full = await query(`${RIDE_SELECT} WHERE r.id = $1`, [request.params.id]);
      return json({ ok: true, ride: full.rows[0], enqueued: result.enqueued });
    } catch (e) {
      if (e.status) return err(e.message, e.status);
      throw e;
    }
  },
});
