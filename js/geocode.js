// ──────────────────────────────────────────────────────────
// 8 Seconds Ride Management — address autocomplete widget
// Attaches a debounced typeahead dropdown to a text input, backed by
// the /api/geocode/suggest + /api/geocode/retrieve proxy (Mapbox
// Search Box under the hood). On selection, fills the input with the
// full address and stashes {lat, lng} on hidden fields.
//
// Usage:
//   attachAddressAutocomplete(document.querySelector('[name=pickup_text]'), {
//     latInput: document.querySelector('[name=pickup_lat]'),
//     lngInput: document.querySelector('[name=pickup_lng]'),
//     onSelect: () => { /* e.g. clear the venue dropdown */ },
//   });
// ──────────────────────────────────────────────────────────
function attachAddressAutocomplete(inputEl, opts) {
  if (!inputEl) return;
  const { latInput, lngInput, onSelect } = opts || {};
  let sessionToken = null;
  let debounceTimer = null;
  let activeIndex = -1;
  let items = [];
  let warnedThisSession = false;

  const wrap = inputEl.parentElement;
  wrap.style.position = 'relative';

  const menu = document.createElement('div');
  menu.className = 'addr-suggest-menu';
  menu.style.cssText = 'display:none;position:absolute;left:0;right:0;top:100%;margin-top:4px;'
    + 'background:#0b1830;border:1px solid rgba(255,255,255,0.14);border-radius:10px;'
    + 'box-shadow:0 12px 32px rgba(0,0,0,0.45);z-index:50;max-height:240px;overflow-y:auto;';
  wrap.appendChild(menu);

  function newSession() {
    sessionToken = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    warnedThisSession = false;
  }

  function clearCoords() {
    if (latInput) latInput.value = '';
    if (lngInput) lngInput.value = '';
  }

  function closeMenu() {
    menu.style.display = 'none';
    menu.innerHTML = '';
    items = []; activeIndex = -1;
  }

  function renderMenu() {
    if (!items.length) { closeMenu(); return; }
    menu.innerHTML = items.map((s, i) => `
      <div class="addr-suggest-item" data-i="${i}" style="padding:9px 12px;cursor:pointer;font-size:var(--fs-sm);
        ${i === activeIndex ? 'background:rgba(239,118,34,0.18)' : ''}">
        <div style="font-weight:600">${esc(s.name)}</div>
        <div class="small muted">${esc(s.address)}</div>
      </div>`).join('');
    menu.style.display = 'block';
    menu.querySelectorAll('.addr-suggest-item').forEach(el => {
      el.addEventListener('mousedown', (e) => { e.preventDefault(); selectItem(items[parseInt(el.dataset.i, 10)]); });
      el.addEventListener('mouseenter', () => { activeIndex = parseInt(el.dataset.i, 10); renderMenu(); });
    });
  }

  async function selectItem(item) {
    const { data, error } = await api(`/geocode/retrieve?id=${encodeURIComponent(item.id)}&session=${sessionToken}`);
    closeMenu();
    if (error || !data) { toastMsg('Could not load that address', error || 'Try again'); return; }
    inputEl.value = data.address;
    if (latInput) latInput.value = data.lat;
    if (lngInput) lngInput.value = data.lng;
    sessionToken = null; // session ends at retrieve — a fresh one starts on next input
    if (typeof onSelect === 'function') onSelect();
  }

  inputEl.addEventListener('input', () => {
    clearCoords(); // typing invalidates any previously-selected point
    clearTimeout(debounceTimer);
    const q = inputEl.value.trim();
    if (q.length < 3) { closeMenu(); return; }
    if (!sessionToken) newSession();
    debounceTimer = setTimeout(async () => {
      const { data, error } = await api(`/geocode/suggest?q=${encodeURIComponent(q)}&session=${sessionToken}`);
      if (error || !data) {
        closeMenu();
        if (error && !warnedThisSession && typeof toastMsg === 'function') {
          warnedThisSession = true;
          toastMsg('Address lookup unavailable', error);
        }
        return;
      }
      warnedThisSession = false;
      items = data.suggestions || []; activeIndex = -1;
      renderMenu();
    }, 250);
  });

  inputEl.addEventListener('keydown', (e) => {
    if (menu.style.display === 'none') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, items.length - 1); renderMenu(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); renderMenu(); }
    else if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); selectItem(items[activeIndex]); }
    else if (e.key === 'Escape') { closeMenu(); }
  });

  inputEl.addEventListener('blur', () => setTimeout(closeMenu, 150));
}
