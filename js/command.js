// Command Center — live kiosk board: stats, ride rail, and a
// vehicle-position map (who's moving, who has a passenger, who's
// idle). Polls the same data dispatch uses; nothing here mutates rides.
const me = requireLogin('admin', 'dispatch', 'display');
let VEHICLES = [];

const NRG_CENTER = [-95.4103, 29.6857]; // NRG Park, Houston
// Greater Houston metro, sw/ne — Katy to Baytown-ish, Spring to Pearland-ish.
// Rough by design; this is a "see the whole city" button, not a precise boundary.
const HOUSTON_BOUNDS = [[-95.85, 29.48], [-95.05, 30.02]];
const cmdMap = createLiveMap({
  fallbackId: 'cmd-map-fallback', realId: 'cmd-map-real', controlsId: 'cmd-map-controls', vehLayerId: 'veh-layer',
  center: NRG_CENTER, bounds: HOUSTON_BOUNDS, zoom: 13, recenterZoom: 15,
});
function recenterMap() { cmdMap.recenter(); }
function zoomToCity() { cmdMap.zoomToCity(); }

function tickClock() {
  const d = new Date();
  document.getElementById('cmd-clock').textContent = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  document.getElementById('cmd-date').textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// This kiosk can be reached two ways: a normal admin/dispatch sign-in
// (full nav back to their other portals), or the PIN-only Command
// Center kiosk sign-in (pages/kiosk.html) for a "display" account —
// which has no email/password to sign back in with, so it goes back
// to the PIN pad instead of the general login screen.
function renderCmdLinks() {
  const el = document.getElementById('cmd-links');
  const btn = (href, icon, label) =>
    `<a href="${href}" class="btn btn-sm" style="background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.18);color:#fff;text-decoration:none"><i class="fa-solid ${icon}"></i> ${label}</a>`;
  let html = '';
  if (me.role === 'admin') html += btn('/pages/admin.html', 'fa-arrow-left', 'Admin');
  if (me.role !== 'display') html += btn('/pages/dispatch.html', 'fa-inbox', 'Dispatch');
  el.innerHTML = html;
}
function kioskSignOut() {
  if (me.role !== 'display') { signOut(); return; }
  [localStorage, sessionStorage].forEach(s => { s.removeItem('rides_token'); s.removeItem('rides_profile'); });
  window.location.href = '/pages/kiosk.html';
}

// The kiosk (role='display') gets enduser_name/photo redacted server-side
// (see api/src/functions/rides.js ridesList) — who's riding never reaches
// this screen. Fall back to the driver's name, then the vehicle's label,
// so the card still identifies the ride by something, just not the guest.
function railCard(r) {
  const headline = r.enduser_name || r.driver_name || r.vehicle_label || 'Active ride';
  const metaLeft = r.enduser_name
    ? esc(r.driver_name || 'Unassigned') + (r.vehicle_label ? ' · ' + esc(r.vehicle_label) : '')
    : esc(r.vehicle_label || '');
  return `<div class="cmd-ride">
    <div class="r-top"><span class="r-name">${esc(headline)}</span>
      <span class="class-chip ${CLASS_CHIP[r.enduser_class] || 'class-vip'}">${esc(r.enduser_class || 'guest')}</span></div>
    <div class="r-route">${rideRoute(r)}</div>
    <div class="r-meta">
      <span>${metaLeft}</span>
      <span>${esc((STATUS_META[r.status] || {}).label || r.status)}</span>
    </div>
  </div>`;
}

async function refresh() {
  const [{ data: rides }, { data: positions }, { data: vehicles }] = await Promise.all([
    api('/rides'), api('/positions/latest'), api('/vehicles'),
  ]);
  const all = rides || []; VEHICLES = vehicles || [];
  const live = all.filter(r => ['assigned', 'en_route', 'arrived', 'in_progress'].includes(r.status));
  const pending = all.filter(r => r.status === 'requested');
  const pos = positions || [];

  document.getElementById('cs-live').textContent = live.length;
  document.getElementById('cs-pending').textContent = pending.length;
  document.getElementById('cs-vehicles').textContent = pos.length;
  document.getElementById('cs-idle').textContent = Math.max(0, VEHICLES.filter(v => v.active).length - pos.length);

  document.getElementById('cmd-rail').innerHTML = '<div class="rail-hdr">Live rides</div>' + (live.length
    ? live.map(railCard).join('')
    : '<div class="small muted" style="padding:8px">No rides in motion right now.</div>');

  const rideByVehicle = {};
  live.forEach(r => { if (r.vehicle_id) rideByVehicle[r.vehicle_id] = r; });
  cmdMap.refresh(pos, rideByVehicle);
}

(function init() {
  renderCmdLinks();
  tickClock(); setInterval(tickClock, 1000);
  cmdMap.init().finally(() => { refresh(); setInterval(refresh, 5000); });
})();
