// Admin portal — users, handler links, vehicles, settings, logging
const me = requireLogin('admin');
let USERS = [], VEHICLES = [];
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
          <button class="btn btn-sm" onclick="renameUser('${u.id}','${esc(u.first_name)}','${esc(u.last_name)}')" title="Edit name"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-sm" onclick="resetPw('${u.id}','${esc(u.full_name)}')" title="Reset password"><i class="fa-solid fa-key"></i></button>
          <button class="btn btn-sm" onclick="forceLogout('${u.id}','${esc(u.full_name)}')" title="Sign out everywhere"><i class="fa-solid fa-right-from-bracket"></i></button>
          <button class="btn btn-danger btn-sm" onclick="toggleActive('${u.id}','${u.status}')">${u.status === 'active' ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('');

  document.getElementById('links').innerHTML = (links || []).filter(l => l.active).map(l =>
    `<tr><td>${esc(l.handler_name)}</td><td><i class="fa-solid fa-arrow-right-long muted"></i></td><td>${esc(l.enduser_name)}</td>
     <td style="text-align:right"><button class="btn btn-danger btn-sm" onclick="unlink('${l.id}')">Remove</button></td></tr>`).join('')
    || '<tr><td colspan="4" class="small muted">No handler assignments yet.</td></tr>';

  const hs = USERS.filter(u => u.role === 'handler'), rs = USERS.filter(u => u.role === 'rider');
  document.getElementById('link-handler').innerHTML = hs.map(h => `<option value="${h.id}">${esc(h.full_name)}</option>`).join('');
  document.getElementById('link-rider').innerHTML = rs.map(r => `<option value="${r.id}">${esc(r.full_name)}</option>`).join('');

  document.getElementById('vehicles').innerHTML = VEHICLES.map(v => `
    <tr><td><b>${esc(v.label)}</b> <span class="small muted">${esc(v.color_desc || '')}</span></td>
        <td class="mono small">${esc(v.plate || '—')}</td><td>${v.capacity}</td>
        <td><span class="badge badge-neutral">${esc(v.class)}</span></td>
        <td><span class="badge ${v.active ? 'badge-approved' : 'badge-no'}">${v.active ? 'active' : 'retired'}</span></td>
        <td style="text-align:right"><button class="btn btn-danger btn-sm" onclick="toggleVehicle('${v.id}',${v.active})">${v.active ? 'Retire' : 'Restore'}</button></td></tr>`).join('');
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
async function renameUser(id, first, last) {
  const nf = prompt('First name:', first);
  if (nf === null) return;
  const nl = prompt('Last name:', last);
  if (nl === null) return;
  const { error } = await api('/profiles/' + id, 'PATCH', { first_name: nf.trim(), last_name: nl.trim() });
  if (error) return toastMsg('Could not rename', error);
  toastMsg('Name updated', `${nf} ${nl}`); refresh();
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
async function resetPw(id, name) {
  const pw = prompt(`New password for ${name} (dispatch/admin only):`);
  if (!pw) return;
  const { error } = await api('/profiles/' + id, 'PATCH', { password: pw });
  toastMsg(error ? 'Failed' : 'Password set', error || name);
}
async function forceLogout(id, name) {
  if (!confirm(`Sign ${name} out of every device?`)) return;
  await api('/profiles/' + id, 'PATCH', { force_logout: true });
  toastMsg('Signed out everywhere', name);
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
  pwRow.style.display = ['dispatch', 'admin'].includes(sel.value) ? '' : 'none';
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
    document.getElementById('s-app-theme').value = settings.app_theme || 'classic';
    document.getElementById('s-pilot-mode').checked = !!settings.pilot_mode;
    document.getElementById('s-updated').textContent = settings.updated_at
      ? `Last updated ${fmtWhen(settings.updated_at)}` : '';
  }
  await Promise.all([loadAuditLogs(), loadAppLogs(null)]);
}

async function saveAppSettings(ev) {
  ev.preventDefault();
  const f = ev.target;
  const body = {
    org_display_name: f.org_display_name.value,
    support_phone: f.support_phone.value || null,
    support_email: f.support_email.value || null,
    sms_sender_label: f.sms_sender_label.value,
    app_theme: f.app_theme.value,
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
  a.download = `8SecondsRides_Audit_${new Date().toISOString().slice(0, 10)}.csv`;
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
  refresh();
  if (typeof initPushNotifications === 'function') initPushNotifications();
})();
