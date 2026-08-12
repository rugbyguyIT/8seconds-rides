// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — auth endpoints
//   POST /api/auth/identify     email → { flow }            (public)
//   POST /api/auth/login        email+password → token      (dispatch/admin)
//   POST /api/auth/otp/request  email → SMS code            (rider/handler/driver)
//   POST /api/auth/otp/verify   email+code → token
//   POST /api/auth/bootstrap    one-time first-admin setup  (BOOTSTRAP_SECRET)
// Session lifetimes are role-based — see middleware.SESSION_TTL.
// ─────────────────────────────────────────────────────────────
const { app } = require('@azure/functions');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { json, err, signSession } = require('../middleware');
const { sendSms, phoneHint } = require('../sms');

const OTP_ROLES = ['rider', 'handler', 'driver'];
const PW_ROLES = ['dispatch', 'admin'];
const OTP_TTL_MIN = 20;
const OTP_MAX_TRIES = 5;

const PORTAL = { rider: '/pages/rider.html', handler: '/pages/handler.html', driver: '/pages/driver.html',
                 dispatch: '/pages/dispatch.html', admin: '/pages/admin.html', display: '/pages/dispatch.html' };

function safeProfile(p) { const { password_hash, token_version, ...rest } = p; return rest; }

app.http('authIdentify', {
  methods: ['POST'], authLevel: 'anonymous', route: 'auth/identify',
  handler: async (request) => {
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { email } = body || {};
    if (!email) return err('email is required');
    const r = await query(`SELECT role, phone_mobile FROM public.profiles WHERE email = $1`,
      [email.toLowerCase().trim()]);
    const p = r.rows[0];
    if (!p) return json({ flow: 'password' }); // don't reveal existence
    if (OTP_ROLES.includes(p.role))
      return json({ flow: 'otp', phone_hint: phoneHint(p.phone_mobile), has_phone: !!phoneHint(p.phone_mobile) });
    return json({ flow: 'password' });
  },
});

app.http('authLogin', {
  methods: ['POST'], authLevel: 'anonymous', route: 'auth/login',
  handler: async (request) => {
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { email, password } = body || {};
    if (!email || !password) return err('email and password are required');
    const r = await query(`SELECT * FROM public.profiles WHERE email = $1 AND status = 'active'`,
      [email.toLowerCase().trim()]);
    const p = r.rows[0];
    if (!p || !PW_ROLES.includes(p.role) || !p.password_hash) return err('Invalid credentials', 401);
    const ok = await bcrypt.compare(password, p.password_hash);
    if (!ok) return err('Invalid credentials', 401);
    await query(`INSERT INTO public.audit_logs (profile_id, email, action) VALUES ($1, $2, 'login')`,
      [p.id, p.email]).catch(() => {});
    return json({ token: signSession(p), profile: safeProfile(p), portal: PORTAL[p.role] });
  },
});

app.http('authOtpRequest', {
  methods: ['POST'], authLevel: 'anonymous', route: 'auth/otp/request',
  handler: async (request) => {
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { email } = body || {};
    if (!email) return err('email is required');
    const r = await query(`SELECT id, full_name, role, phone_mobile FROM public.profiles
                           WHERE email = $1 AND status = 'active'`, [email.toLowerCase().trim()]);
    const p = r.rows[0];
    if (!p || !OTP_ROLES.includes(p.role)) return json({ ok: true }); // no enumeration
    if (!p.phone_mobile) return err('No mobile phone on file. Please contact your administrator.');

    // OTP_TEST_CODE env var = fixed code for testing before SMS is live
    const code = process.env.OTP_TEST_CODE || String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    const hash = await bcrypt.hash(code, 10);
    await query(`DELETE FROM public.otp_tokens WHERE profile_id = $1`, [p.id]);
    await query(`INSERT INTO public.otp_tokens (profile_id, code_hash, expires_at)
                 VALUES ($1, $2, now() + interval '${OTP_TTL_MIN} minutes')`, [p.id, hash]);
    if (!process.env.OTP_TEST_CODE) {
      const first = p.full_name?.split(' ')[0] || 'there';
      const res = await sendSms(p.phone_mobile,
        `8 Seconds Rides: Hi ${first}, your sign-in code is ${code}. Expires in ${OTP_TTL_MIN} minutes. Do not share it.`);
      if (!res.ok) return json({ ok: true, warning: 'SMS may be delayed. Contact admin if the code does not arrive.' });
    }
    return json({ ok: true, test_mode: !!process.env.OTP_TEST_CODE });
  },
});

app.http('authOtpVerify', {
  methods: ['POST'], authLevel: 'anonymous', route: 'auth/otp/verify',
  handler: async (request) => {
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { email, code } = body || {};
    if (!email || !code) return err('email and code are required');
    const r = await query(`SELECT * FROM public.profiles WHERE email = $1 AND status = 'active'`,
      [email.toLowerCase().trim()]);
    const p = r.rows[0];
    if (!p || !OTP_ROLES.includes(p.role)) return err('Invalid code', 401);

    const tr = await query(`SELECT * FROM public.otp_tokens WHERE profile_id = $1
                            ORDER BY created_at DESC LIMIT 1`, [p.id]);
    const t = tr.rows[0];
    if (!t || t.used) return err('No active code. Please request a new one.', 401);
    if (new Date(t.expires_at) < new Date()) return err('Code expired. Please request a new one.', 401);
    if (t.attempts >= OTP_MAX_TRIES) return err('Too many attempts. Please request a new code.', 401);
    await query(`UPDATE public.otp_tokens SET attempts = attempts + 1 WHERE id = $1`, [t.id]);

    const valid = await bcrypt.compare(String(code).trim(), t.code_hash);
    if (!valid) return err('Incorrect code.', 401);
    await query(`UPDATE public.otp_tokens SET used = TRUE WHERE id = $1`, [t.id]);
    await query(`INSERT INTO public.audit_logs (profile_id, email, action) VALUES ($1, $2, 'login_otp')`,
      [p.id, p.email]).catch(() => {});
    return json({ token: signSession(p), profile: safeProfile(p), portal: PORTAL[p.role] });
  },
});

// One-time bootstrap: creates the first admin when profiles is empty.
// Protected by BOOTSTRAP_SECRET app setting; disable by removing the setting.
app.http('authBootstrap', {
  methods: ['POST'], authLevel: 'anonymous', route: 'auth/bootstrap',
  handler: async (request) => {
    const secret = process.env.BOOTSTRAP_SECRET;
    if (!secret) return err('Bootstrap disabled', 403);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { bootstrap_secret, email, password, full_name } = body || {};
    if (bootstrap_secret !== secret) return err('Forbidden', 403);
    if (!email || !password || !full_name) return err('email, password, full_name required');
    const existing = await query(`SELECT 1 FROM public.profiles WHERE role = 'admin' LIMIT 1`);
    if (existing.rows.length) return err('An admin already exists — use Admin → Users instead', 409);
    const hash = await bcrypt.hash(password, 10);
    const ins = await query(
      `INSERT INTO public.profiles (email, full_name, role, status, password_hash)
       VALUES ($1, $2, 'admin', 'active', $3) RETURNING id, email, full_name, role`,
      [email.toLowerCase().trim(), full_name, hash]);
    return json({ ok: true, profile: ins.rows[0] });
  },
});
