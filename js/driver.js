// Driver portal — assigned pickups, state buttons, position pings, issue alerts
const me = requireLogin('driver');
let ACTIVE = null, pingTimer = null, MY_VEHICLE = null;

const NEXT_ACTION = {
  assigned:    { action: 'start',    label: 'START DRIVE',        icon: 'fa-play', cls: '' },
  en_route:    { action: 'arrive',   label: 'ARRIVED AT PICKUP',  icon: 'fa-location-dot', cls: 'navy' },
  arrived:     { action: 'pickup',   label: 'PASSENGER ON BOARD', icon: 'fa-user-check', cls: '' },
  in_progress: { action: 'complete', label: 'COMPLETE DROP-OFF',  icon: 'fa-flag-checkered', cls: 'green' },
};

async function refresh() {
  const { data: rides } = await api('/rides?status=assigned,en_route,arrived,in_progress');
  const list = rides || [];
  ACTIVE = list.find(r => ['en_route', 'arrived', 'in_progress'].includes(r.status)) || list[0] || null;
  const upNext = list.filter(r => r !== ACTIVE);

  const box = document.getElementById('active');
  if (!ACTIVE) {
    box.innerHTML = '<div class="card card-sm small muted">No pickups assigned right now. Dispatch will push you the next one.</div>';
  } else {
    const na = NEXT_ACTION[ACTIVE.status];
    const cls = CLASS_CHIP[ACTIVE.enduser_class] || 'class-vip';
    box.innerHTML = `<div class="card" style="border:1.5px solid rgba(239,118,34,0.40)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span class="badge badge-live"><i class="fa-solid fa-circle"></i> ${(STATUS_META[ACTIVE.status] || {}).label || ACTIVE.status}</span>
        <span class="mono small muted">${ACTIVE.id.slice(0, 8)}</span></div>
      <div style="margin-top:12px">
        <div class="event-title" style="font-size:var(--fs-lg)">${esc(ACTIVE.enduser_name)}
          <span class="class-chip ${cls}">${esc(ACTIVE.enduser_class || 'guest')}</span></div>
        <div class="route-line" style="margin-top:8px">
          <span class="route-dot" style="background:var(--green)"></span> ${esc(ACTIVE.pickup_name || ACTIVE.pickup_text || '?')}
          <i class="fa-solid fa-arrow-right-long route-arrow"></i>
          <span class="route-dot" style="background:var(--red)"></span> ${esc(ACTIVE.dropoff_name || ACTIVE.dropoff_text || '?')}</div>
        <div class="event-meta" style="margin-top:8px">${rideMeta(ACTIVE)}</div></div>
      ${na ? `<div style="margin-top:16px">
        <button class="drive-action ${na.cls}" onclick="advance('${ACTIVE.id}','${na.action}')">
          <i class="fa-solid ${na.icon}"></i> ${na.label}</button></div>` : ''}
      ${ACTIVE.status !== 'assigned' ? `<div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-danger" style="flex:1;justify-content:center" onclick="sendAlert('${ACTIVE.id}','vehicle')"><i class="fa-solid fa-car-burst"></i> Vehicle issue</button>
        <button class="btn" style="flex:1;justify-content:center" onclick="sendAlert('${ACTIVE.id}','traffic')"><i class="fa-solid fa-traffic-light"></i> Heavy traffic</button></div>
        ${ACTIVE.status === 'arrived' ? `<button class="btn btn-danger btn-sm" style="margin-top:10px" onclick="rideAction('${ACTIVE.id}','no_show',null,'Mark as no-show? Wait at least 10 minutes first.')">No-show</button>` : ''}` : ''}
    </div>`;
  }
  document.getElementById('upnext').innerHTML = upNext.map(r =>
    rideCard(r, '', esc(r.enduser_name))).join('') ||
    (ACTIVE ? '' : '');
  managePings();
}

async function advance(id, action) { await rideAction(id, action); }

async function sendAlert(id, kind) {
  const note = await promptModal('', {
    title: kind === 'vehicle' ? 'Vehicle issue' : 'Heavy traffic',
    placeholder: kind === 'vehicle' ? 'What is wrong with the vehicle?' : 'Where are you stuck? (optional)',
    required: kind === 'vehicle', okLabel: 'Alert dispatch',
  });
  if (note === null && kind === 'vehicle') return;
  const { error } = await api(`/rides/${id}/action`, 'POST', { action: 'alert', alert_kind: kind, note: note || '' });
  if (error) return toastMsg('Could not send', error);
  toastMsg('Dispatch alerted', 'The rider and their handler got a soft heads-up. Dispatch will follow up.');
}

// ── My vehicle — self-service plate, HLSR hang tag, and photo for
// whichever vehicle is persistently assigned to this driver (set by
// admin under Admin → Drivers, or by the driver here once assigned).
// GET /vehicles is open to any signed-in role; filter to "mine" client-side.
async function refreshVehicle() {
  const { data: vehicles } = await api('/vehicles');
  MY_VEHICLE = (vehicles || []).find(v => v.driver_id === me.id) || null;
  renderVehicle();
}

function renderVehicle() {
  const el = document.getElementById('my-vehicle');
  if (!el) return;
  if (!MY_VEHICLE) {
    el.innerHTML = '<div class="card card-sm small muted">No vehicle assigned yet — ask dispatch or admin to assign you one.</div>';
    return;
  }
  const v = MY_VEHICLE;
  el.innerHTML = `<div class="card" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
    <img src="${esc(v.photo_url || '')}" onerror="this.style.visibility='hidden'"
         style="width:76px;height:76px;border-radius:12px;object-fit:cover;background:var(--surface3);flex-shrink:0" />
    <div style="flex:1;min-width:180px">
      <div style="font-weight:700">${esc(v.label)}</div>
      <div class="small muted" style="margin-top:4px">Plate: <span class="mono">${esc(v.plate || '—')}</span></div>
      <div class="small muted">HLSR hang tag: <span class="mono">${esc(v.hang_tag || '—')}</span></div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-sm" onclick="editMyVehiclePhoto()" title="Vehicle photo"><i class="fa-solid fa-camera"></i></button>
      <button class="btn btn-sm" onclick="editMyVehicleDetails()" title="Plate / hang tag"><i class="fa-solid fa-pen"></i></button>
    </div>
  </div>`;
}

async function editMyVehicleDetails() {
  if (!MY_VEHICLE) return;
  const f = await formModal('My vehicle', `
    <div class="form-group"><label class="form-label">Plate</label><input class="form-input" name="plate" value="${esc(MY_VEHICLE.plate || '')}" /></div>
    <div class="form-group"><label class="form-label">HLSR hang tag number</label><input class="form-input" name="hang_tag" value="${esc(MY_VEHICLE.hang_tag || '')}" /></div>
  `, { icon: 'fa-car', submitLabel: 'Save', wide: false });
  if (!f) return;
  const { error } = await api('/vehicles/' + MY_VEHICLE.id, 'PATCH', { plate: f.plate.value.trim() || null, hang_tag: f.hang_tag.value.trim() || null });
  if (error) return toastMsg('Could not save', error);
  toastMsg('Vehicle updated', 'Saved'); refreshVehicle();
}

// Same upload-or-generate contract as Admin's vehicle photo modal
// (api/src/functions/vehicle-classes.js resolvePhoto) — now also
// reachable by the driver this vehicle is assigned to.
async function editMyVehiclePhoto() {
  if (!MY_VEHICLE) return;
  const f = await formModal(`Photo — ${MY_VEHICLE.label}`, `
    <div class="form-group"><label class="form-label">Upload a photo</label>
      <input class="form-input" type="file" name="photo_file" accept="image/*" /></div>
    <div class="small muted" style="margin:2px 0 12px">— or —</div>
    <div class="form-group"><label class="form-label">Generate with AI (describe the vehicle)</label>
      <input class="form-input" name="photo_prompt" placeholder="e.g. white Chevrolet Suburban SUV" /></div>
  `, { icon: 'fa-camera', submitLabel: 'Save', wide: false });
  if (!f) return;
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
  const { error } = await api(`/vehicles/${MY_VEHICLE.id}/photo`, 'POST', body);
  if (error) return toastMsg('Could not save photo', error);
  toastMsg('Photo saved', MY_VEHICLE.label);
  refreshVehicle();
}

// Position pings while a ride is live (every 5 s)
function managePings() {
  const live = ACTIVE && ['en_route', 'arrived', 'in_progress'].includes(ACTIVE.status);
  if (live && !pingTimer && 'geolocation' in navigator) {
    pingTimer = setInterval(() => {
      navigator.geolocation.getCurrentPosition(pos => {
        api('/positions', 'POST', {
          vehicle_id: ACTIVE.vehicle_id, ride_id: ACTIVE.id,
          lat: pos.coords.latitude, lng: pos.coords.longitude,
          heading: pos.coords.heading, speed: pos.coords.speed,
        });
      }, () => {}, { enableHighAccuracy: true, maximumAge: 3000, timeout: 4000 });
    }, 5000);
  } else if (!live && pingTimer) { clearInterval(pingTimer); pingTimer = null; }
}

(async function init() {
  document.getElementById('user-name').textContent = me.full_name;
  refresh();
  refreshVehicle();
  setInterval(refresh, 10000);
  setInterval(refreshVehicle, 30000);
  if (typeof initPushNotifications === 'function') initPushNotifications();
})();
