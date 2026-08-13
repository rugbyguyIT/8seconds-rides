// Dispatch portal — queue, assignment, live board
const me = requireLogin('dispatch', 'admin', 'display');
let DRIVERS = [], VEHICLES = [];

async function refresh() {
  const { data: rides } = await api('/rides');
  const all = rides || [];
  const queue = all.filter(r => r.status === 'requested');
  const toAssign = all.filter(r => r.status === 'approved');
  const live = all.filter(r => ['assigned', 'en_route', 'arrived', 'in_progress'].includes(r.status));

  document.getElementById('stat-pending').textContent = queue.length;
  document.getElementById('stat-assign').textContent = toAssign.length;
  document.getElementById('stat-live').textContent = live.length;

  const canAct = me.role !== 'display';
  document.getElementById('queue').innerHTML = queue.length ? queue.map(r => `
    <tr><td class="mono">${esc(fmtWhen(r.scheduled_at))}</td>
        <td><b>${esc(r.enduser_name)}</b><div class="small muted">req ${esc(fmtWhen(r.created_at))}</div></td>
        <td><span class="class-chip ${CLASS_CHIP[r.enduser_class] || 'class-vip'}">${esc(r.enduser_class || 'guest')}</span></td>
        <td class="small">${rideRoute(r)}${r.round_trip ? ' <span class="badge badge-neutral">RT</span>' : ''}</td>
        <td>${r.party_size}${r.ada_required ? ' <span class="badge badge-review">ADA</span>' : ''}</td>
        <td style="text-align:right;white-space:nowrap">${canAct ? `
          <button class="btn btn-success btn-sm" onclick="rideAction('${r.id}','approve')"><i class="fa-solid fa-check"></i> Approve</button>
          <button class="btn btn-danger btn-sm" onclick="rideAction('${r.id}','deny')"><i class="fa-solid fa-xmark"></i></button>` : ''}</td></tr>`).join('')
    : '<tr><td colspan="6" class="small muted">Queue is clear.</td></tr>';

  document.getElementById('assign').innerHTML = toAssign.length ? toAssign.map(r => `
    <tr><td class="mono">${esc(fmtWhen(r.scheduled_at))}</td>
        <td><b>${esc(r.enduser_name)}</b></td>
        <td class="small">${rideRoute(r)}</td>
        <td><select class="form-input" style="width:auto;display:inline-block" id="drv-${r.id}">
              ${DRIVERS.map(d => `<option value="${d.id}">${esc(d.full_name)}</option>`).join('')}</select>
            <select class="form-input" style="width:auto;display:inline-block" id="veh-${r.id}">
              ${VEHICLES.filter(v => v.active).map(v => `<option value="${v.id}">${esc(v.label)} (${v.capacity})</option>`).join('')}</select></td>
        <td style="text-align:right">${canAct ? `<button class="btn btn-primary btn-sm" onclick="assignRide('${r.id}')"><i class="fa-solid fa-link"></i> Assign</button>` : ''}</td></tr>`).join('')
    : '<tr><td colspan="5" class="small muted">Nothing waiting for a vehicle.</td></tr>';

  document.getElementById('live').innerHTML = live.length ? live.map(r => `
    <tr><td class="mono">${r.id.slice(0, 8)}</td>
        <td>${esc(r.enduser_name)}</td>
        <td class="small">${esc(r.driver_name || '—')} · ${esc(r.vehicle_label || '')}</td>
        <td><span class="badge ${(STATUS_META[r.status] || {}).badge}">${(STATUS_META[r.status] || {}).label}</span></td>
        <td class="small">${rideRoute(r)}</td>
        <td style="text-align:right">${canAct ? `
          <button class="btn btn-sm" onclick="reassignPrompt('${r.id}')"><i class="fa-solid fa-shuffle"></i></button>
          <button class="btn btn-danger btn-sm" onclick="rideAction('${r.id}','${r.status === 'assigned' ? 'cancel' : 'cancel_active'}')">Cancel</button>` : ''}</td></tr>`).join('')
    : '<tr><td colspan="6" class="small muted">No rides in motion.</td></tr>';
}

async function assignRide(id) {
  const driver_id = document.getElementById('drv-' + id).value;
  const vehicle_id = document.getElementById('veh-' + id).value;
  await rideAction(id, 'assign', { driver_id, vehicle_id });
}

async function reassignPrompt(id) {
  const activeVehicles = VEHICLES.filter(v => v.active);
  const form = await formModal('Reassign ride', `
    <div class="form-group"><label class="form-label">Driver</label>
      <select class="form-input" name="driver_id" required>
        <option value="">Choose a driver…</option>
        ${DRIVERS.map(d => `<option value="${d.id}">${esc(d.full_name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label class="form-label">Vehicle</label>
      <select class="form-input" name="vehicle_id" required>
        <option value="">Choose a vehicle…</option>
        ${activeVehicles.map(v => `<option value="${v.id}">${esc(v.label)}</option>`).join('')}
      </select>
    </div>
  `, { icon: 'fa-shuffle', submitLabel: 'Reassign' });
  if (!form || !form.driver_id.value || !form.vehicle_id.value) return;
  rideAction(id, 'assign', { driver_id: form.driver_id.value, vehicle_id: form.vehicle_id.value });
}

(async function init() {
  document.getElementById('user-name').textContent = me.full_name;
  const [{ data: drivers }, { data: vehicles }] = await Promise.all([api('/profiles?role=driver'), api('/vehicles')]);
  DRIVERS = drivers || []; VEHICLES = vehicles || [];
  refresh();
  setInterval(refresh, 10000);
  if (typeof initPushNotifications === 'function') initPushNotifications();
})();
