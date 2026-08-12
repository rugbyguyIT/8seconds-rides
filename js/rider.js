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

(async function init() {
  document.getElementById('user-name').textContent = me.full_name;
  const { data: locs } = await api('/locations'); LOCS = locs || [];
  document.querySelector('[name=pickup]').innerHTML = locationOptions(LOCS, 'Choose a pickup point…');
  document.querySelector('[name=dropoff]').innerHTML = locationOptions(LOCS, 'Choose a destination…');
  wireAddressField('pickup', 'pickup_text', 'pickup_lat', 'pickup_lng');
  wireAddressField('dropoff', 'dropoff_text', 'dropoff_lat', 'dropoff_lng');
  refresh();
  setInterval(refresh, 15000);
  if (typeof initPushNotifications === 'function') initPushNotifications();
})();
