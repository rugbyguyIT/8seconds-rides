// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — vehicles + venue library
//   GET/POST /api/vehicles, PATCH /api/vehicles/{id}
//   GET/POST /api/locations, PATCH /api/locations/{id}
// ─────────────────────────────────────────────────────────────
const { app } = require('@azure/functions');
const { query } = require('../db');
const { json, err, requireAuth, requireRole } = require('../middleware');

app.http('vehicles', {
  methods: ['GET', 'POST'], authLevel: 'anonymous', route: 'vehicles',
  handler: async (request) => {
    if (request.method === 'GET') {
      const { error, status } = await requireAuth(request);
      if (error) return err(error, status);
      const r = await query(`SELECT * FROM public.vehicles ORDER BY label`);
      return json(r.rows);
    }
    const { error, status } = await requireRole(request, 'dispatch', 'admin');
    if (error) return err(error, status);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { label, plate, capacity, vclass, color_desc, photo_url, hang_tag, driver_id } = body || {};
    if (!label) return err('label required');
    // No explicit capacity? Fall back to the chosen class's default seat
    // count (excluding driver) rather than a hardcoded 6, so classes like
    // a 12-seat Sprinter Van behave sensibly out of the box.
    let cap = capacity;
    if (cap == null && vclass) {
      const c = await query(`SELECT default_capacity FROM public.vehicle_classes WHERE key = $1`, [vclass]);
      if (c.rows[0]) cap = c.rows[0].default_capacity;
    }
    // A driver can only own one vehicle at a time (see 007 migration's
    // unique index) — clear any prior assignment before creating this one.
    if (driver_id) await query(`UPDATE public.vehicles SET driver_id = NULL WHERE driver_id = $1`, [driver_id]);
    const r = await query(
      `INSERT INTO public.vehicles (label, plate, capacity, class, color_desc, photo_url, hang_tag, driver_id)
       VALUES ($1,$2,COALESCE($3,6),COALESCE($4,'suv'),$5,$6,$7,$8) RETURNING *`,
      [label, plate || null, cap, vclass, color_desc || null, photo_url || null, hang_tag || null, driver_id || null]);
    return json(r.rows[0], 201);
  },
});

app.http('vehiclesUpdate', {
  methods: ['PATCH'], authLevel: 'anonymous', route: 'vehicles/{id}',
  handler: async (request) => {
    const { user, error, status } = await requireAuth(request);
    if (error) return err(error, status);
    const id = request.params.id;
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }

    // Dispatch/admin can set up any vehicle in full, including assigning
    // it to a driver. A driver isn't "dispatch/admin" but can still edit
    // the specific vehicle assigned to them — just the fields that are
    // really theirs to maintain (plate, photo, HLSR hang tag), not the
    // fleet-management fields (label/capacity/class/active/assignment).
    const isPrivileged = ['dispatch', 'admin'].includes(user.role);
    let allowedFields = ['label', 'plate', 'capacity', 'class', 'color_desc', 'active', 'photo_url', 'hang_tag', 'driver_id'];
    if (!isPrivileged) {
      if (user.role !== 'driver') return err('Forbidden', 403);
      const cur = await query(`SELECT driver_id FROM public.vehicles WHERE id = $1`, [id]);
      if (!cur.rows.length) return err('Not found', 404);
      if (cur.rows[0].driver_id !== user.sub) return err('Forbidden — not your vehicle', 403);
      allowedFields = ['plate', 'photo_url', 'hang_tag'];
    }

    const sets = []; const vals = []; let i = 1;
    for (const f of allowedFields) {
      if (body[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push(body[f]); }
    }
    if (!sets.length) return err('Nothing to update');

    if (isPrivileged && body.driver_id) {
      await query(`UPDATE public.vehicles SET driver_id = NULL WHERE driver_id = $1 AND id != $2`, [body.driver_id, id]);
    }

    vals.push(id);
    const r = await query(`UPDATE public.vehicles SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    return json(r.rows[0] || null);
  },
});

app.http('locations', {
  methods: ['GET', 'POST'], authLevel: 'anonymous', route: 'locations',
  handler: async (request) => {
    if (request.method === 'GET') {
      const { error, status } = await requireAuth(request);
      if (error) return err(error, status);
      const r = await query(`SELECT * FROM public.locations WHERE active = TRUE ORDER BY kind, name`);
      return json(r.rows);
    }
    const { error, status } = await requireRole(request, 'dispatch', 'admin');
    if (error) return err(error, status);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { name, kind, lat, lng, notes } = body || {};
    if (!name) return err('name required');
    const r = await query(
      `INSERT INTO public.locations (name, kind, lat, lng, notes)
       VALUES ($1,COALESCE($2,'other'),$3,$4,$5) RETURNING *`,
      [name, kind, lat ?? null, lng ?? null, notes || null]);
    return json(r.rows[0], 201);
  },
});

app.http('locationsUpdate', {
  methods: ['PATCH'], authLevel: 'anonymous', route: 'locations/{id}',
  handler: async (request) => {
    const { error, status } = await requireRole(request, 'dispatch', 'admin');
    if (error) return err(error, status);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const sets = []; const vals = []; let i = 1;
    for (const f of ['name', 'kind', 'lat', 'lng', 'notes', 'active']) {
      if (body[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push(body[f]); }
    }
    if (!sets.length) return err('Nothing to update');
    vals.push(request.params.id);
    const r = await query(`UPDATE public.locations SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    return json(r.rows[0] || null);
  },
});
