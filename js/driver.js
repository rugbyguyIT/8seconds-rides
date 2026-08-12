// Driver portal — assigned pickups, state buttons, position pings, issue alerts
const me = requireLogin('driver');
let ACTIVE = null, pingTimer = null;

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
  const note = prompt(kind === 'vehicle' ? 'What is wrong with the vehicle?' : 'Where are you stuck? (optional)') || '';
  const { error } = await api(`/rides/${id}/action`, 'POST', { action: 'alert', alert_kind: kind, note });
  if (error) return toastMsg('Could not send', error);
  toastMsg('Dispatch alerted', 'The rider and their handler got a soft heads-up. Dispatch will follow up.');
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
  setInterval(refresh, 10000);
  if (typeof initPushNotifications === 'function') initPushNotifications();
})();
