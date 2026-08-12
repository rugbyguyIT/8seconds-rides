// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — vehicle positions (rev 1 = polling;
// Azure Web PubSub is the rev-2 upgrade for true push fan-out)
//   POST /api/positions          driver ping every 3-5 s while en route
//   GET  /api/positions/latest   dispatch/admin/display
// ─────────────────────────────────────────────────────────────
const { app } = require('@azure/functions');
const { query } = require('../db');
const { json, err, requireRole } = require('../middleware');

app.http('positionsPost', {
  methods: ['POST'], authLevel: 'anonymous', route: 'positions',
  handler: async (request) => {
    const { user, error, status } = await requireRole(request, 'driver');
    if (error) return err(error, status);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { vehicle_id, ride_id, lat, lng, heading, speed } = body || {};
    if (!vehicle_id || lat == null || lng == null) return err('vehicle_id, lat, lng required');
    await query(
      `INSERT INTO public.vehicle_positions (vehicle_id, ride_id, driver_id, lat, lng, heading, speed)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [vehicle_id, ride_id || null, user.sub, lat, lng, heading ?? null, speed ?? null]);
    return json({ ok: true });
  },
});

app.http('positionsLatest', {
  methods: ['GET'], authLevel: 'anonymous', route: 'positions/latest',
  handler: async (request) => {
    const { error, status } = await requireRole(request, 'dispatch', 'admin', 'display');
    if (error) return err(error, status);
    const r = await query(
      `SELECT DISTINCT ON (vp.vehicle_id)
              vp.vehicle_id, v.label, vp.ride_id, vp.lat, vp.lng, vp.heading, vp.speed, vp.recorded_at,
              (now() - vp.recorded_at > interval '20 seconds') AS stale
       FROM public.vehicle_positions vp JOIN public.vehicles v ON v.id = vp.vehicle_id
       WHERE vp.recorded_at > now() - interval '30 minutes'
       ORDER BY vp.vehicle_id, vp.recorded_at DESC`);
    return json(r.rows);
  },
});
