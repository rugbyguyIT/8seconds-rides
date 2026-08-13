// Admin portal — users, handler links, vehicles, settings, logging
const me = requireLogin('admin');
let USERS = [], VEHICLES = [], VCLASSES = [], LOCS = [];
const LEVEL_BADGE = { info: 'badge-neutral', warn: 'badge-pending', error: 'badge-no' };

// ── View switching (Dashboard / Settings) ───────────────────────
const VIEW_TITLES = {
  dashboard: ['Admin', 'Users, fleet, and system settings'],
  settings:  ['Settings', 'App configuration, security audit log, and application logs'],
};
function setView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + id));
  document.querySelectorAll('.topnav .nav-item').forEach(n => n.classList.toggle('active', n.id === 'nav-' + id));
  const [title, sub] = VIEW_TITLES[id] || ['', ''];
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-sub').textContent = sub;
  if (id === 'settings') loadSettingsView();
}

async function refresh() {
  const [{ data: users }, { data: vehicles }, { data: links }] =
    await Promise.all([api('/profiles'), api('/vehicles'), api('/handler-assignments')]);
  USERS = users || []; VEHICLES = vehicles || [];

  document.getElementById('users').innerHTML = USERS.map(u => `
    <tr><td><b>${esc(u.full_name)}</b><div class="small muted">${esc(u.email)}</div></td>
        <td><span class="badge badge-neutral">${esc(u.role)}</span>
            ${u.enduser_class ? `<span class="class-chip ${CLASS_CHIP[u.enduser_class] || 'class-vip'}">${esc(u.enduser_class)}</span>` : ''}</td>
        <td class="small mono">${esc(u.phone_mobile || '—')}</td>
        <td><span class="badge ${u.status === 'active' ? 'badge-approved' : 'badge-no'}">${esc(u.status)}</span></td>
        <td style="text-align:right;white-space:nowrap">
          ${['rider', 'handler'].includes(u.role) ? `<button class="btn btn-sm" onclick="impersonate('${u.id}')" title="View as this user"><i class="fa-solid fa-eye"></i></button>` : ''}
          <button class="btn btn-sm" onclick="renameUser('${u.id}')" title="Edit name"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-sm" onclick="resetPw('${u.id}')" title="Reset password"><i class="fa-solid fa-key"></i></button>
          <button class="btn btn-sm" onclick="forceLogout('${u.id}')" title="Sign out everywhere"><i class="fa-solid fa-right-from-bracket"></i></button>
          <button class="btn btn-danger btn-sm" onclick="toggleActive('${u.id}','${u.status}')">${u.status === 'active' ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('');

  document.getElementById('links').innerHTML = (links || []).filter(l => l.active).map(l =>
    `<tr><td>${esc(l.handler_name)}</td><td><i class="fa-solid fa-arrow-right-long muted"></i></td><td>${esc(l.enduser_name)}</td>
     <td style="text-align:right"><button class="btn btn-danger btn-sm" onclick="unlink('${l.id}')">Remove</button></td></tr>`).join('')
    || '<tr><td colspan="4" class="small muted">No handler assignments yet.</td></tr>';

  const hs = USERS.filter(u => u.role === 'handler'), rs = USERS.filter(u => u.role === 'rider');
  document.getElementById('link-handler').innerHTML = hs.map(h => `<option value="${h.id}">${esc(h.full_name)}</option>`).join('');
  document.getElementById('link-rider').innerHTML = rs.map(r => `<option value="${r.id}">${esc(r.full_name)}</option>`).join('');
  const riderSel = document.querySelector('[name=rider]');
  if (riderSel) riderSel.innerHTML = rs.length
    ? rs.map(r => `<option value="${r.id}">${esc(r.full_name)}${r.enduser_class ? ' — ' + esc(r.enduser_class) : ''}</option>`).join('')
    : '<option value="">No riders yet — create one first</option>';

  document.getElementById('vehicles').innerHTML = VEHICLES.map(v => `
    <tr><td style="display:flex;align-items:center;gap:9px">
          <img src="${esc(v.photo_url || classPhoto(v.class) || '')}" onerror="this.style.visibility='hidden'"
               style="width:34px;height:34px;border-radius:8px;object-fit:cover;background:var(--surface3);flex-shrink:0" />
          <div><b>${esc(v.label)}</b> <span class="small muted">${esc(v.color_desc || '')}</span></div></td>
        <td class="mono small">${esc(v.plate || '—')}</td><td>${v.capacity}</td>
        <td><span class="badge badge-neutral">${esc(classLabel(v.class))}</span></td>
        <td><span class="badge ${v.active ? 'badge-approved' : 'badge-no'}">${v.active ? 'active' : 'retired'}</span></td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-sm" onclick="openPhotoModal('vehicle','${v.id}','${esc(v.label)}')" title="Vehicle photo"><i class="fa-solid fa-camera"></i></button>
          <button class="btn btn-danger btn-sm" onclick="toggleVehicle('${v.id}',${v.active})">${v.active ? 'Retire' : 'Restore'}</button></td></tr>`).join('');
}

function classLabel(key) { return VCLASSES.find(c => c.key === key)?.label || key; }
function classPhoto(key) { return VCLASSES.find(c => c.key === key)?.photo_url || null; }

async function loadVehicleClasses() {
  const { data } = await api('/vehicle-classes');
  VCLASSES = data || [];
  const sel = document.querySelector('[name=vclass]');
  if (sel) { sel.innerHTML = VCLASSES.map(c => `<option value="${esc(c.key)}">${esc(c.label)}</option>`).join(''); vclassChanged(sel); }
  renderVehicleClasses();
}

function renderVehicleClasses() {
  const el = document.getElementById('vclass-rows');
  if (!el) return;
  el.innerHTML = VCLASSES.length ? VCLASSES.map(c => `
    <tr><td style="display:flex;align-items:center;gap:9px">
          <img src="${esc(c.photo_url || '')}" onerror="this.style.visibility='hidden'"
               style="width:34px;height:34px;border-radius:8px;object-fit:cover;background:var(--surface3);flex-shrink:0" />
          <div><b>${esc(c.label)}</b><div class="small mono muted">${esc(c.key)}</div></div></td>
        <td class="small muted" style="white-space:nowrap"><i class="fa-solid fa-chair"></i> ${c.default_capacity || 6} seats</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-sm" onclick="editClassCapacity('${c.id}')" title="Edit seats"><i class="fa-solid fa-chair"></i></button>
          <button class="btn btn-sm" onclick="openPhotoModal('class','${c.id}','${esc(c.label)}')" title="Class photo"><i class="fa-solid fa-camera"></i></button>
          <button class="btn btn-danger btn-sm" onclick="toggleClassActive('${c.id}',${c.active})">${c.active ? 'Retire' : 'Restore'}</button></td></tr>`).join('')
    : '<tr><td colspan="3" class="small muted">No vehicle classes yet.</td></tr>';
}

async function createVehicleClass(ev) {
  ev.preventDefault();
  const f = ev.target;
  const { error } = await api('/vehicle-classes', 'POST',
    { key: f.class_key.value, label: f.class_label.value, default_capacity: parseInt(f.class_capacity.value, 10) || 6 });
  if (error) return toastMsg('Could not add class', error);
  toastMsg('Vehicle class added', f.class_label.value); f.reset(); loadVehicleClasses();
}

async function toggleClassActive(id, active) {
  await api('/vehicle-classes/' + id, 'PATCH', { active: !active }); loadVehicleClasses();
}

async function editClassCapacity(id) {
  const c = VCLASSES.find(x => x.id === id);
  if (!c) return;
  const val = await promptModal('How many riders can this vehicle class seat, not counting the driver?',
    { title: `Seats — ${c.label}`, placeholder: 'e.g. 6', okLabel: 'Save' });
  if (!val) return;
  const cap = parseInt(val, 10);
  if (!Number.isFinite(cap) || cap < 1) return toastMsg('Not saved', 'Enter a whole number of 1 or more.');
  const { error } = await api('/vehicle-classes/' + id, 'PATCH', { default_capacity: cap });
  if (error) return toastMsg('Could not save', error);
  toastMsg('Seats updated', `${c.label}: ${cap}`); loadVehicleClasses();
}

// The Add-vehicle form's capacity field defaults to whatever the
// selected class normally seats, so admins only override it for a
// specific vehicle that's different from the rest of its class.
function vclassChanged(sel) {
  const c = VCLASSES.find(x => x.key === sel.value);
  const capField = document.querySelector('[name=capacity]');
  if (c && capField) capField.value = c.default_capacity || 6;
}

// Upload-or-generate photo modal, shared by vehicle classes and individual
// vehicles (same {mode,...} contract server-side, different route/table).
function openPhotoModal(kind, id, label) {
  const endpoint = kind === 'class' ? `/vehicle-classes/${id}/photo` : `/vehicles/${id}/photo`;
  openModal(`Photo — ${label}`, `
    <div class="form-group"><label class="form-label">Upload a photo</label>
      <input class="form-input" type="file" name="photo_file" accept="image/*" /></div>
    <div class="small muted" style="margin:2px 0 12px">— or —</div>
    <div class="form-group"><label class="form-label">Generate with AI (describe the vehicle)</label>
      <input class="form-input" name="photo_prompt" placeholder="e.g. white Chevrolet Suburban SUV" /></div>
  `, async (f) => {
    let body;
    if (f.photo_file.files[0]) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(f.photo_file.files[0]);
      });
      body = { mode: 'upload', data_url: dataUrl };
    } else if (f.photo_prompt.value.trim()) {
      body = { mode: 'generate', prompt: f.photo_prompt.value.trim() };
    } else {
      return toastMsg('Nothing to save', 'Choose a file or enter a description to generate one');
    }
    toastMsg('Saving photo…', 'This can take a few seconds for AI generation.');
    const { error } = await api(endpoint, 'POST', body);
    if (error) return toastMsg('Could not save photo', error);
    toastMsg('Photo saved', label);
    if (kind === 'class') loadVehicleClasses(); else refresh();
  });
}

async function submitAdminRide(ev) {
  ev.preventDefault();
  const f = ev.target;
  if (!f.rider.value) return toastMsg('Pick a rider first', 'Choose who this ride is for.');
  const body = {
    enduser_id: f.rider.value,
    pickup_location_id: f.pickup.value || null, dropoff_location_id: f.dropoff.value || null,
    pickup_text: f.pickup.value ? null : f.pickup_text.value || null,
    dropoff_text: f.dropoff.value ? null : f.dropoff_text.value || null,
    scheduled_at: f.when.value ? new Date(f.when.value).toISOString() : null,
    party_size: parseInt(f.party.value, 10), round_trip: f.round_trip.checked,
    ada_required: f.ada.checked, notes: f.notes.value || null,
  };
  const { error } = await api('/rides', 'POST', body);
  if (error) return toastMsg('Could not create ride', error);
  toastMsg('Ride created', 'Dispatch has been notified.');
  f.pickup_text.value = ''; f.dropoff_text.value = ''; f.pickup.value = ''; f.dropoff.value = '';
  f.when.value = ''; f.notes.value = ''; f.round_trip.checked = false; f.ada.checked = false;
}

// Admin "view as" a rider or handler — mints that user's real session and
// switches into it, stashing the admin's own token so they can return
// via the banner rides-ui.js shows on every portal page while active.
async function impersonate(id) {
  const u = USERS.find(x => x.id === id);
  if (!u) return;
  const ok = await confirmModal(`View the app as ${u.full_name} (${u.role})? You can return to Admin at any time.`,
    { title: 'View as user', danger: false, confirmLabel: 'View as' });
  if (!ok) return;
  const { data, error } = await api(`/profiles/${id}/impersonate`, 'POST');
  if (error) return toastMsg('Could not view as user', error);
  sessionStorage.setItem('admin_return_token', getToken());
  sessionStorage.setItem('admin_return_profile', JSON.stringify(getProfile()));
  saveSession(data.token, data.profile);
  window.location.href = data.portal;
}

async function createUser(ev) {
  ev.preventDefault();
  const f = ev.target;
  const body = { email: f.email.value, first_name: f.first_name.value, last_name: f.last_name.value, role: f.role.value,
                 phone_mobile: f.phone.value || null, enduser_class: f.uclass.value || null,
                 password: f.password.value || null, sms_consent: f.sms.checked, photo_url: f.photo.value || null };
  const { error } = await api('/profiles', 'POST', body);
  if (error) { appLog('warn', 'admin.create_user_failed', error); return toastMsg('Could not create user', error); }
  toastMsg('User created', `${body.first_name} ${body.last_name} (${body.role}) can now sign in.`);
  f.reset(); refresh();
}
// Small inline modal — chained window.prompt() calls are unreliable
// (browsers frequently suppress the second dialog when two fire back
// to back), so name edits get a real two-field form instead.
function openModal(title, fieldsHtml, onSave) {
  document.getElementById('modal-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,10,25,0.55);backdrop-filter:blur(4px);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `<div class="card" style="width:100%;max-width:360px;padding:20px">
    <div class="section-title" style="margin-bottom:14px">${esc(title)}</div>
    <form id="modal-form">${fieldsHtml}
      <div style="display:flex;gap:8px;margin-top:16px">
        <button type="button" class="btn btn-sm" style="flex:1;justify-content:center" onclick="document.getElementById('modal-overlay').remove()">Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm" style="flex:1;justify-content:center">Save</button>
      </div>
    </form>
  </div>`;
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  document.getElementById('modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await onSave(e.target);
    document.getElementById('modal-overlay')?.remove();
  });
  overlay.querySelector('input')?.focus();
}

async function renameUser(id) {
  const u = USERS.find(x => x.id === id);
  if (!u) return;
  openModal('Edit name', `
    <div class="form-group"><label class="form-label">First name</label><input class="form-input" name="first_name" value="${esc(u.first_name)}" required /></div>
    <div class="form-group"><label class="form-label">Last name</label><input class="form-input" name="last_name" value="${esc(u.last_name)}" required /></div>
  `, async (f) => {
    const { error } = await api('/profiles/' + id, 'PATCH', { first_name: f.first_name.value.trim(), last_name: f.last_name.value.trim() });
    if (error) return toastMsg('Could not rename', error);
    toastMsg('Name updated', `${f.first_name.value} ${f.last_name.value}`); refresh();
  });
}
async function createVehicle(ev) {
  ev.preventDefault();
  const f = ev.target;
  const { error } = await api('/vehicles', 'POST',
    { label: f.label.value, plate: f.plate.value || null, capacity: parseInt(f.capacity.value, 10) || 6,
      vclass: f.vclass.value, color_desc: f.color.value || null });
  if (error) return toastMsg('Could not add vehicle', error);
  toastMsg('Vehicle added', f.label.value); f.reset(); refresh();
}
async function linkHandler(ev) {
  ev.preventDefault();
  const { error } = await api('/handler-assignments', 'POST',
    { handler_id: document.getElementById('link-handler').value, enduser_id: document.getElementById('link-rider').value });
  if (error) return toastMsg('Could not link', error);
  toastMsg('Handler linked', 'They can now schedule for that rider.'); refresh();
}
async function unlink(id) { await api('/handler-assignments/' + id, 'DELETE'); refresh(); }
async function resetPw(id) {
  const u = USERS.find(x => x.id === id);
  if (!u) return;
  const pw = await promptModal('Visible to dispatch/admin only.', { title: `New password for ${u.full_name}`, placeholder: 'New password', required: true, okLabel: 'Set password' });
  if (!pw) return;
  const { error } = await api('/profiles/' + id, 'PATCH', { password: pw });
  toastMsg(error ? 'Failed' : 'Password set', error || u.full_name);
}
async function forceLogout(id) {
  const u = USERS.find(x => x.id === id);
  if (!u) return;
  const ok = await confirmModal(`Sign ${u.full_name} out of every device?`, { title: 'Force sign-out', confirmLabel: 'Sign out everywhere' });
  if (!ok) return;
  await api('/profiles/' + id, 'PATCH', { force_logout: true });
  toastMsg('Signed out everywhere', u.full_name);
}
async function toggleActive(id, status) {
  await api('/profiles/' + id, 'PATCH', { status: status === 'active' ? 'inactive' : 'active' });
  refresh();
}
async function toggleVehicle(id, active) {
  await api('/vehicles/' + id, 'PATCH', { active: !active }); refresh();
}
function roleChanged(sel) {
  const pwRow = document.getElementById('pw-row');
  pwRow.style.display = ['dispatch', 'admin', 'display'].includes(sel.value) ? '' : 'none';
  document.getElementById('pw-row-label').textContent = sel.value === 'display'
    ? 'Kiosk PIN (used to sign in at /pages/kiosk.html)' : 'Password (dispatch/admin only)';
  document.getElementById('class-row').style.display = sel.value === 'rider' ? '' : 'none';
}

// ── Settings view ────────────────────────────────────────────────
let AUDIT_LOGS = [];

async function loadSettingsView() {
  const { data: settings, error: sErr } = await api('/app-settings');
  if (!sErr && settings) {
    document.getElementById('s-org-name').value = settings.org_display_name || '';
    document.getElementById('s-support-phone').value = settings.support_phone || '';
    document.getElementById('s-support-email').value = settings.support_email || '';
    document.getElementById('s-sms-label').value = settings.sms_sender_label || '';
    document.getElementById('s-pilot-mode').checked = !!settings.pilot_mode;
    document.getElementById('s-updated').textContent = settings.updated_at
      ? `Last updated ${fmtWhen(settings.updated_at)}` : '';
  }
  await Promise.all([loadAuditLogs(), loadAppLogs(null), loadVehicleClasses()]);
}

async function saveAppSettings(ev) {
  ev.preventDefault();
  const f = ev.target;
  const body = {
    org_display_name: f.org_display_name.value,
    support_phone: f.support_phone.value || null,
    support_email: f.support_email.value || null,
    sms_sender_label: f.sms_sender_label.value,
    pilot_mode: f.pilot_mode.checked,
  };
  const { error } = await api('/app-settings', 'PATCH', body);
  if (error) { appLog('warn', 'admin.save_settings_failed', error); return toastMsg('Could not save settings', error); }
  toastMsg('Settings saved', 'Applies app-wide.');
  loadSettingsView();
}

async function loadAuditLogs() {
  const { data } = await api('/audit-logs?limit=200');
  AUDIT_LOGS = data || [];
  document.getElementById('audit-rows').innerHTML = AUDIT_LOGS.length
    ? AUDIT_LOGS.map(l => `
      <tr><td class="small mono">${esc(fmtWhen(l.created_at))}</td>
          <td class="small">${esc(l.full_name || l.email || '—')}</td>
          <td><span class="badge ${l.action && l.action.includes('failed') ? 'badge-no' : 'badge-approved'}">${esc(l.action || '')}</span></td>
          <td class="small mono">${esc(l.ip_address || '—')}</td>
          <td class="small muted">${esc(l.detail || '')}</td></tr>`).join('')
    : '<tr><td colspan="5" class="small muted">No security events logged yet.</td></tr>';
}

function exportAuditCSV() {
  if (!AUDIT_LOGS.length) return toastMsg('Nothing to export', 'No audit data yet');
  const rows = AUDIT_LOGS.map(l => [l.created_at, l.full_name || '', l.email || '', l.action || '', l.ip_address || '', (l.detail || '').replace(/"/g, '""')]);
  const csv = ['When,Name,Email,Action,IP,Detail', ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `8SecondRides_Audit_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
  toastMsg('Audit log exported', 'CSV downloaded');
}

async function loadAppLogs(level) {
  const { data } = await api('/app-logs' + (level ? '?level=' + level : '?limit=200'));
  const logs = data || [];
  document.getElementById('applog-rows').innerHTML = logs.length
    ? logs.map(l => `
      <tr><td class="small mono">${esc(fmtWhen(l.created_at))}</td>
          <td><span class="badge ${LEVEL_BADGE[l.level] || 'badge-neutral'}">${esc(l.level)}</span></td>
          <td class="small">${esc(l.event)}</td>
          <td class="small muted">${esc(l.full_name || l.email || '—')}</td>
          <td class="small muted" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.detail || '')}">${esc(l.detail || '')}</td></tr>`).join('')
    : '<tr><td colspan="5" class="small muted">No application logs for this filter.</td></tr>';
}

(async function init() {
  document.getElementById('user-name').textContent = me.full_name;
  loadVehicleClasses(); // populates the Add-vehicle class dropdown even before Settings is opened
  const { data: locs } = await api('/locations');
  LOCS = locs || [];
  const pickupSel = document.querySelector('[name=pickup]'), dropoffSel = document.querySelector('[name=dropoff]');
  if (pickupSel) pickupSel.innerHTML = locationOptions(LOCS, 'Choose a pickup point…');
  if (dropoffSel) dropoffSel.innerHTML = locationOptions(LOCS, 'Choose a destination…');
  refresh();
  // Nav links elsewhere point Settings at admin.html#settings since it's
  // an in-page view, not its own URL — land there directly on load.
  if (window.location.hash === '#settings') setView('settings');
  if (typeof initPushNotifications === 'function') initPushNotifications();
})();
