// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — API helper (8 Seconds pattern)
// Azure SWA strips Authorization headers → custom x-rides-token.
// Token storage: localStorage for persistent roles (rider/handler/driver),
// sessionStorage for dispatch/admin (12h/24h absolute JWT expiry).
// ─────────────────────────────────────────────────────────────
const TOKEN_KEY = 'rides_token';
const PROFILE_KEY = 'rides_profile';
const PERSISTENT_ROLES = ['rider', 'handler', 'driver', 'display'];

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '';
}
function saveSession(token, profile) {
  const store = PERSISTENT_ROLES.includes(profile.role) ? localStorage : sessionStorage;
  store.setItem(TOKEN_KEY, token);
  store.setItem(PROFILE_KEY, JSON.stringify(profile));
}
function getProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || sessionStorage.getItem(PROFILE_KEY) || 'null'); }
  catch { return null; }
}
function signOut() {
  [localStorage, sessionStorage].forEach(s => { s.removeItem(TOKEN_KEY); s.removeItem(PROFILE_KEY); });
  sessionStorage.removeItem('admin_return_token'); sessionStorage.removeItem('admin_return_profile');
  window.location.href = '/index.html';
}

async function api(path, method = 'GET', body) {
  try {
    const res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-rides-token': getToken() },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { signOut(); return { data: null, error: 'Session expired' }; }
    const data = await res.json().catch(() => null);
    if (!res.ok) return { data: null, error: (data && data.error) || `HTTP ${res.status}` };
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
}

// Page guard: call at top of each portal script.
function requireLogin(...roles) {
  const p = getProfile();
  if (!p || !getToken()) { window.location.href = '/index.html'; return null; }
  if (roles.length && !roles.includes(p.role)) { window.location.href = '/index.html'; return null; }
  return p;
}

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function fmtWhen(iso) {
  if (!iso) return 'ASAP';
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function toastMsg(title, body) {
  let stack = document.getElementById('toastStack');
  if (!stack) { stack = document.createElement('div'); stack.id = 'toastStack'; stack.className = 'toast-stack'; document.body.appendChild(stack); }
  const el = document.createElement('div'); el.className = 'toast';
  el.innerHTML = `<i class="fa-solid fa-bell"></i><div><div class="t-title">${esc(title)}</div><div class="t-body">${esc(body)}</div></div>`;
  stack.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 5000);
}

// Register service worker on every portal page
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ── Client-side application/error logging ───────────────────────
// Fire-and-forget: never blocks the UI, never throws. Shows up in
// Admin → Settings → Application Logs. Only sent when signed in
// (unauthenticated pages — the login screen — just console.error).
function appLog(level, event, detail) {
  if (!getToken()) { console[level === 'error' ? 'error' : 'log'](`[${event}]`, detail); return; }
  fetch('/api/app-logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-rides-token': getToken() },
    body: JSON.stringify({ level, event, detail: String(detail).slice(0, 2000), page_url: location.pathname }),
    keepalive: true,
  }).catch(() => {});
}

// Catch anything unhandled so real bugs land in the log instead of
// silently failing in a rider's or driver's browser with no trace.
window.addEventListener('error', (e) => {
  appLog('error', 'client.exception', `${e.message} @ ${e.filename}:${e.lineno}`);
});
window.addEventListener('unhandledrejection', (e) => {
  appLog('error', 'client.unhandled_rejection', e.reason?.stack || e.reason?.message || String(e.reason));
});
