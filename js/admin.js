// Admin portal — users, handler links, vehicles, system
const me = requireLogin('admin');
let USERS = [], VEHICLES = [];

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
          <button class="btn btn-sm" onclick="resetPw('${u.id}','${esc(u.full_name)}')"><i class="fa-solid fa-key"></i></button>
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
  const body = { email: f.email.value, full_name: f.full_name.value, role: f.role.value,
                 phone_mobile: f.phone.value || null, enduser_class: f.uclass.value || null,
                 password: f.password.value || null, sms_consent: f.sms.checked, photo_url: f.photo.value || null };
  const { error } = await api('/profiles', 'POST', body);
  if (error) return toastMsg('Could not create user', error);
  toastMsg('User created', `${body.full_name} (${body.role}) can now sign in.`);
  f.reset(); refresh();
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

(async function init() {
  document.getElementById('user-name').textContent = me.full_name;
  refresh();
  if (typeof initPushNotifications === 'function') initPushNotifications();
})();
