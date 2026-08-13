// Handler portal — act on behalf of assigned riders
const me = requireLogin('handler');
let LOCS = [], PRINCIPALS = [], current = null;

async function refresh() {
  if (!current) return;
  const { data: rides } = await api('/rides');
  const mine = (rides || []).filter(r => r.enduser_id === current);
  const active = mine.filter(r => !['completed', 'cancelled', 'denied', 'no_show'].includes(r.status));
  const past = mine.filter(r => ['completed', 'cancelled', 'denied', 'no_show'].includes(r.status)).slice(-8).reverse();
  const name = (PRINCIPALS.find(p => p.enduser_id === current) || {}).full_name || '';
  document.getElementById('rides').innerHTML = active.length
    ? active.map(r => rideCard(r, ['requested', 'approved', 'assigned'].includes(r.status)
        ? `<button class="btn btn-danger btn-sm" onclick="rideAction('${r.id}','cancel',null,'Cancel this ride? ${name} will be notified that you cancelled it.')">Cancel</button>` : '')).join('')
    : '<div class="card card-sm small muted">No active rides for this rider.</div>';
  document.getElementById('past').innerHTML = past.map(r => rideCard(r, '')).join('');
}

function selectPrincipal(id) {
  current = id;
  document.querySelectorAll('.principal').forEach(b => b.classList.toggle('sel', b.dataset.id === id));
  const name = (PRINCIPALS.find(p => p.enduser_id === id) || {}).full_name || '';
  document.getElementById('notify-name').textContent = name;
  refresh();
}

async function submitRequest(ev) {
  ev.preventDefault();
  if (!current) return toastMsg('Pick a rider first', 'Select who you are scheduling for.');
  const f = ev.target;
  const body = {
    enduser_id: current,
    pickup_location_id: f.pickup.value || null, dropoff_location_id: f.dropoff.value || null,
    pickup_text: f.pickup.value ? null : f.pickup_text.value || null,
    dropoff_text: f.dropoff.value ? null : f.dropoff_text.value || null,
    scheduled_at: f.when.value ? new Date(f.when.value).toISOString() : null,
    party_size: parseInt(f.party.value, 10), round_trip: f.round_trip.checked,
    ada_required: f.ada.checked, notes: f.notes.value || null,
  };
  const { error } = await api('/rides', 'POST', body);
  if (error) return toastMsg('Could not submit', error);
  toastMsg('Ride requested', 'The rider and dispatch have been notified.');
  f.reset(); refresh();
}

(async function init() {
  document.getElementById('user-name').textContent = me.full_name;
  const firstName = me.first_name || (me.full_name || '').split(' ')[0] || 'there';
  document.getElementById('page-title').textContent = `Hey ${firstName}!`;
  document.getElementById('page-sub').textContent = 'Who are we taking care of today?';
  const [{ data: prin }, { data: locs }] = await Promise.all([api('/handler-assignments'), api('/locations')]);
  PRINCIPALS = prin || []; LOCS = locs || [];
  document.getElementById('principals').innerHTML = PRINCIPALS.map(p =>
    `<button class="principal" data-id="${p.enduser_id}" onclick="selectPrincipal('${p.enduser_id}')">
       <span class="avatar">${esc(p.full_name.split(' ').map(x => x[0]).join('').slice(0, 2))}</span> ${esc(p.full_name)}
       <span class="class-chip ${CLASS_CHIP[p.enduser_class] || 'class-vip'}">${esc(p.enduser_class || 'guest')}</span></button>`).join('')
    || '<span class="small muted">No riders assigned to you yet — ask an admin.</span>';
  document.querySelector('[name=pickup]').innerHTML = locationOptions(LOCS, 'Choose a pickup point…');
  document.querySelector('[name=dropoff]').innerHTML = locationOptions(LOCS, 'Choose a destination…');
  if (PRINCIPALS.length) selectPrincipal(PRINCIPALS[0].enduser_id);
  setInterval(refresh, 15000);
  if (typeof initPushNotifications === 'function') initPushNotifications();
})();
