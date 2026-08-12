// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — Auth middleware
// NOTE: Azure SWA strips the Authorization header before requests
// reach API functions (same quirk as 8 Seconds). We use x-rides-token.
// ─────────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');
const { query } = require('./db');

const ROLES = ['rider', 'handler', 'driver', 'dispatch', 'admin', 'display'];

// Per-role JWT lifetime. "Forced logout" for dispatch/admin is the
// absolute token expiry; persistent roles get long-lived tokens
// revocable via token_version.
const SESSION_TTL = {
  rider:    '365d',
  handler:  '365d',
  driver:   '365d',
  dispatch: '12h',
  admin:    '24h',
  display:  '90d',
};

function getSecret() {
  return process.env.JWT_SECRET || 'rides-dev-secret-change-in-production';
}

function verifyToken(request) {
  const token = request.headers.get('x-rides-token') || '';
  if (!token) return null;
  try { return jwt.verify(token, getSecret()); } catch { return null; }
}

// Verifies JWT AND checks token_version in DB so admin force-logout
// works instantly (8 Seconds pattern).
async function verifyTokenFull(request) {
  const user = verifyToken(request);
  if (!user) return null;
  try {
    const res = await query(`SELECT token_version, status FROM public.profiles WHERE id = $1`, [user.sub]);
    const row = res.rows[0];
    if (!row || row.status !== 'active') return null;
    if ((row.token_version ?? 1) !== (user.tv ?? 1)) return null;
  } catch {
    // DB unreachable — fail open (do not lock everyone out on a blip)
  }
  return user;
}

async function requireAuth(request) {
  const user = await verifyTokenFull(request);
  if (!user) return { error: 'Unauthorized', status: 401 };
  return { user };
}

async function requireRole(request, ...roles) {
  const { user, error, status } = await requireAuth(request);
  if (error) return { error, status };
  if (!roles.includes(user.role)) return { error: 'Forbidden', status: 403 };
  return { user };
}

function signSession(profile) {
  return jwt.sign(
    { sub: profile.id, email: profile.email, role: profile.role, tv: profile.token_version ?? 1 },
    getSecret(),
    { expiresIn: SESSION_TTL[profile.role] || '12h' }
  );
}

function json(body, status = 200) {
  return { status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

module.exports = { ROLES, SESSION_TTL, verifyToken, verifyTokenFull, requireAuth, requireRole, signSession, json, err, getSecret };
