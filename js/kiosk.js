// Command Center kiosk sign-in — a touchscreen numeric keypad, no email.
// The PIN matches a "Display (command room)" account's password
// (Admin → Create user → role Display). See api/src/functions/auth.js
// authPin for the matching logic.
let pin = '';

function kioskRenderDots() {
  const el = document.getElementById('kiosk-dots');
  el.innerHTML = Array.from({ length: Math.max(pin.length, 4) }, (_, i) =>
    `<span class="kiosk-dot${i < pin.length ? ' filled' : ''}"></span>`).join('');
}

function kioskPress(d) {
  if (pin.length >= 12) return;
  pin += d;
  document.getElementById('kiosk-error').style.display = 'none';
  kioskRenderDots();
}
function kioskClear() {
  pin = '';
  document.getElementById('kiosk-error').style.display = 'none';
  kioskRenderDots();
}
function kioskBackspace() {
  pin = pin.slice(0, -1);
  kioskRenderDots();
}

async function kioskSubmit() {
  if (!pin) return;
  const errEl = document.getElementById('kiosk-error');
  errEl.style.display = 'none';
  const { data, error } = await api('/auth/pin', 'POST', { pin });
  if (error) {
    errEl.textContent = error;
    errEl.style.display = 'block';
    pin = ''; kioskRenderDots();
    return;
  }
  saveSession(data.token, data.profile);
  window.location.href = data.portal || '/pages/command.html';
}

(function initKiosk() {
  const pad = document.getElementById('kiosk-pad');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
  pad.innerHTML = keys.map(k => {
    if (k === '') return '<span></span>';
    if (k === 'back') return `<button type="button" class="kiosk-key" onclick="kioskBackspace()"><i class="fa-solid fa-delete-left"></i></button>`;
    return `<button type="button" class="kiosk-key" onclick="kioskPress('${k}')">${k}</button>`;
  }).join('');
  document.addEventListener('keydown', (e) => {
    if (/^[0-9]$/.test(e.key)) kioskPress(e.key);
    else if (e.key === 'Backspace') kioskBackspace();
    else if (e.key === 'Enter') kioskSubmit();
  });
  kioskRenderDots();
})();
