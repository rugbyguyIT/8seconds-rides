// Command Center — live kiosk board: stats, ride rail, and a
// vehicle-position map (who's moving, who has a passenger, who's
// idle). Polls the same data dispatch uses; nothing here mutates rides.
const me = requireLogin('admin', 'dispatch', 'display');
let VEHICLES = [];

function tickClock() {
  const d = new Date();
  document.getElementById('cmd-clock').textContent = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  document.getElementById('cmd-date').textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// Lat/lng -> local SVG coordinates. Auto-fits to wherever the fleet
// actually is (padded) so this works regardless of the venue's real
// coordinates, with a sane Houston-area fallback when nothing has
// reported in yet.
function computeBbox(points) {
  const lats = points.map(p => p.lat).filter(v => typeof v === 'number' && isFinite(v));
  const lngs = points.map(p => p.lng).filter(v => typeof v === 'number' && isFinite(v));
  let minLat = Math.min(...lats), maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  if (!lats.length || !isFinite(minLat) || (maxLat - minLat < 0.002 && maxLng - minLng < 0.002)) {
    return { minLat: 29.60, maxLat: 29.76, minLng: -95.48, maxLng: -95.34 };
  }
  const padLat = Math.max((maxLat - minLat) * 0.28, 0.01);
  const padLng = Math.max((maxLng - minLng) * 0.28, 0.01);
  return { minLat: minLat - padLat, maxLat: maxLat + padLat, minLng: minLng - padLng, maxLng: maxLng + padLng };
}
function toXY(lat, lng, bbox) {
  const x = ((lng - bbox.minLng) / (bbox.maxLng - bbox.minLng)) * 1000;
  const y = (1 - (lat - bbox.minLat) / (bbox.maxLat - bbox.minLat)) * 600;
  return { x: Math.max(24, Math.min(976, x)), y: Math.max(24, Math.min(576, y)) };
}

const RIDE_VEH_STATE = {
  assigned:    { fill: 'var(--orange)', tag: 'TO PICKUP', ring: true },
  en_route:    { fill: 'var(--orange)', tag: 'TO PICKUP', ring: true },
  arrived:     { fill: 'var(--blue)',   tag: 'WAITING',   ring: true },
  in_progress: { fill: 'var(--green)',  tag: 'ONBOARD',   ring: false },
};

function vehicleMarkup(pos, ride, bbox) {
  const { x, y } = toXY(pos.lat, pos.lng, bbox);
  const state = ride && RIDE_VEH_STATE[ride.status];
  const fill = state ? state.fill : '#3d5a7c';
  const tag = state ? state.tag : 'IDLE';
  const stale = !!pos.stale && !ride;
  return `<g class="veh${stale ? ' veh-stale' : ''}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
    ${state && state.ring ? `<circle class="veh-ring" r="9" style="stroke:${fill}"/>` : ''}
    <circle class="veh-dot" r="7" style="fill:${fill}"/>
    <rect x="-36" y="-30" width="72" height="15" rx="4" class="veh-tag-bg"/>
    <text x="0" y="-19" text-anchor="middle" class="veh-tag">${esc(pos.label)}</text>
    <rect x="-28" y="12" width="56" height="13" rx="4" class="veh-tag-bg" style="fill:${fill};opacity:.92"/>
    <text x="0" y="21.5" text-anchor="middle" class="veh-tag" style="font-size:7.5px">${tag}</text>
  </g>`;
}

function railCard(r) {
  return `<div class="cmd-ride">
    <div class="r-top"><span class="r-name">${esc(r.enduser_name)}</span>
      <span class="class-chip ${CLASS_CHIP[r.enduser_class] || 'class-vip'}">${esc(r.enduser_class || 'guest')}</span></div>
    <div class="r-route">${rideRoute(r)}</div>
    <div class="r-meta">
      <span>${esc(r.driver_name || 'Unassigned')}${r.vehicle_label ? ' · ' + esc(r.vehicle_label) : ''}</span>
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
  const bbox = computeBbox(pos);
  document.getElementById('veh-layer').innerHTML = pos.map(p => vehicleMarkup(p, rideByVehicle[p.vehicle_id], bbox)).join('');
}

(function init() {
  tickClock(); setInterval(tickClock, 1000);
  refresh(); setInterval(refresh, 5000);
})();
