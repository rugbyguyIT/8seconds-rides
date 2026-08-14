// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — users
//   GET    /api/me                        (any role)
//   GET    /api/profiles?role=            (dispatch/admin)
//   POST   /api/profiles                  (admin)
//   PATCH  /api/profiles/{id}             (admin; force_logout bumps token_version)
//   GET    /api/handler-assignments       (admin, or handler = own)
//   POST   /api/handler-assignments       (admin)
//   DELETE /api/handler-assignments/{id}  (admin)
//
// Names are stored as first_name + last_name (source of truth). full_name
// is a denormalized "First Last" convenience column recomputed on every
// create/update so every other screen can keep reading it unchanged.
// ─────────────────────────────────────────────────────────────
const { app } = require('@azure/functions');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { json, err, requireAuth, requireRole, ROLES, logAudit, signSession } = require('../middleware');

const SAFE = `id, email, first_name, last_name, full_name, phone_mobile, role, enduser_class, photo_url, status, sms_consent, created_at`;
// Admin "view as" — only makes sense for the two roles whose whole
// screen is scoped to a single person's own data.
const IMPERSONATE_PORTAL = { rider: '/pages/rider.html', handler: '/pages/handler.html' };

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
      ? await query(`SELECT ${SAFE} FROM public.profiles WHERE role = $1 ORDER BY last_name, first_name`, [role])
      : await query(`SELECT ${SAFE} FROM public.profiles ORDER BY role, last_name, first_name`);
    return json(r.rows);
  },
});

app.http('profilesCreate', {
  methods: ['POST'], authLevel: 'anonymous', route: 'profiles',
  handler: async (request) => {
    const { user, error, status } = await requireRole(request, 'admin');
    if (error) return err(error, status);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { email, first_name, last_name, role, phone_mobile, enduser_class, photo_url, password, sms_consent } = body || {};
    if (!email || !first_name || !last_name || !role) return err('email, first_name, last_name, role required');
    if (!ROLES.includes(role)) return err(`role must be one of: ${ROLES.join(', ')}`);
    if (['dispatch', 'admin'].includes(role) && !password) return err(`${role} accounts need a password`);
    if (['rider', 'handler', 'driver'].includes(role) && !phone_mobile) return err(`${role} accounts need a mobile phone (OTP sign-in)`);
    const hash = password ? await bcrypt.hash(password, 10) : null;
    const fn = first_name.trim(), ln = last_name.trim();
    const full_name = `${fn} ${ln}`.trim();
    try {
      const r = await query(
        `INSERT INTO public.profiles (email, first_name, last_name, full_name, role, phone_mobile, enduser_class, photo_url, password_hash, sms_consent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,FALSE)) RETURNING ${SAFE}`,
        [email.toLowerCase().trim(), fn, ln, full_name, role, phone_mobile || null,
         enduser_class || null, photo_url || null, hash, sms_consent]);
      await logAudit(request, {
        profile_id: user.sub, email: user.email, action: 'user_created',
        detail: `created ${full_name} (${role}) <${email.toLowerCase().trim()}>`,
      });
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
    for (const f of ['phone_mobile', 'role', 'enduser_class', 'photo_url', 'status', 'sms_consent']) {
      if (body[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push(body[f]); }
    }

    if (body.email !== undefined) {
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err('Enter a valid email address');
      sets.push(`email = $${i++}`); vals.push(email);
    }

    if (body.first_name !== undefined || body.last_name !== undefined) {
      const cur = await query(`SELECT first_name, last_name FROM public.profiles WHERE id = $1`, [id]);
      if (!cur.rows.length) return err('Not found', 404);
      const fn = (body.first_name !== undefined ? body.first_name : cur.rows[0].first_name || '').trim();
      const ln = (body.last_name !== undefined ? body.last_name : cur.rows[0].last_name || '').trim();
      sets.push(`first_name = $${i++}`); vals.push(fn);
      sets.push(`last_name = $${i++}`); vals.push(ln);
      sets.push(`full_name = $${i++}`); vals.push(`${fn} ${ln}`.trim());
    }

    if (body.password) { sets.push(`password_hash = $${i++}`); vals.push(await bcrypt.hash(body.password, 10)); }
    if (body.force_logout) sets.push(`token_version = token_version + 1`);
    if (!sets.length) return err('Nothing to update');
    vals.push(id);
    try {
      const r = await query(`UPDATE public.profiles SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${SAFE}`, vals);
      if (!r.rows.length) return err('Not found', 404);
      if (body.force_logout)
        await logAudit(request, { profile_id: user.sub, email: user.email, action: 'force_logout', detail: `target=${r.rows[0].full_name} <${r.rows[0].email}>` });
      if (body.password)
        await logAudit(request, { profile_id: user.sub, email: user.email, action: 'password_reset', detail: `target=${r.rows[0].full_name} <${r.rows[0].email}>` });
      if (body.email !== undefined)
        await logAudit(request, { profile_id: user.sub, email: user.email, action: 'email_changed', detail: `target=${r.rows[0].full_name} → ${r.rows[0].email}` });
      return json(r.rows[0]);
    } catch (e) {
      if (e.code === '23505') return err('A user with that email already exists', 409);
      throw e;
    }
  },
});

// Admin "view as" a rider or handler — mints a real session token for
// that account so the admin sees exactly what they see. The admin's own
// token is preserved client-side (js/admin.js) so they can return without
// re-authenticating. Every use is written to the audit log.
app.http('profileImpersonate', {
  methods: ['POST'], authLevel: 'anonymous', route: 'profiles/{id}/impersonate',
  handler: async (request) => {
    const { user, error, status } = await requireRole(request, 'admin');
    if (error) return err(error, status);
    const r = await query(`SELECT * FROM public.profiles WHERE id = $1 AND status = 'active'`, [request.params.id]);
    const target = r.rows[0];
    if (!target) return err('Not found', 404);
    if (!IMPERSONATE_PORTAL[target.role]) return err('Can only view as a rider or handler', 400);
    await logAudit(request, {
      profile_id: user.sub, email: user.email, full_name: null, action: 'impersonate_start',
      detail: `admin <${user.email}> viewing as ${target.full_name} <${target.email}> (${target.role})`,
    });
    const { password_hash, token_version, ...safe } = target;
    return json({ token: signSession(target), profile: safe, portal: IMPERSONATE_PORTAL[target.role] });
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
