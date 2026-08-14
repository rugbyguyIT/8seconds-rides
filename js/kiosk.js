// Command Center kiosk sign-in — a touchscreen numeric keypad, no email.
// The PIN matches a "Display (command room)" account's password
// (Admin → Create user → role Display). See api/src/functions/auth.js
// authPin for the matching logic. PINs are always exactly 8 digits
// (enforced when set in Admin → Settings), so the dot row is fixed at
// 8 rather than growing with input.
const PIN_LENGTH = 8;
let pin = '';

function kioskRenderDots() {
  const el = document.getElementById('kiosk-dots');
  // Only the just-typed dot gets the "light up" pop animation (rather than
  // every filled dot replaying it on each keystroke, since the whole list
  // is rebuilt here) — reads as each digit lighting up as you type it.
  el.innerHTML = Array.from({ length: PIN_LENGTH }, (_, i) => {
    if (i >= pin.length) return '<span class="kiosk-dot"></span>';
    return `<span class="kiosk-dot filled${i === pin.length - 1 ? ' just-typed' : ''}"></span>`;
  }).join('');
}

// Flashes the on-screen key that was just typed — covers physical/
// on-screen-keyboard entry too, where CSS :active never fires since
// there's no real pointer press on the button itself.
function kioskFlashKey(d) {
  const key = document.querySelector(`.kiosk-key[data-key="${d}"]`);
  if (!key) return;
  key.classList.remove('key-flash'); void key.offsetWidth; // restart if still mid-flash
  key.classList.add('key-flash');
  setTimeout(() => key.classList.remove('key-flash'), 220);
}

function kioskPress(d) {
  if (pin.length >= PIN_LENGTH) return;
  pin += d;
  kioskFlashKey(d);
  document.getElementById('kiosk-error').style.display = 'none';
  kioskRenderDots();
  if (pin.length === PIN_LENGTH) kioskSubmit();
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
    return `<button type="button" class="kiosk-key" data-key="${k}" onclick="kioskPress('${k}')">${k}</button>`;
  }).join('');
  document.addEventListener('keydown', (e) => {
    if (/^[0-9]$/.test(e.key)) kioskPress(e.key);
    else if (e.key === 'Backspace') kioskBackspace();
    else if (e.key === 'Enter') kioskSubmit();
  });
  kioskRenderDots();
})();
