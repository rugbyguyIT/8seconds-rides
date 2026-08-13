// Rider portal — my rides + request form
const me = requireLogin('rider');
let LOCS = [];

async function refresh() {
  const { data: rides } = await api('/rides');
  const live = (rides || []).filter(r => ['en_route', 'arrived', 'in_progress'].includes(r.status));
  const upcoming = (rides || []).filter(r => ['requested', 'approved', 'assigned'].includes(r.status));
  const past = (rides || []).filter(r => ['completed', 'cancelled', 'denied', 'no_show'].includes(r.status)).slice(-10).reverse();

  document.getElementById('live').innerHTML = live.length
    ? live.map(r => rideCard(r, r.status === 'in_progress' ? '' :
        `<button class="btn btn-danger btn-sm" onclick="toastMsg('Request sent to dispatch','Your driver is already en route — dispatch will confirm the cancellation.')">Request cancellation</button>`)).join('')
    : '<div class="card card-sm small muted">No ride in progress.</div>';
  document.getElementById('upcoming').innerHTML = upcoming.length
    ? upcoming.map(r => rideCard(r,
        `<button class="btn btn-danger btn-sm" onclick="rideAction('${r.id}','cancel',null,'Cancel this ride?')">Cancel</button>`)).join('')
    : '<div class="card card-sm small muted">No upcoming rides — request one above.</div>';
  document.getElementById('past').innerHTML = past.map(r => rideCard(r, '')).join('');
}

async function submitRequest(ev) {
  ev.preventDefault();
  const f = ev.target;
  const body = {
    pickup_location_id: f.pickup.value || null, pickup_text: f.pickup.value ? null : f.pickup_text.value || null,
    pickup_lat: f.pickup.value ? null : (f.pickup_lat.value || null), pickup_lng: f.pickup.value ? null : (f.pickup_lng.value || null),
    dropoff_location_id: f.dropoff.value || null, dropoff_text: f.dropoff.value ? null : f.dropoff_text.value || null,
    dropoff_lat: f.dropoff.value ? null : (f.dropoff_lat.value || null), dropoff_lng: f.dropoff.value ? null : (f.dropoff_lng.value || null),
    scheduled_at: f.when.value ? new Date(f.when.value).toISOString() : null,
    party_size: parseInt(f.party.value, 10), round_trip: f.round_trip.checked,
    ada_required: f.ada.checked, notes: f.notes.value || null,
  };
  const { error } = await api('/rides', 'POST', body);
  if (error) return toastMsg('Could not submit', error);
  toastMsg('Ride requested', 'Dispatch has been notified — you will get a push/text when it is approved.');
  f.reset(); refresh();
}

// Picking a venue from the dropdown and typing a free-text address are
// mutually exclusive — whichever the rider touches last wins, and the
// other one clears so there's no ambiguity about which is submitted.
function wireAddressField(selectName, textName, latName, lngName) {
  const select = document.querySelector(`[name=${selectName}]`);
  const text = document.querySelector(`[name=${textName}]`);
  const lat = document.querySelector(`[name=${latName}]`);
  const lng = document.querySelector(`[name=${lngName}]`);
  select.addEventListener('change', () => {
    if (select.value) { text.value = ''; lat.value = ''; lng.value = ''; }
  });
  attachAddressAutocomplete(text, {
    latInput: lat, lngInput: lng,
    onSelect: () => { select.value = ''; },
  });
  text.addEventListener('input', () => { if (text.value) select.value = ''; });
}

function openProfileMenu() {
  const hcOn = document.body.classList.contains('hc');
  _openUiModal(`
    <div class="section-title" style="margin-bottom:14px"><i class="fa-solid fa-user"></i> ${esc(me.full_name)}</div>
    <div class="toggle-row" style="border-bottom:none"><span class="small" style="font-weight:600">High contrast mode
      <span class="muted" style="font-weight:400;display:block;margin-top:2px">Solid colors, thicker borders — easier to read in bright light or for low vision.</span></span>
      <label class="switch"><input type="checkbox" id="hc-toggle" ${hcOn ? 'checked' : ''}><span class="slider"></span></label></div>
    <button class="btn btn-danger btn-block" style="margin-top:18px" onclick="signOut()"><i class="fa-solid fa-right-from-bracket"></i> Sign out</button>
  `, (ov) => {
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) _closeUiModal(); });
    ov.querySelector('#hc-toggle').addEventListener('change', (e) => toggleHighContrast(e.target.checked));
  }, () => _closeUiModal());
}

(async function init() {
  document.getElementById('user-name').textContent = me.full_name;
  const firstName = me.first_name || (me.full_name || '').split(' ')[0] || 'there';
  document.getElementById('page-title').textContent = `Hey ${firstName}!`;
  document.getElementById('page-sub').textContent = 'Where can we take you today?';
  const { data: locs } = await api('/locations'); LOCS = locs || [];
  document.querySelector('[name=pickup]').innerHTML = locationOptions(LOCS, 'Choose a pickup point…');
  document.querySelector('[name=dropoff]').innerHTML = locationOptions(LOCS, 'Choose a destination…');
  wireAddressField('pickup', 'pickup_text', 'pickup_lat', 'pickup_lng');
  wireAddressField('dropoff', 'dropoff_text', 'dropoff_lat', 'dropoff_lng');
  refresh();
  setInterval(refresh, 15000);
  if (typeof initPushNotifications === 'function') initPushNotifications();
})();
