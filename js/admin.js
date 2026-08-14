// Admin portal — users, handler links, vehicles, settings, logging
const me = requireLogin('admin');
let USERS = [], VEHICLES = [], VCLASSES = [], LOCS = [], PENDING_REQUESTS = [];
let vehicleRequestsInited = false; // suppresses the "new request" toast on first load
const LEVEL_BADGE = { info: 'badge-neutral', warn: 'badge-pending', error: 'badge-no' };

// Same live map as Command Center, shrunk to fit the dashboard, with the
// same Recenter/Zoom-to-city controls plus an Expand toggle (grows to
// half the screen, then Minimize puts it back).
const NRG_CENTER = [-95.4103, 29.6857];
const HOUSTON_BOUNDS = [[-95.85, 29.48], [-95.05, 30.02]];
const adminMap = createLiveMap({
  fallbackId: 'admin-map-fallback', realId: 'admin-map-real', vehLayerId: 'admin-veh-layer', controlsId: 'admin-map-controls',
  center: NRG_CENTER, bounds: HOUSTON_BOUNDS, zoom: 13, recenterZoom: 15,
});
async function refreshAdminMap() {
  const [{ data: rides }, { data: positions }] = await Promise.all([api('/rides'), api('/positions/latest')]);
  const live = (rides || []).filter(r => ['assigned', 'en_route', 'arrived', 'in_progress'].includes(r.status));
  const rideByVehicle = {};
  live.forEach(r => { if (r.vehicle_id) rideByVehicle[r.vehicle_id] = r; });
  adminMap.refresh(positions || [], rideByVehicle);
}

// ── Live-map demo mode ────────────────────────────────────────────
// Lets ops preview what a busy board looks like — some units heading out
// to a pickup (orange), some already carrying a rider back toward the
// venue (green) — without waiting for real ride traffic. Entirely
// synthetic: it feeds fake positions straight into adminMap.refresh() and
// NEVER calls /rides or /positions/latest, so it can't leak or be
// confused with real dispatch data. The real 5s poll is paused while
// demo mode is on and resumes exactly where it left off when it's
// turned off. A pulsing "DEMO" banner covers the map the whole time —
// this is dispatch-critical software, so simulated traffic must never
// be mistakable for a real vehicle.
const DEMO_WAYPOINTS = [
  { name: 'Downtown Hyatt',      lat: 29.7530, lng: -95.3630 },
  { name: 'Hobby Airport',       lat: 29.6454, lng: -95.2789 },
  { name: 'The Woodlands',       lat: 29.9800, lng: -95.4700 },
  { name: 'Sugar Land Marriott', lat: 29.6197, lng: -95.6349 },
  { name: 'IAH Airport',         lat: 29.9902, lng: -95.3368 },
  { name: 'Pasadena Inn',        lat: 29.6911, lng: -95.2091 },
];
// Deliberately silly, obviously-fictional names — never anything that
// could read as a real driver or guest — so nobody mistakes a demo
// board for a real one even at a glance.
const DEMO_DRIVER_NAMES = ['Barth Grooks', 'Chuck Wagonwheel', 'Rusty Buckshot', 'Merle Higgenbottom', 'Duke Featherstone', 'Cleatus Vandermeer'];
const DEMO_RIDER_NAMES = ['Bo Peep Winslow', 'Delta Champagne', 'Chip Longhorn', 'Sugar Ray Biscuit', 'Trixie Belle Larue', 'Wyatt Dusthorse'];
let DEMO_VEHICLES = [];
let adminMapPollTimer = null;
let mapDemoTimer = null;

function resetDemoVehicles() {
  DEMO_VEHICLES = DEMO_WAYPOINTS.map((wp, idx) => ({
    vehicle_id: `demo-${idx + 1}`,
    label: `Demo Unit ${idx + 1}`,
    driver_name: DEMO_DRIVER_NAMES[idx % DEMO_DRIVER_NAMES.length],
    rider_name: DEMO_RIDER_NAMES[idx % DEMO_RIDER_NAMES.length],
    waypoint: wp,
    inbound: idx % 2 === 1, // alternate start direction so the board doesn't open with everyone going the same way
    t: idx / DEMO_WAYPOINTS.length,
    speed: 0.006 + (idx % 3) * 0.0018,
  }));
}
function demoFrame() {
  const positions = [], rideByVehicle = {};
  DEMO_VEHICLES.forEach(v => {
    v.t += v.speed;
    if (v.t >= 1) { v.t = 0; v.inbound = !v.inbound; }
    // Outbound = driving from the venue out to the waypoint to collect a rider.
    // Inbound = already has the rider, driving from the waypoint back to the venue.
    const from = v.inbound ? v.waypoint : { lat: NRG_CENTER[1], lng: NRG_CENTER[0] };
    const to   = v.inbound ? { lat: NRG_CENTER[1], lng: NRG_CENTER[0] } : v.waypoint;
    const lat = from.lat + (to.lat - from.lat) * v.t;
    const lng = from.lng + (to.lng - from.lng) * v.t;
    positions.push({ vehicle_id: v.vehicle_id, lat, lng, label: v.label, stale: false });
    const status = v.inbound ? 'in_progress' : (v.t < 0.08 || v.t > 0.85 ? 'arrived' : 'en_route');
    // Demo rides carry a driver_name AND (once inbound, "carrying a
    // rider") an enduser_name, same shape real ride data has — showcases
    // the map's driver-name + rider-name display, and, same as the real
    // feed, this doubles as a preview of "kiosk never sees the rider
    // name" since Command Center's own live view still redacts it
    // server-side; demo mode just isn't wired into that redaction since
    // it never touches the server at all.
    rideByVehicle[v.vehicle_id] = {
      status, driver_name: v.driver_name,
      enduser_name: v.inbound ? v.rider_name : null,
    };
  });
  return { positions, rideByVehicle };
}
function toggleMapDemo() { mapDemoTimer ? stopMapDemo() : startMapDemo(); }
function startMapDemo() {
  if (mapDemoTimer) return;
  if (adminMapPollTimer) { clearInterval(adminMapPollTimer); adminMapPollTimer = null; }
  resetDemoVehicles();
  document.getElementById('admin-map-demo-banner').style.display = 'flex';
  const btn = document.getElementById('admin-map-demo-btn');
  if (btn) { btn.classList.add('on'); btn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop demo'; }
  const tick = () => { const { positions, rideByVehicle } = demoFrame(); adminMap.refresh(positions, rideByVehicle); };
  tick();
  mapDemoTimer = setInterval(tick, 1200);
}
function stopMapDemo() {
  if (!mapDemoTimer) return;
  clearInterval(mapDemoTimer); mapDemoTimer = null;
  document.getElementById('admin-map-demo-banner').style.display = 'none';
  const btn = document.getElementById('admin-map-demo-btn');
  if (btn) { btn.classList.remove('on'); btn.innerHTML = '<i class="fa-solid fa-play"></i> Demo'; }
  refreshAdminMap();
  adminMapPollTimer = setInterval(refreshAdminMap, 5000);
}
// Three sizes: normal (300px) -> expanded (50vh, inline) -> full screen
// (the real Fullscreen API on #admin-map itself, so it fills the screen
// in place rather than popping a new window/tab). Full screen is only
// reachable from expanded, matching "expand, then offer full screen or
// back to normal"; exiting full screen (our button, Esc, or the
// browser's own control) drops back to expanded, not all the way to normal.
function setAdminMapSize(size) {
  const el = document.getElementById('admin-map');
  if (size === 'fullscreen') {
    el.classList.add('expanded');
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) req.call(el).catch(() => {});
  } else {
    if (document.fullscreenElement === el) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    el.classList.toggle('expanded', size === 'expanded');
  }
  renderAdminMapSizeControls();
  // Mapbox doesn't notice its container resizing on its own — nudge it
  // once now and once more after the CSS height transition finishes.
  adminMap.resize();
  setTimeout(() => adminMap.resize(), 260);
}
function renderAdminMapSizeControls() {
  const el = document.getElementById('admin-map');
  const box = document.getElementById('admin-map-size-controls');
  if (!el || !box) return;
  const isFull = document.fullscreenElement === el;
  const isExpanded = el.classList.contains('expanded');
  if (isFull) {
    box.innerHTML = '<button class="btn btn-sm" onclick="setAdminMapSize(\'expanded\')"><i class="fa-solid fa-down-left-and-up-right-to-center"></i> Exit full screen</button>';
  } else if (isExpanded) {
    box.innerHTML = '<button class="btn btn-sm" onclick="setAdminMapSize(\'fullscreen\')"><i class="fa-solid fa-expand"></i> Full screen</button>'
      + '<button class="btn btn-sm" onclick="setAdminMapSize(\'normal\')"><i class="fa-solid fa-down-left-and-up-right-to-center"></i> Back to normal</button>';
  } else {
    box.innerHTML = '<button class="btn btn-sm" onclick="setAdminMapSize(\'expanded\')"><i class="fa-solid fa-up-right-and-down-left-from-center"></i> Expand</button>';
  }
}
// Catches every way full screen can end — our own button, Esc, or the
// browser/OS chrome — so the controls and map size never get stuck out
// of sync with reality.
document.addEventListener('fullscreenchange', () => {
  if (document.getElementById('admin-map')) { renderAdminMapSizeControls(); adminMap.resize(); }
});

// ── View switching (Dashboard / Settings) ───────────────────
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

  // Command Center's kiosk profile (migration 006) is a hidden system
  // account, not a real user — it's managed from Settings → Command
  // Center kiosk, not this table.
  document.getElementById('users').innerHTML = USERS.filter(u => u.role !== 'display').map(u => `
    <tr><td><b>${esc(u.full_name)}</b><div class="small muted">${esc(u.email)}</div></td>
        <td><span class="badge badge-neutral">${esc(u.role)}</span>
            ${u.enduser_class ? `<span class="class-chip ${CLASS_CHIP[u.enduser_class] || 'class-vip'}">${esc(u.enduser_class)}</span>` : ''}</td>
        <td class="small mono">${esc(u.phone_mobile || '—')}</td>
        <td><span class="badge ${u.status === 'active' ? 'badge-approved' : 'badge-no'}">${esc(u.status)}</span></td>
        <td style="text-align:right;white-space:nowrap">
          ${['rider', 'handler'].includes(u.role) ? `<button class="btn btn-sm" onclick="impersonate('${u.id}')" title="View as this user"><i class="fa-solid fa-eye"></i></button>` : ''}
          <button class="btn btn-sm" onclick="renameUser('${u.id}')" title="Edit name / email"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-sm" onclick="resetPw('${u.id}')" title="Reset password"><i class="fa-solid fa-key"></i></button>
          <button class="btn btn-sm" onclick="forceLogout('${u.id}')" title="Sign out everywhere"><i class="fa-solid fa-right-from-bracket"></i></button>
          <button class="btn btn-danger btn-sm" onclick="toggleActive('${u.id}','${u.status}')" title="${u.status === 'active' ? 'Deactivate' : 'Activate'}"><i class="fa-solid fa-power-off"></i></button></td></tr>`).join('');

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

  renderDrivers();
}

// ── Drivers & their vehicles ───────────────────────
// Admin visibility into who's driving what: driver photo, their
// vehicle's class/photo/plate, and the HLSR hang tag number. The
// driver↔vehicle link is persistent (vehicles.driver_id), separate
// from per-shift/per-ride assignment — it answers "whose car is this
// normally", not "who's driving this specific trip".
function driverVehicle(driverId) { return VEHICLES.find(v => v.driver_id === driverId); }

// Drivers pick their own vehicle at the start of a show/shift (or
// switch it) from their portal, but it doesn't take effect until
// dispatch/admin approves it here — a push notification goes out the
// moment they ask (server-side, api/src/functions/vehicle-requests.js),
// and this poll + badge + toast is the always-on fallback so a pending
// request never gets missed just because nobody was looking at a phone.
async function refreshVehicleRequests() {
  const { data } = await api('/vehicle-requests?status=pending');
  const list = data || [];
  if (vehicleRequestsInited) {
    const prevIds = new Set(PENDING_REQUESTS.map(r => r.id));
    list.filter(r => !prevIds.has(r.id)).forEach(r =>
      toastMsg('Vehicle request', `${r.driver_name} wants ${r.vehicle_label}`));
  }
  PENDING_REQUESTS = list;
  vehicleRequestsInited = true;
  renderVehicleRequests();
}

function renderVehicleRequests() {
  const badge = document.getElementById('drivers-badge');
  if (badge) {
    if (PENDING_REQUESTS.length) { badge.textContent = PENDING_REQUESTS.length; badge.style.display = ''; }
    else badge.style.display = 'none';
  }
  const el = document.getElementById('vehicle-requests-alert');
  if (!el) return;
  if (!PENDING_REQUESTS.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="card card-sm" style="border:1.5px solid rgba(239,118,34,0.45);margin-bottom:14px">
    <div class="section-title" style="margin-bottom:4px"><i class="fa-solid fa-bell"></i> Pending vehicle requests (${PENDING_REQUESTS.length})</div>
    ${PENDING_REQUESTS.map(rq => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid rgba(255,255,255,0.08);flex-wrap:wrap">
        <img src="${esc(rq.driver_photo || '')}" onerror="this.style.visibility='hidden'"
             style="width:30px;height:30px;border-radius:50%;object-fit:cover;background:var(--surface3);flex-shrink:0" />
        <div style="flex:1;min-width:160px">
          <div><b>${esc(rq.driver_name)}</b> wants <b>${esc(rq.vehicle_label)}</b></div>
          <div class="small muted">Requested ${esc(fmtWhen(rq.requested_at))}</div>
        </div>
        <button class="btn btn-sm btn-primary" onclick="decideVehicleRequest('${rq.id}','approve')"><i class="fa-solid fa-check"></i> Approve</button>
        <button class="btn btn-danger btn-sm" onclick="decideVehicleRequest('${rq.id}','deny')"><i class="fa-solid fa-xmark"></i> Deny</button>
      </div>`).join('')}
  </div>`;
}

async function decideVehicleRequest(id, decision) {
  let note = null;
  if (decision === 'deny') {
    note = await promptModal('The driver will see this.', { title: 'Reason for denying (optional)', required: false, okLabel: 'Deny request' });
  }
  const { error } = await api(`/vehicle-requests/${id}/decide`, 'POST', { decision, note });
  if (error) return toastMsg('Could not save decision', error);
  toastMsg(decision === 'approve' ? 'Vehicle request approved' : 'Vehicle request denied', '');
  refreshVehicleRequests(); refresh();
}

function renderDrivers() {
  const el = document.getElementById('drivers-rows');
  if (!el) return;
  const drivers = USERS.filter(u => u.role === 'driver');
  el.innerHTML = drivers.length ? drivers.map(d => {
    const v = driverVehicle(d.id);
    return `<tr>
      <td style="display:flex;align-items:center;gap:9px">
        <img src="${esc(d.photo_url || '')}" onerror="this.style.visibility='hidden'"
             style="width:34px;height:34px;border-radius:50%;object-fit:cover;background:var(--surface3);flex-shrink:0" />
        <div><b>${esc(d.full_name)}</b><div class="small muted">${esc(d.phone_mobile || '—')}</div></div></td>
      <td>${v ? `<div style="display:flex;align-items:center;gap:9px">
          <img src="${esc(v.photo_url || classPhoto(v.class) || '')}" onerror="this.style.visibility='hidden'"
               style="width:34px;height:34px;border-radius:8px;object-fit:cover;background:var(--surface3);flex-shrink:0" />
          <span>${esc(v.label)}</span></div>` : '<span class="small muted">No vehicle assigned</span>'}</td>
      <td>${v ? `<span class="badge badge-neutral">${esc(classLabel(v.class))}</span>` : '—'}</td>
      <td class="mono small">${v ? esc(v.plate || '—') : '—'}</td>
      <td class="mono small">${v ? esc(v.hang_tag || '—') : '—'}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm" onclick="editDriverModal('${d.id}')" title="Edit driver — name, email, mobile, photo, status"><i class="fa-solid fa-id-badge"></i></button>
        <button class="btn btn-sm" onclick="assignDriverVehicle('${d.id}')" title="${v ? 'Reassign vehicle' : 'Assign vehicle'}"><i class="fa-solid fa-car"></i></button>
        ${v ? `<button class="btn btn-sm" onclick="openPhotoModal('vehicle','${v.id}','${esc(v.label)}')" title="Vehicle photo"><i class="fa-solid fa-camera"></i></button>
        <button class="btn btn-sm" onclick="editVehicleSetup('${v.id}')" title="Plate / hang tag"><i class="fa-solid fa-pen"></i></button>` : ''}
      </td></tr>`;
  }).join('') : '<tr><td colspan="6" class="small muted">No drivers registered yet — create one under Users.</td></tr>';
}

// Everything about the driver themself (as opposed to their vehicle,
// which has its own car/camera/pen actions right next to this one):
// name, email, mobile number for OTP sign-in, active/inactive, and their
// own ID photo. Photo here is upload-only — see profiles.js's
// profilePhoto handler for why AI generation isn't offered for a real
// person's identifying photo the way it is for a vehicle.
async function editDriverModal(driverId) {
  const d = USERS.find(x => x.id === driverId);
  if (!d) return;
  const f = await formModal(`Edit driver — ${d.full_name}`, `
    <div class="form-row">
      <div class="form-group"><label class="form-label">First name</label><input class="form-input" name="first_name" value="${esc(d.first_name)}" required /></div>
      <div class="form-group"><label class="form-label">Last name</label><input class="form-input" name="last_name" value="${esc(d.last_name)}" required /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Email</label><input class="form-input" type="email" name="email" value="${esc(d.email)}" required /></div>
      <div class="form-group"><label class="form-label">Mobile (OTP sign-in)</label><input class="form-input" name="phone" value="${esc(d.phone_mobile || '')}" placeholder="713 555 0100" /></div>
    </div>
    <div class="form-group"><label class="form-label">Status</label>
      <select class="form-input" name="status">
        <option value="active" ${d.status === 'active' ? 'selected' : ''}>Active</option>
        <option value="inactive" ${d.status === 'inactive' ? 'selected' : ''}>Inactive</option>
      </select></div>
    <div class="form-group"><label class="form-label">Photo</label>
      <input class="form-input" type="file" name="photo_file" accept="image/*" />
      <div class="small muted" style="margin-top:4px">Upload a real photo — this identifies the driver on the grounds, so there's no AI-generate option here (unlike vehicle photos).</div></div>
  `, { icon: 'fa-id-badge', submitLabel: 'Save' });
  if (!f) return;
  const body = { first_name: f.first_name.value.trim(), last_name: f.last_name.value.trim(),
                 phone_mobile: f.phone.value.trim() || null, status: f.status.value };
  const newEmail = f.email.value.trim().toLowerCase();
  if (newEmail !== d.email) body.email = newEmail;
  const { error } = await api('/profiles/' + driverId, 'PATCH', body);
  if (error) return toastMsg('Could not save', error);
  if (f.photo_file.files[0]) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(f.photo_file.files[0]);
    });
    const { error: photoErr } = await api('/profiles/' + driverId + '/photo', 'POST', { mode: 'upload', data_url: dataUrl });
    if (photoErr) { toastMsg('Saved details, but the photo failed', photoErr); refresh(); return; }
  }
  toastMsg('Driver updated', `${f.first_name.value} ${f.last_name.value}`); refresh();
}

async function assignDriverVehicle(driverId) {
  const d = USERS.find(x => x.id === driverId);
  if (!d) return;
  const current = driverVehicle(driverId);
  const options = ['<option value="">— Unassign —</option>'].concat(
    VEHICLES.map(v => `<option value="${v.id}" ${current && current.id === v.id ? 'selected' : ''}>${esc(v.label)}${v.driver_id && v.driver_id !== driverId ? ' (assigned elsewhere)' : ''}</option>`));
  const f = await formModal(`Assign vehicle — ${d.full_name}`, `
    <div class="form-group"><label class="form-label">Vehicle</label>
      <select class="form-input" name="vehicle_id">${options.join('')}</select></div>
    <div class="small muted">Picking a vehicle already assigned to another driver moves it to ${esc(d.full_name)}.</div>
  `, { icon: 'fa-car', submitLabel: 'Save', wide: false });
  if (!f) return;
  if (current && current.id !== f.vehicle_id.value) {
    await api('/vehicles/' + current.id, 'PATCH', { driver_id: null });
  }
  if (f.vehicle_id.value) {
    const { error } = await api('/vehicles/' + f.vehicle_id.value, 'PATCH', { driver_id: driverId });
    if (error) return toastMsg('Could not assign vehicle', error);
  }
  toastMsg('Vehicle assignment saved', d.full_name); refresh();
}

function editVehicleSetup(vehicleId) {
  const v = VEHICLES.find(x => x.id === vehicleId);
  if (!v) return;
  openModal(`Vehicle setup — ${v.label}`, `
    <div class="form-group"><label class="form-label">Plate</label><input class="form-input" name="plate" value="${esc(v.plate || '')}" /></div>
    <div class="form-group"><label class="form-label">HLSR hang tag number</label><input class="form-input" name="hang_tag" value="${esc(v.hang_tag || '')}" /></div>
  `, async (f) => {
    const { error } = await api('/vehicles/' + vehicleId, 'PATCH', { plate: f.plate.value.trim() || null, hang_tag: f.hang_tag.value.trim() || null });
    if (error) return toastMsg('Could not save', error);
    toastMsg('Vehicle updated', v.label); refresh();
  });
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
          <button class="btn btn-sm" onclick="editClassName('${c.id}')" title="Edit name"><i class="fa-solid fa-pen"></i></button>
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

// The key (slug) stays fixed once created — it's what vehicles.class
// actually references — but the display label is just presentation and
// safe to rename any time (e.g. fixing a typo or renaming "SUV" to
// "Suburban / SUV").
async function editClassName(id) {
  const c = VCLASSES.find(x => x.id === id);
  if (!c) return;
  const val = await promptModal(`Key stays "${c.key}" — this only changes what's shown.`,
    { title: `Rename — ${c.label}`, value: c.label, okLabel: 'Save' });
  if (!val) return;
  const { error } = await api('/vehicle-classes/' + id, 'PATCH', { label: val.trim() });
  if (error) return toastMsg('Could not rename', error);
  toastMsg('Class renamed', val.trim()); loadVehicleClasses();
}

async function editClassCapacity(id) {
  const c = VCLASSES.find(x => x.id === id);
  if (!c) return;
  const val = await promptModal('How many riders can this vehicle class seat, not counting the driver?',
    { title: `Seats — ${c.label}`, value: String(c.default_capacity || 6), okLabel: 'Save' });
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

// Create-a-ride ("Create ride" in the top nav) moved to
// openCreateRideModal() in rides-ui.js — shared with Dispatch, which
// needed the same capability (see js/rides-ui.js for why).

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

// "Create user" used to be a permanently-visible form card next to the
// Users table — folded into a popup (formModal) reached via the button
// in the table's header instead, so the Users list gets the full section
// width (see the Fleet/Users-cutoff fix). roleChanged (below) still
// targets #pw-row / #class-row, which live inside this modal's markup now.
async function openCreateUserModal() {
  const f = await formModal('Create user', `
    <div class="form-row">
      <div class="form-group"><label class="form-label">First name</label><input class="form-input" name="first_name" required /></div>
      <div class="form-group"><label class="form-label">Last name</label><input class="form-input" name="last_name" required /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Email</label><input class="form-input" type="email" name="email" required /></div>
      <div class="form-group"><label class="form-label">Mobile (OTP sign-in)</label><input class="form-input" name="phone" placeholder="713 555 0100" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Role</label>
        <select class="form-input" name="role" onchange="roleChanged(this)">
          <option value="rider">Rider (VIP / end user)</option><option value="handler">Handler / EA</option>
          <option value="driver">Driver</option><option value="dispatch">Dispatch (12 h session)</option>
          <option value="admin">Admin (24 h session)</option>
        </select></div>
      <div class="form-group" id="class-row"><label class="form-label">Rider class</label>
        <select class="form-input" name="uclass"><option value="vip">VIP</option><option value="executive">Executive</option>
        <option value="performer">Performer</option><option value="guest">Guest</option></select></div>
    </div>
    <div class="form-group" id="pw-row" style="display:none"><label class="form-label">Password (dispatch/admin only)</label>
      <input class="form-input" type="text" name="password" autocomplete="new-password" /></div>
    <div class="small muted" style="margin:-6px 0 12px">Command Center's kiosk PIN isn't a user account — set it under Settings → Command Center kiosk.</div>
    <div class="form-group"><label class="form-label">Photo URL (Required for all drivers)</label>
      <input class="form-input" name="photo" placeholder="https://…" /></div>
    <div class="toggle-row" style="border-bottom:none"><span class="small" style="font-weight:600">SMS consent on file</span>
      <label class="switch"><input type="checkbox" name="sms"><span class="slider"></span></label></div>
  `, { icon: 'fa-user-plus', submitLabel: 'Create' });
  if (!f) return;
  const body = { email: f.email.value, first_name: f.first_name.value, last_name: f.last_name.value, role: f.role.value,
                 phone_mobile: f.phone.value || null, enduser_class: f.uclass.value || null,
                 password: f.password.value || null, sms_consent: f.sms.checked, photo_url: f.photo.value || null };
  const { error } = await api('/profiles', 'POST', body);
  if (error) { appLog('warn', 'admin.create_user_failed', error); return toastMsg('Could not create user', error); }
  toastMsg('User created', `${body.first_name} ${body.last_name} (${body.role}) can now sign in.`);
  refresh();
}
// Small inline modal — chained window.prompt() calls are unreliable
// (browsers frequently suppress the second dialog when two fire back
// to back), so name edits get a real two-field form instead.
function openModal(title, fieldsHtml, onSave) {
  document.getElementById('modal-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,10,25,0.60);backdrop-filter:blur(10px) saturate(120%);-webkit-backdrop-filter:blur(10px) saturate(120%);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `<div class="card ui-modal-card" style="width:100%;max-width:360px;padding:20px">
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
  openModal('Edit name / email', `
    <div class="form-group"><label class="form-label">First name</label><input class="form-input" name="first_name" value="${esc(u.first_name)}" required /></div>
    <div class="form-group"><label class="form-label">Last name</label><input class="form-input" name="last_name" value="${esc(u.last_name)}" required /></div>
    <div class="form-group"><label class="form-label">Email</label><input class="form-input" type="email" name="email" value="${esc(u.email)}" required /></div>
    <div class="small muted">If they're signed in right now, changing their email won't kick them out — the change won't show up for them until they sign in again.</div>
  `, async (f) => {
    const body = { first_name: f.first_name.value.trim(), last_name: f.last_name.value.trim() };
    const newEmail = f.email.value.trim().toLowerCase();
    if (newEmail !== u.email) body.email = newEmail;
    const { error } = await api('/profiles/' + id, 'PATCH', body);
    if (error) return toastMsg('Could not save', error);
    toastMsg('User updated', `${f.first_name.value} ${f.last_name.value}`); refresh();
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
  pwRow.style.display = ['dispatch', 'admin'].includes(sel.value) ? '' : 'none';
  document.getElementById('class-row').style.display = sel.value === 'rider' ? '' : 'none';
}

// ── Settings view ───────────────────────────────
let AUDIT_LOGS = [];
let KIOSK_PROFILE = null;

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
  await Promise.all([loadAuditLogs(), loadAppLogs(null), loadVehicleClasses(), loadKioskPin()]);
}

// Command Center's PIN lives on a single hidden system profile
// (role='display', auto-created by migration 006) — this card is the
// only place an admin ever touches it, and it's presented purely as a
// PIN, never as "a user".
async function loadKioskPin() {
  const statusEl = document.getElementById('kiosk-status');
  const formEl = document.getElementById('kiosk-pin-form');
  if (!statusEl) return;
  const { data } = await api('/profiles?role=display');
  KIOSK_PROFILE = (data || [])[0] || null;
  if (!KIOSK_PROFILE) {
    statusEl.innerHTML = 'Not set up yet — run the latest database migration (<span class="mono">006_kiosk_system_profile.sql</span>) to enable this.';
    formEl.style.display = 'none';
    return;
  }
  // password_hash is never returned to the client (safe-profile), so we
  // can't tell from here whether a PIN is already set — the form always
  // shows as "set / change" and is harmless to submit either way.
  statusEl.textContent = 'Set or change the shared PIN below — /pages/kiosk.html accepts it as soon as you save.';
  document.getElementById('kiosk-pin-label').textContent = 'Set / change kiosk PIN (exactly 8 digits)';
  formEl.style.display = '';
}

async function saveKioskPin(ev) {
  ev.preventDefault();
  const f = ev.target;
  const pin = f.pin.value.trim();
  if (!KIOSK_PROFILE) return toastMsg('Not ready', 'Run migration 006 first.');
  if (!/^\d{8}$/.test(pin)) return toastMsg('Not saved', 'PIN must be exactly 8 digits, numbers only.');
  const { error } = await api('/profiles/' + KIOSK_PROFILE.id, 'PATCH', { password: pin, status: 'active' });
  if (error) return toastMsg('Could not save PIN', error);
  toastMsg('Kiosk PIN saved', '/pages/kiosk.html is ready to use.');
  f.reset(); loadKioskPin();
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

// Highlights the sidenav item for whichever dashboard section is
// currently in view while scrolling — purely cosmetic, the anchor
// links work fine without it.
function initSidenavScrollspy() {
  const items = document.querySelectorAll('.admin-sidenav-item');
  const sections = document.querySelectorAll('.admin-section');
  if (!items.length || !sections.length || typeof IntersectionObserver === 'undefined') return;
  const byId = {};
  items.forEach(i => { byId[i.getAttribute('href').slice(1)] = i; });
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      const item = byId[e.target.id];
      if (item) item.classList.toggle('active', e.isIntersecting);
    });
  }, { rootMargin: '-84px 0px -70% 0px' });
  sections.forEach(s => obs.observe(s));
}

(async function init() {
  document.getElementById('user-name').textContent = me.full_name;
  loadVehicleClasses(); // populates the Add-vehicle class dropdown even before Settings is opened
  const { data: locs } = await api('/locations');
  LOCS = locs || [];
  refresh();
  initSidenavScrollspy();
  refreshVehicleRequests();
  setInterval(refreshVehicleRequests, 15000);
  renderAdminMapSizeControls();
  adminMap.init().finally(() => { refreshAdminMap(); adminMapPollTimer = setInterval(refreshAdminMap, 5000); });
  // Nav links elsewhere point Settings at admin.html#settings since it's
  // an in-page view, not its own URL — land there directly on load.
  if (window.location.hash === '#settings') setView('settings');
  if (typeof initPushNotifications === 'function') initPushNotifications();
})();
