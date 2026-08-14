// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — login flow (identify → OTP | password)
// ─────────────────────────────────────────────────────────────
let _email = '';

function show(id) {
  ['step-email', 'step-otp', 'step-password'].forEach(s =>
    document.getElementById(s).style.display = s === id ? '' : 'none');
  const e = document.getElementById('login-error'); if (e) e.style.display = 'none';
}
function loginError(msg) {
  const e = document.getElementById('login-error');
  e.textContent = msg; e.style.display = 'block';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function handleIdentify(ev) {
  ev.preventDefault();
  const raw = document.getElementById('email').value.trim();
  if (!EMAIL_RE.test(raw)) return loginError('Please enter a valid email address.');
  _email = raw.toLowerCase();
  const btn = document.getElementById('identify-btn'); const label = document.getElementById('identify-btn-label');
  btn.disabled = true; label.textContent = 'Checking…';
  const { data, error } = await api('/auth/identify', 'POST', { email: _email });
  btn.disabled = false; label.textContent = "Let's Ride";
  if (error) return loginError(error);
  if (data.flow === 'otp') {
    const r = await api('/auth/otp/request', 'POST', { email: _email });
    document.getElementById('otp-sub').textContent = r.data && r.data.test_mode
      ? 'TEST MODE — enter the configured test code.'
      : `We sent a 6-digit code to ${data.phone_hint || 'your mobile number'}.`;
    show('step-otp');
  } else {
    show('step-password');
  }
}

async function handleOtpVerify(ev) {
  ev.preventDefault();
  const code = document.getElementById('otp-code').value.trim();
  const { data, error } = await api('/auth/otp/verify', 'POST', { email: _email, code });
  if (error) return loginError(error);
  saveSession(data.token, data.profile);
  window.location.href = data.portal;
}

async function handlePasswordLogin(ev) {
  ev.preventDefault();
  const password = document.getElementById('password').value;
  const { data, error } = await api('/auth/login', 'POST', { email: _email, password });
  if (error) return loginError(error);
  saveSession(data.token, data.profile);
  window.location.href = data.portal;
}

async function resendOtp() {
  await api('/auth/otp/request', 'POST', { email: _email });
  loginError('A new code is on its way.');
}

// Already signed in? Route straight to the portal.
(function () {
  const p = getProfile();
  if (!p || !getToken()) return;
  const portal = { rider: '/pages/rider.html', handler: '/pages/handler.html', driver: '/pages/driver.html',
                   dispatch: '/pages/dispatch.html', admin: '/pages/admin.html', display: '/pages/dispatch.html' }[p.role];
  if (portal) window.location.href = portal;
})();
