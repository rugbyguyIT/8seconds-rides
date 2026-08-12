// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — users
//   GET    /api/me                        (any role)
//   GET    /api/profiles?role=            (dispatch/admin)
//   POST   /api/profiles                  (admin)
//   PATCH  /api/profiles/{id}             (admin; force_logout bumps token_version)
//   GET    /api/handler-assignments       (admin, or handler = own)
//   POST   /api/handler-assignments       (admin)
//   DELETE /api/handler-assignments/{id}  (admin)
// ─────────────────────────────────────────────────────────────
const { app } = require('@azure/functions');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { json, err, requireAuth, requireRole, ROLES } = require('../middleware');

const SAFE = `id, email, full_name, phone_mobile, role, enduser_class, photo_url, status, sms_consent, created_at`;

app.http('me', {
  methods: ['GET'], authLevel: 'anonymous', route: 'me',
  handler: async (request) => {
    const { user, error, status } = await requireAuth(request);
    if (error) return err(error, status);
    const r = await query(`SELECT ${SAFE} FROM public.profiles WHERE id = $1`, [user.sub]);
    return json(r.rows[0] || null);
  },
});

app.http('profilesList', {
  methods: ['GET'], authLevel: 'anonymous', route: 'profiles',
  handler: async (request) => {
    const { user, error, status } = await requireRole(request, 'dispatch', 'admin');
    if (error) return err(error, status);
    const role = new URL(request.url).searchParams.get('role');
    const r = role
      ? await query(`SELECT ${SAFE} FROM public.profiles WHERE role = $1 ORDER BY full_name`, [role])
      : await query(`SELECT ${SAFE} FROM public.profiles ORDER BY role, full_name`);
    return json(r.rows);
  },
});

app.http('profilesCreate', {
  methods: ['POST'], authLevel: 'anonymous', route: 'profiles',
  handler: async (request) => {
    const { user, error, status } = await requireRole(request, 'admin');
    if (error) return err(error, status);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { email, full_name, role, phone_mobile, enduser_class, photo_url, password, sms_consent } = body || {};
    if (!email || !full_name || !role) return err('email, full_name, role required');
    if (!ROLES.includes(role)) return err(`role must be one of: ${ROLES.join(', ')}`);
    if (['dispatch', 'admin'].includes(role) && !password) return err(`${role} accounts need a password`);
    if (['rider', 'handler', 'driver'].includes(role) && !phone_mobile) return err(`${role} accounts need a mobile phone (OTP sign-in)`);
    const hash = password ? await bcrypt.hash(password, 10) : null;
    try {
      const r = await query(
        `INSERT INTO public.profiles (email, full_name, role, phone_mobile, enduser_class, photo_url, password_hash, sms_consent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,FALSE)) RETURNING ${SAFE}`,
        [email.toLowerCase().trim(), full_name, role, phone_mobile || null,
         enduser_class || null, photo_url || null, hash, sms_consent]);
      return json(r.rows[0], 201);
    } catch (e) {
      if (e.code === '23505') return err('A user with that email already exists', 409);
      throw e;
    }
  },
});

app.http('profilesUpdate', {
  methods: ['PATCH'], authLevel: 'anonymous', route: 'profiles/{id}',
  handler: async (request, context) => {
    const { user, error, status } = await requireRole(request, 'admin');
    if (error) return err(error, status);
    const id = request.params.id;
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const sets = []; const vals = []; let i = 1;
    for (const f of ['full_name', 'phone_mobile', 'role', 'enduser_class', 'photo_url', 'status', 'sms_consent']) {
      if (body[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push(body[f]); }
    }
    if (body.password) { sets.push(`password_hash = $${i++}`); vals.push(await bcrypt.hash(body.password, 10)); }
    if (body.force_logout) sets.push(`token_version = token_version + 1`);
    if (!sets.length) return err('Nothing to update');
    vals.push(id);
    const r = await query(`UPDATE public.profiles SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${SAFE}`, vals);
    if (!r.rows.length) return err('Not found', 404);
    return json(r.rows[0]);
  },
});

app.http('handlerAssignments', {
  methods: ['GET', 'POST'], authLevel: 'anonymous', route: 'handler-assignments',
  handler: async (request) => {
    const { user, error, status } = await requireAuth(request);
    if (error) return err(error, status);
    if (request.method === 'GET') {
      if (user.role === 'handler') {
        const r = await query(
          `SELECT ha.id, ha.enduser_id, p.full_name, p.enduser_class, p.photo_url
           FROM public.handler_assignments ha JOIN public.profiles p ON p.id = ha.enduser_id
           WHERE ha.handler_id = $1 AND ha.active = TRUE ORDER BY p.full_name`, [user.sub]);
        return json(r.rows);
      }
      if (!['dispatch', 'admin'].includes(user.role)) return err('Forbidden', 403);
      const r = await query(
        `SELECT ha.id, ha.handler_id, h.full_name AS handler_name, ha.enduser_id, e.full_name AS enduser_name, ha.active
         FROM public.handler_assignments ha
         JOIN public.profiles h ON h.id = ha.handler_id
         JOIN public.profiles e ON e.id = ha.enduser_id
         ORDER BY h.full_name`);
      return json(r.rows);
    }
    if (user.role !== 'admin') return err('Forbidden', 403);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { handler_id, enduser_id } = body || {};
    if (!handler_id || !enduser_id) return err('handler_id and enduser_id required');
    const r = await query(
      `INSERT INTO public.handler_assignments (handler_id, enduser_id)
       VALUES ($1, $2)
       ON CONFLICT (handler_id, enduser_id) DO UPDATE SET active = TRUE
       RETURNING *`, [handler_id, enduser_id]);
    return json(r.rows[0], 201);
  },
});

app.http('handlerAssignmentsDelete', {
  methods: ['DELETE'], authLevel: 'anonymous', route: 'handler-assignments/{id}',
  handler: async (request) => {
    const { user, error, status } = await requireRole(request, 'admin');
    if (error) return err(error, status);
    await query(`UPDATE public.handler_assignments SET active = FALSE WHERE id = $1`, [request.params.id]);
    return json({ ok: true });
  },
});
