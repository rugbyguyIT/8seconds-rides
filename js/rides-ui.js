// Shared ride rendering helpers for all portals
const STATUS_META = {
  requested:   { badge: 'badge-pending',  strip: 'var(--amber)',  label: 'Awaiting approval', icon: 'fa-hourglass-half' },
  approved:    { badge: 'badge-approved', strip: 'var(--green)',  label: 'Approved',           icon: 'fa-circle-check' },
  assigned:    { badge: 'badge-active',   strip: 'var(--blue)',   label: 'Driver assigned',    icon: 'fa-id-badge' },
  en_route:    { badge: 'badge-live',     strip: 'var(--orange)', label: 'Driver en route',    icon: 'fa-circle' },
  arrived:     { badge: 'badge-live',     strip: 'var(--orange)', label: 'Driver arrived',     icon: 'fa-location-dot' },
  in_progress: { badge: 'badge-live',     strip: 'var(--orange)', label: 'In progress',        icon: 'fa-car-side' },
  completed:   { badge: 'badge-neutral',  strip: 'var(--navy)',   label: 'Completed',          icon: 'fa-flag-checkered' },
  denied:      { badge: 'badge-no',       strip: 'var(--red)',    label: 'Declined',           icon: 'fa-ban' },
  cancelled:   { badge: 'badge-no',       strip: 'var(--red)',    label: 'Cancelled',          icon: 'fa-xmark' },
  no_show:     { badge: 'badge-no',       strip: 'var(--red)',    label: 'No-show',            icon: 'fa-user-slash' },
};
const CLASS_CHIP = { vip: 'class-vip', executive: 'class-exec', performer: 'class-performer', guest: 'class-vip' };

function rideRoute(r) {
  return `${esc(r.pickup_name || r.pickup_text || '?')} <i class="fa-solid fa-arrow-right-long route-arrow"></i> ${esc(r.dropoff_name || r.dropoff_text || '?')}`;
}
function rideMeta(r) {
  const bits = [`<span class="event-meta-item"><i class="fa-solid fa-clock"></i> ${esc(fmtWhen(r.scheduled_at))}</span>`,
                `<span class="event-meta-item"><i class="fa-solid fa-user-group"></i> Party of ${r.party_size}</span>`];
  if (r.round_trip) bits.push(`<span class="event-meta-item"><i class="fa-solid fa-rotate"></i> Round trip</span>`);
  if (r.ada_required) bits.push(`<span class="event-meta-item"><i class="fa-brands fa-accessible-icon"></i> ADA</span>`);
  if (r.driver_name) bits.push(`<span class="event-meta-item"><i class="fa-solid fa-id-badge"></i> ${esc(r.driver_name)} · ${esc(r.vehicle_label || '')}</span>`);
  return bits.join('');
}
function rideCard(r, actionsHtml, titlePrefix) {
  const m = STATUS_META[r.status] || STATUS_META.requested;
  return `<div class="event-card"><div class="ec-strip" style="background:${m.strip}"></div><div class="ec-body">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div class="event-title">${titlePrefix ? esc(titlePrefix) + ' · ' : ''}${rideRoute(r)}</div>
      <span class="badge ${m.badge}"><i class="fa-solid ${m.icon}"></i> ${m.label}</span>
    </div>
    <div class="event-meta">${rideMeta(r)}</div>
    ${actionsHtml ? `<div class="event-footer"><span class="small muted">Requested ${esc(fmtWhen(r.created_at))}</span><div class="event-actions">${actionsHtml}</div></div>` : ''}
  </div></div>`;
}
async function rideAction(id, action, extra, confirmMsg) {
  if (confirmMsg) {
    const danger = ['cancel', 'cancel_active', 'deny', 'no_show'].includes(action);
    const ok = await confirmModal(confirmMsg, { danger, confirmLabel: danger ? 'Yes, do it' : 'Confirm' });
    if (!ok) return;
  }
  let reason;
  if (['deny', 'cancel_active'].includes(action)) {
    reason = await promptModal('The rider and their handler will see this.', { title: 'Add a reason', required: true, placeholder: 'Reason…' });
    if (!reason) return;
  }
  const { data, error } = await api(`/rides/${id}/action`, 'POST', { action, reason, ...(extra || {}) });
  if (error) { toastMsg('Could not complete that', error); return; }
  toastMsg('Done', `${data.enqueued} notification${data.enqueued === 1 ? '' : 's'} queued.`);
  if (typeof refresh === 'function') refresh();
}
function locationOptions(locs, sel) {
  return `<option value="">${sel || 'Choose…'}</option>` +
    locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
}

// ─────────────────────────────────────────────────────────────
// Custom confirm/prompt/form modals — replace the browser's native
// confirm()/prompt() dialogs (which can't be styled and look jarring
// against the app's glass UI) with app-styled equivalents. All three
// are Promise-based so call sites just `await` them like the natives
// they replace. Shared across every portal since rides-ui.js loads
// everywhere except the login page.
// ─────────────────────────────────────────────────────────────
(function injectModalStyles() {
  if (document.getElementById('ui-modal-styles')) return;
  const s = document.createElement('style');
  s.id = 'ui-modal-styles';
  s.textContent = `
    @keyframes uiModalFade{from{opacity:0}to{opacity:1}}
    @keyframes uiModalPop{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
    /* Glass modal card — deliberately airier than the dashboard .card
       (more transparency + blur, a soft top sheen, an inset hairline)
       since a modal floats over a blurred backdrop rather than sitting
       in a dense data layout, so it can afford to look more "glass". */
    .ui-modal-card{
      background:linear-gradient(165deg, rgba(255,255,255,0.68), rgba(255,255,255,0.46));
      backdrop-filter:blur(28px) saturate(180%); -webkit-backdrop-filter:blur(28px) saturate(180%);
      border:1px solid rgba(255,255,255,0.85);
      box-shadow:0 20px 60px rgba(0,46,93,0.22), 0 2px 8px rgba(0,46,93,0.08),
                 inset 0 1px 0 rgba(255,255,255,0.9), inset 0 0 0 1px rgba(255,255,255,0.15);
      position:relative; overflow:hidden;
    }
    .ui-modal-card::before{
      content:''; position:absolute; inset:0; pointer-events:none; border-radius:inherit;
      background:linear-gradient(125deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 32%),
                 radial-gradient(120% 90% at 100% 0%, rgba(239,118,34,0.10) 0%, transparent 55%);
    }
    .ui-modal-card > *{ position:relative; }
    .ui-modal-card .form-input{
      background:rgba(255,255,255,0.55); border-color:rgba(0,46,93,0.14);
      transition:background .18s ease, border-color .18s ease, box-shadow .18s ease;
    }
    .ui-modal-card .form-input:focus{ background:rgba(255,255,255,0.92); }
    .ui-modal-card .toggle-row{ border-color:rgba(0,46,93,0.08); }
  `;
  document.head.appendChild(s);
})();
let _uiModalEscHandler = null;
function _closeUiModal() {
  document.getElementById('ui-modal-overlay')?.remove();
  if (_uiModalEscHandler) { document.removeEventListener('keydown', _uiModalEscHandler); _uiModalEscHandler = null; }
}
function _openUiModal(innerHtml, onMount, onEscape, maxWidth) {
  _closeUiModal();
  const overlay = document.createElement('div');
  overlay.id = 'ui-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(4,10,20,0.60);backdrop-filter:blur(10px) saturate(120%);'
    + '-webkit-backdrop-filter:blur(10px) saturate(120%);z-index:2000;display:flex;align-items:center;justify-content:center;'
    + 'padding:20px;animation:uiModalFade .15s ease both';
  // Fluid width (100% up to maxWidth) so this is naturally bigger on
  // desktop and shrinks to fit on phones — no separate mobile styling
  // needed, the overlay's own 20px padding does the rest. Plain
  // confirm/prompt messages stay compact (380px default); forms with
  // multi-column rows (formModal) ask for more room.
  overlay.innerHTML = `<div class="card ui-modal-card" style="width:100%;max-width:${maxWidth || 380}px;padding:22px;animation:uiModalPop .18s cubic-bezier(.21,1.02,.73,1) both">${innerHtml}</div>`;
  document.body.appendChild(overlay);
  _uiModalEscHandler = (e) => { if (e.key === 'Escape' && typeof onEscape === 'function') onEscape(); };
  document.addEventListener('keydown', _uiModalEscHandler);
  if (typeof onMount === 'function') onMount(overlay);
  return overlay;
}
function confirmModal(message, opts) {
  opts = opts || {};
  const danger = opts.danger !== false;
  return new Promise((resolve) => {
    function finish(val) { _closeUiModal(); resolve(val); }
    _openUiModal(`
      <div class="section-title" style="margin-bottom:8px"><i class="fa-solid ${danger ? 'fa-triangle-exclamation' : 'fa-circle-question'}"></i> ${esc(opts.title || 'Please confirm')}</div>
      <div class="small muted" style="line-height:1.55;margin-bottom:18px">${esc(message)}</div>
      <div style="display:flex;gap:8px">
        <button type="button" class="btn" style="flex:1;justify-content:center" data-act="cancel">${esc(opts.cancelLabel || 'Cancel')}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" style="flex:1;justify-content:center" data-act="ok">${esc(opts.confirmLabel || 'Confirm')}</button>
      </div>
    `, (ov) => {
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) finish(false); });
      ov.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(false));
      ov.querySelector('[data-act="ok"]').addEventListener('click', () => finish(true));
      ov.querySelector('[data-act="ok"]').focus();
    }, () => finish(false));
  });
}
function promptModal(message, opts) {
  opts = opts || {};
  const required = opts.required !== false;
  const multiline = !!opts.multiline;
  return new Promise((resolve) => {
    function finish(val) { _closeUiModal(); resolve(val); }
    // opts.value pre-fills the field for renames/edits (vs. opts.placeholder,
    // which is for fresh input) — text starts selected so typing replaces it.
    const fieldHtml = multiline
      ? `<textarea class="form-input" rows="3" placeholder="${esc(opts.placeholder || '')}" style="resize:vertical">${esc(opts.value || '')}</textarea>`
      : `<input class="form-input" type="text" placeholder="${esc(opts.placeholder || '')}" value="${esc(opts.value || '')}" />`;
    _openUiModal(`
      <div class="section-title" style="margin-bottom:8px"><i class="fa-solid fa-pen"></i> ${esc(opts.title || 'One more thing')}</div>
      ${message ? `<div class="small muted" style="line-height:1.55;margin-bottom:12px">${esc(message)}</div>` : ''}
      <div class="form-group" style="margin-bottom:6px">${fieldHtml}</div>
      <div class="small" style="color:var(--red);margin-bottom:12px;display:none" data-err>This field is required.</div>
      <div style="display:flex;gap:8px">
        <button type="button" class="btn" style="flex:1;justify-content:center" data-act="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" style="flex:1;justify-content:center" data-act="ok">${esc(opts.okLabel || 'Submit')}</button>
      </div>
    `, (ov) => {
      const field = ov.querySelector('.form-input');
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) finish(null); });
      ov.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(null));
      const submit = () => {
        const val = field.value.trim();
        if (required && !val) { ov.querySelector('[data-err]').style.display = 'block'; field.focus(); return; }
        finish(val || null);
      };
      ov.querySelector('[data-act="ok"]').addEventListener('click', submit);
      field.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) { e.preventDefault(); submit(); } });
      field.focus();
      if (opts.value) field.select();
    }, () => finish(null));
  });
}
// ── Admin "view as" banner ──
// Shown on any page when an admin is impersonating a rider/handler
// (see js/admin.js impersonate()). The admin's real token/profile are
// stashed under separate sessionStorage keys so returning doesn't
// require signing back in.
function endImpersonation() {
  const t = sessionStorage.getItem('admin_return_token');
  const p = sessionStorage.getItem('admin_return_profile');
  if (!t || !p) return;
  sessionStorage.removeItem('admin_return_token'); sessionStorage.removeItem('admin_return_profile');
  saveSession(t, JSON.parse(p));
  window.location.href = '/pages/admin.html';
}
(function renderImpersonationBanner() {
  if (!sessionStorage.getItem('admin_return_token')) return;
  const show = () => {
    const prof = getProfile();
    const bar = document.createElement('div');
    bar.style.cssText = 'position:sticky;top:0;z-index:500;display:flex;align-items:center;justify-content:center;'
      + 'gap:10px;flex-wrap:wrap;background:linear-gradient(90deg,#7a2a00,#EF7622);color:#fff;font-size:13px;'
      + 'font-weight:700;padding:8px 14px;text-align:center';
    bar.innerHTML = `<i class="fa-solid fa-eye"></i> Viewing as ${esc((prof && prof.full_name) || 'this user')}
      <button class="btn btn-sm" style="background:rgba(255,255,255,0.20);border-color:rgba(255,255,255,0.45);color:#fff" onclick="endImpersonation()">
        <i class="fa-solid fa-arrow-left"></i> Return to Admin</button>`;
    document.body.prepend(bar);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
  else show();
})();
// ── High contrast mode (mobile/PWA accessibility) ──
// Purely a local device preference (localStorage, not synced to the
// account) — solid colors, no blur, thicker borders. Scoped under
// body.theme-glass.hc in css/rider-glass.css so it only ever affects
// the mobile rider PWA, never the desktop/web portals.
function toggleHighContrast(force) {
  const on = typeof force === 'boolean' ? force : !document.body.classList.contains('hc');
  document.body.classList.toggle('hc', on);
  try { localStorage.setItem('hc_mode', on ? '1' : '0'); } catch {}
}
(function initHighContrast() {
  try { if (localStorage.getItem('hc_mode') === '1') document.body.classList.add('hc'); } catch {}
})();
// ── Shared top nav ──
// Populates any EMPTY .topnav-links with the right links for the
// signed-in user's role, so the menu bar persists when navigating
// between portals (Admin -> Dispatch -> Command Center and back —
// previously each page only had whatever nav its own HTML hardcoded,
// so it "disappeared" the moment you left admin.html).
// admin.html keeps its own hardcoded nav (Dashboard/Settings are
// in-page view switches driven by admin.js's setView(), not separate
// URLs) — this only fills in pages whose .topnav-links is still empty,
// so it never fights that markup. "Settings" from elsewhere links to
// admin.html#settings; admin.js's init() checks that hash on load.
function renderTopNav() {
  const el = document.querySelector('.topnav-links');
  if (!el || el.children.length) return;
  const prof = getProfile();
  if (!prof) return;
  const path = window.location.pathname;
  const link = (href, icon, label) =>
    `<a class="nav-item${path === href ? ' active' : ''}" href="${href}" style="text-decoration:none"><i class="fa-solid ${icon}"></i><span>${label}</span></a>`;
  let items = '';
  if (prof.role === 'admin') {
    items = link('/pages/admin.html', 'fa-gauge', 'Dashboard')
      + link('/pages/dispatch.html', 'fa-tower-broadcast', 'Dispatch')
      + link('/pages/command.html', 'fa-satellite-dish', 'Command Center')
      + link('/pages/admin.html#settings', 'fa-gear', 'Settings');
  } else if (prof.role === 'dispatch' || prof.role === 'display') {
    items = link('/pages/dispatch.html', 'fa-tower-broadcast', 'Dispatch')
      + link('/pages/command.html', 'fa-satellite-dish', 'Command Center');
  }
  if (items) el.innerHTML = items;
}
(function initTopNav() {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderTopNav);
  else renderTopNav();
})();
function formModal(title, fieldsHtml, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    function finish(val) { _closeUiModal(); resolve(val); }
    _openUiModal(`
      <div class="section-title" style="margin-bottom:14px"><i class="fa-solid ${opts.icon || 'fa-pen'}"></i> ${esc(title)}</div>
      <form id="ui-modal-form">${fieldsHtml}
        <div style="display:flex;gap:8px;margin-top:16px">
          <button type="button" class="btn" style="flex:1;justify-content:center" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" style="flex:1;justify-content:center">${esc(opts.submitLabel || 'Save')}</button>
        </div>
      </form>
    `, (ov) => {
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) finish(null); });
      ov.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(null));
      const form = ov.querySelector('#ui-modal-form');
      form.addEventListener('submit', (e) => { e.preventDefault(); finish(form); });
      ov.querySelector('input,select,textarea')?.focus();
    }, () => finish(null),
    // Forms carry two-column .form-row fields (rider/party, pickup/
    // drop-off, etc.) that feel cramped at the plain-message width —
    // give them room to breathe on desktop; the fluid width in
    // _openUiModal already takes care of shrinking it back down on phones.
    opts.wide === false ? 380 : 560);
  });
}
