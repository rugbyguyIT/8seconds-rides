// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — auth endpoints
//   POST /api/auth/identify     email → { flow }            (public)
//   POST /api/auth/login        email+password → token      (dispatch/admin/display)
//   POST /api/auth/otp/request  email → SMS code            (rider/handler/driver)
//   POST /api/auth/otp/verify   email+code → token
//   POST /api/auth/pin          PIN only → token             (display — Command Center kiosk)
//   POST /api/auth/bootstrap    one-time first-admin setup  (BOOTSTRAP_SECRET)
// Session lifetimes are role-based — see middleware.SESSION_TTL.
// Every login attempt (success AND failure) is written to audit_logs
// with IP + user-agent — see Admin → Settings → Security.
// ─────────────────────────────────────────────────────────────
const { app } = require('@azure/functions');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { json, err, signSession, logAudit } = require('../middleware');
const { sendSms, phoneHint } = require('../sms');

const OTP_ROLES = ['rider', 'handler', 'driver'];
const PW_ROLES = ['dispatch', 'admin', 'display'];
const OTP_TTL_MIN = 20;
const OTP_MAX_TRIES = 5;

const PORTAL = { rider: '/pages/rider.html', handler: '/pages/handler.html', driver: '/pages/driver.html',
                 dispatch: '/pages/dispatch.html', admin: '/pages/admin.html', display: '/pages/command.html' };

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
    const cleanEmail = email.toLowerCase().trim();
    const r = await query(`SELECT * FROM public.profiles WHERE email = $1 AND status = 'active'`, [cleanEmail]);
    const p = r.rows[0];
    if (!p || !PW_ROLES.includes(p.role) || !p.password_hash) {
      await logAudit(request, { email: cleanEmail, action: 'login_failed', detail: 'unknown account or wrong role' });
      return err('Invalid credentials', 401);
    }
    const ok = await bcrypt.compare(password, p.password_hash);
    if (!ok) {
      await logAudit(request, { profile_id: p.id, email: p.email, full_name: p.full_name, action: 'login_failed', detail: 'bad password' });
      return err('Invalid credentials', 401);
    }
    await logAudit(request, { profile_id: p.id, email: p.email, full_name: p.full_name, action: 'login' });
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
    const cleanEmail = email.toLowerCase().trim();
    const r = await query(`SELECT * FROM public.profiles WHERE email = $1 AND status = 'active'`, [cleanEmail]);
    const p = r.rows[0];
    if (!p || !OTP_ROLES.includes(p.role)) {
      await logAudit(request, { email: cleanEmail, action: 'otp_failed', detail: 'unknown account or wrong role' });
      return err('Invalid code', 401);
    }

    const tr = await query(`SELECT * FROM public.otp_tokens WHERE profile_id = $1
                            ORDER BY created_at DESC LIMIT 1`, [p.id]);
    const t = tr.rows[0];
    const fail = (detail) => logAudit(request, { profile_id: p.id, email: p.email, full_name: p.full_name, action: 'otp_failed', detail });

    if (!t || t.used) { await fail('no active code'); return err('No active code. Please request a new one.', 401); }
    if (new Date(t.expires_at) < new Date()) { await fail('code expired'); return err('Code expired. Please request a new one.', 401); }
    if (t.attempts >= OTP_MAX_TRIES) { await fail('too many attempts'); return err('Too many attempts. Please request a new code.', 401); }
    await query(`UPDATE public.otp_tokens SET attempts = attempts + 1 WHERE id = $1`, [t.id]);

    const valid = await bcrypt.compare(String(code).trim(), t.code_hash);
    if (!valid) { await fail('incorrect code'); return err('Incorrect code.', 401); }
    await query(`UPDATE public.otp_tokens SET used = TRUE WHERE id = $1`, [t.id]);
    await logAudit(request, { profile_id: p.id, email: p.email, full_name: p.full_name, action: 'login_otp' });
    return json({ token: signSession(p), profile: safeProfile(p), portal: PORTAL[p.role] });
  },
});

// Command Center kiosk sign-in — no email, no user account, just a
// shared PIN typed on a touchscreen (see pages/kiosk.html). Under the
// hood the PIN IS the password for a single hidden "display"-role
// system profile that migration 006 auto-provisions — admins set/change
// the PIN from Admin → Settings → Command Center kiosk, never by
// creating a user. Matches against every active display account (in
// practice there's exactly one) since a kiosk has no idea which one it
// is until the PIN resolves it.
app.http('authPin', {
  methods: ['POST'], authLevel: 'anonymous', route: 'auth/pin',
  handler: async (request) => {
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { pin } = body || {};
    if (!pin || !String(pin).trim()) return err('PIN is required');
    const r = await query(`SELECT * FROM public.profiles WHERE role = 'display' AND status = 'active' AND password_hash IS NOT NULL`);
    for (const p of r.rows) {
      if (await bcrypt.compare(String(pin).trim(), p.password_hash)) {
        await logAudit(request, { profile_id: p.id, email: p.email, full_name: p.full_name, action: 'login_pin' });
        return json({ token: signSession(p), profile: safeProfile(p), portal: PORTAL[p.role] });
      }
    }
    await logAudit(request, { action: 'login_pin_failed', detail: 'no matching kiosk PIN' });
    return err('Incorrect PIN', 401);
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
    const { bootstrap_secret, email, password, first_name, last_name } = body || {};
    if (bootstrap_secret !== secret) return err('Forbidden', 403);
    if (!email || !password || !first_name || !last_name) return err('email, password, first_name, last_name required');
    const existing = await query(`SELECT 1 FROM public.profiles WHERE role = 'admin' LIMIT 1`);
    if (existing.rows.length) return err('An admin already exists — use Admin → Users instead', 409);
    const hash = await bcrypt.hash(password, 10);
    const full_name = `${first_name.trim()} ${last_name.trim()}`.trim();
    const ins = await query(
      `INSERT INTO public.profiles (email, first_name, last_name, full_name, role, status, password_hash)
       VALUES ($1, $2, $3, $4, 'admin', 'active', $5) RETURNING id, email, full_name, role`,
      [email.toLowerCase().trim(), first_name.trim(), last_name.trim(), full_name, hash]);
    await logAudit(request, {
      profile_id: ins.rows[0].id, email: ins.rows[0].email, full_name,
      action: 'bootstrap_admin_created',
    });
    return json({ ok: true, profile: ins.rows[0] });
  },
});
