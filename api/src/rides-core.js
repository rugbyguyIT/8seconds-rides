// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — ride state machine + notifications
//
// EVERY ride mutation goes through performAction(). It does, in ONE
// Postgres transaction:
//   1. guarded state transition (optimistic: WHERE status = ANY(from))
//   2. append-only ride_events row naming the actor
//   3. notification_outbox rows (deduped by unique constraint)
// Notifications are delivered by flushOutbox() — at-least-once, never
// duplicated (see notifications.js).
// ─────────────────────────────────────────────────────────────
const { query, withTransaction } = require('./db');

const TRANSITIONS = {
  approve:       { from: ['requested'], to: 'approved',  roles: ['dispatch', 'admin'] },
  deny:          { from: ['requested'], to: 'denied',    roles: ['dispatch', 'admin'], reasonRequired: true },
  assign:        { from: ['approved', 'assigned', 'en_route'], to: 'assigned', roles: ['dispatch', 'admin'] },
  start:         { from: ['assigned'], to: 'en_route',   roles: ['driver'] },
  arrive:        { from: ['en_route'], to: 'arrived',    roles: ['driver'] },
  pickup:        { from: ['arrived'],  to: 'in_progress', roles: ['driver'] },
  complete:      { from: ['in_progress'], to: 'completed', roles: ['driver'] },
  no_show:       { from: ['arrived'],  to: 'no_show',    roles: ['driver', 'dispatch', 'admin'] },
  cancel:        { from: ['requested', 'approved', 'assigned'], to: 'cancelled', roles: ['rider', 'handler', 'dispatch', 'admin'] },
  cancel_active: { from: ['en_route', 'arrived', 'in_progress'], to: 'cancelled', roles: ['dispatch', 'admin'], reasonRequired: true },
  alert:         { from: null, to: null, roles: ['driver'] }, // driver_alert: event only, no state change
};

const ACTION_EVENT = {
  approve: 'approved', deny: 'denied', assign: 'assigned', start: 'started',
  arrive: 'arrived', pickup: 'picked_up', complete: 'completed',
  no_show: 'no_show', cancel: 'cancelled', cancel_active: 'cancelled', alert: 'driver_alert',
};

async function getRideContext(client, rideId) {
  const r = await client.query(
    `SELECT r.*, p.full_name AS enduser_name, p.phone_mobile AS enduser_phone,
            p.enduser_class,
            pl.name AS pickup_name, dl.name AS dropoff_name
     FROM public.rides r
     JOIN public.profiles p ON p.id = r.enduser_id
     LEFT JOIN public.locations pl ON pl.id = r.pickup_location_id
     LEFT JOIN public.locations dl ON dl.id = r.dropoff_location_id
     WHERE r.id = $1`, [rideId]);
  const ride = r.rows[0];
  if (!ride) return null;
  const a = await client.query(
    `SELECT ra.*, d.full_name AS driver_name, d.phone_mobile AS driver_phone,
            v.label AS vehicle_label, v.color_desc
     FROM public.ride_assignments ra
     JOIN public.profiles d ON d.id = ra.driver_id
     JOIN public.vehicles v ON v.id = ra.vehicle_id
     WHERE ra.ride_id = $1 AND ra.active = TRUE
     ORDER BY ra.assigned_at DESC LIMIT 1`, [rideId]);
  ride.assignment = a.rows[0] || null;
  return ride;
}

function routeText(ride) {
  const pu = ride.pickup_name || ride.pickup_text || 'pickup';
  const dr = ride.dropoff_name || ride.dropoff_text || 'drop-off';
  return `${pu} → ${dr}`;
}

function whenText(ride) {
  if (!ride.scheduled_at) return 'ASAP';
  return new Date(ride.scheduled_at).toLocaleString('en-US',
    { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

// Notification fan-out matrix. Returns [{profileId, channel, title, body}]
async function buildNotifications(client, event, ride, actor, opts) {
  const out = [];
  const route = routeText(ride);
  const when = whenText(ride);
  const reason = opts.reason ? ` Reason: ${opts.reason}` : '';
  const asg = ride.assignment;
  const vehicleLine = asg ? `${asg.driver_name} in ${asg.color_desc || ''} ${asg.vehicle_label}`.trim() : '';

  const handlers = (await client.query(
    `SELECT handler_id FROM public.handler_assignments WHERE enduser_id = $1 AND active = TRUE`,
    [ride.enduser_id])).rows.map(x => x.handler_id);
  const staff = (await client.query(
    `SELECT id, role FROM public.profiles WHERE role IN ('dispatch','admin') AND status = 'active'`)).rows;
  const admins = staff.filter(s => s.role === 'admin').map(s => s.id);
  const dispatchers = staff.map(s => s.id); // dispatch + admin

  const add = (profileId, channel, title, body) => {
    if (!profileId || profileId === actor.sub) return; // don't notify the actor
    out.push({ profileId, channel, title, body });
  };
  const rider = (title, body, sms) => {
    add(ride.enduser_id, 'push', title, body);
    if (sms) add(ride.enduser_id, 'sms', title, body);
    handlers.forEach(h => add(h, 'push', `[${ride.enduser_name}] ${title}`, body));
  };

  switch (event) {
    case 'requested':
      rider('Ride requested', `${when} · ${route}. You'll be notified when dispatch approves it.`);
      dispatchers.forEach(d => add(d, 'push', 'New ride request', `${ride.enduser_name} (${ride.enduser_class || 'guest'}) · ${when} · ${route}`));
      break;
    case 'approved':
      rider('Ride approved', `${when} · ${route}. A driver will be assigned shortly.`, true);
      break;
    case 'denied':
      rider('Ride request declined', `${when} · ${route}.${reason}`, true);
      break;
    case 'assigned':
      rider('Driver assigned', `${when} · ${route}. ${vehicleLine}.`);
      if (asg) { add(asg.driver_id, 'push', 'New pickup assigned', `${when} · ${ride.enduser_name} · ${route}`);
                 add(asg.driver_id, 'sms',  'New pickup assigned', `${when} · ${ride.enduser_name} · ${route}`); }
      break;
    case 'started':
      rider('Your driver is on the way', `${vehicleLine} is heading to ${ride.pickup_name || ride.pickup_text}.`, true);
      admins.forEach(a2 => add(a2, 'push', 'Drive started', `${asg ? asg.driver_name : 'Driver'} · ${route}`));
      break;
    case 'arrived':
      rider('Your driver has arrived', `${vehicleLine} is waiting at ${ride.pickup_name || ride.pickup_text}.`, true);
      break;
    case 'picked_up':
      handlers.forEach(h => add(h, 'push', `[${ride.enduser_name}] Picked up`, `${route}`));
      admins.forEach(a2 => add(a2, 'push', 'Picked up', `${ride.enduser_name} · ${route}`));
      break;
    case 'completed':
      handlers.forEach(h => add(h, 'push', `[${ride.enduser_name}] Ride complete`, `${route}`));
      admins.forEach(a2 => add(a2, 'push', 'Ride complete', `${ride.enduser_name} · ${route}`));
      break;
    case 'cancelled': {
      const by = actor.role === 'rider' ? 'you' :
                 actor.role === 'handler' ? 'your assistant' : 'dispatch';
      rider('Ride cancelled', `${when} · ${route} was cancelled by ${by}.${reason}`, true);
      if (asg) { add(asg.driver_id, 'push', 'Ride cancelled', `${when} · ${route}.${reason}`);
                 add(asg.driver_id, 'sms',  'Ride cancelled', `${when} · ${route}.${reason}`); }
      dispatchers.forEach(d => add(d, 'push', 'Ride cancelled', `${ride.enduser_name} · ${when} · ${route}.${reason}`));
      break;
    }
    case 'no_show':
      handlers.forEach(h => { add(h, 'push', `[${ride.enduser_name}] No-show`, `${route}. Driver released.`);
                              add(h, 'sms',  `[${ride.enduser_name}] No-show`, `${route}. Driver released.`); });
      dispatchers.forEach(d => add(d, 'push', 'No-show', `${ride.enduser_name} · ${route}`));
      break;
    case 'driver_alert': {
      // Hard/actionable to dispatch; SOFT (push only, reworded) to rider + handlers.
      const kind = opts.alertKind === 'vehicle' ? 'Vehicle issue' : 'Traffic delay';
      dispatchers.forEach(d => add(d, 'push', `⚠ ${kind} — action needed`,
        `${asg ? asg.driver_name + ' / ' + asg.vehicle_label : 'Driver'} · ${route}. ${opts.note || ''}`));
      const soft = opts.alertKind === 'vehicle'
        ? `We're arranging things on our end for your ${when.toLowerCase() === 'asap' ? '' : when + ' '}ride — dispatch is on it and will update you shortly.`
        : `Your driver is running a little behind due to traffic. Updated arrival will follow automatically.`;
      rider(kind === 'Vehicle issue' ? 'Quick update on your ride' : 'Your driver is delayed', soft);
      break;
    }
  }
  return out;
}

// The single mutation path. Returns { ride, event } or throws { status, message }.
async function performAction(rideId, action, actor, opts = {}) {
  const t = TRANSITIONS[action];
  if (!t) throw { status: 400, message: `Unknown action '${action}'` };
  if (!t.roles.includes(actor.role)) throw { status: 403, message: 'Forbidden' };
  if (t.reasonRequired && !opts.reason) throw { status: 400, message: 'A reason is required' };

  return withTransaction(async (client) => {
    let ride = await getRideContext(client, rideId);
    if (!ride) throw { status: 404, message: 'Ride not found' };

    // Ownership checks for non-staff actors
    if (actor.role === 'rider' && ride.enduser_id !== actor.sub)
      throw { status: 403, message: 'Not your ride' };
    if (actor.role === 'handler') {
      const ok = await client.query(
        `SELECT 1 FROM public.handler_assignments WHERE handler_id = $1 AND enduser_id = $2 AND active = TRUE`,
        [actor.sub, ride.enduser_id]);
      if (!ok.rows.length) throw { status: 403, message: 'Not assigned to this rider' };
    }
    if (actor.role === 'driver' && action !== 'alert') {
      if (!ride.assignment || ride.assignment.driver_id !== actor.sub)
        throw { status: 403, message: 'Not your assignment' };
    }

    // State transition (skip for alert)
    if (t.to) {
      const upd = await client.query(
        `UPDATE public.rides SET status = $1, updated_at = now()
         WHERE id = $2 AND status = ANY($3) RETURNING status`,
        [t.to, rideId, t.from]);
      if (!upd.rows.length)
        throw { status: 409, message: `Ride is '${ride.status}' — '${action}' not allowed from that state` };
      ride.status = t.to;
    }

    // Assignment bookkeeping
    if (action === 'assign') {
      if (!opts.driverId || !opts.vehicleId) throw { status: 400, message: 'driverId and vehicleId required' };
      await client.query(
        `UPDATE public.ride_assignments SET active = FALSE, ended_at = now(), end_reason = 'reassigned'
         WHERE ride_id = $1 AND active = TRUE`, [rideId]);
      await client.query(
        `INSERT INTO public.ride_assignments (ride_id, driver_id, vehicle_id, assigned_by)
         VALUES ($1, $2, $3, $4)`, [rideId, opts.driverId, opts.vehicleId, actor.sub]);
      ride = await getRideContext(client, rideId); // refresh with new assignment
    }
    if (['completed', 'cancelled', 'denied', 'no_show'].includes(ride.status)) {
      await client.query(
        `UPDATE public.ride_assignments SET active = FALSE, ended_at = now(),
                end_reason = COALESCE(end_reason, $2)
         WHERE ride_id = $1 AND active = TRUE`, [rideId, ride.status]);
    }

    // Event row
    const event = ACTION_EVENT[action];
    const ev = await client.query(
      `INSERT INTO public.ride_events (ride_id, event, actor_id, actor_role, reason, payload)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [rideId, event, actor.sub, actor.role, opts.reason || null,
       JSON.stringify({ alertKind: opts.alertKind, note: opts.note, driverId: opts.driverId, vehicleId: opts.vehicleId })]);
    const eventId = ev.rows[0].id;

    // Outbox rows (unique constraint = dedupe guarantee)
    const notifs = await buildNotifications(client, event, ride, actor, opts);
    for (const n of notifs) {
      await client.query(
        `INSERT INTO public.notification_outbox (ride_event_id, recipient_id, channel, title, body)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (ride_event_id, recipient_id, channel) DO NOTHING`,
        [eventId, n.profileId, n.channel, n.title, n.body]);
    }

    return { ride, eventId, enqueued: notifs.length };
  });
}

// Called on ride creation (not a transition) to emit 'requested' notifications.
async function emitRequested(rideId, actor) {
  return withTransaction(async (client) => {
    const ride = await getRideContext(client, rideId);
    const ev = await client.query(
      `INSERT INTO public.ride_events (ride_id, event, actor_id, actor_role)
       VALUES ($1, 'requested', $2, $3) RETURNING id`, [rideId, actor.sub, actor.role]);
    const notifs = await buildNotifications(client, 'requested', ride, actor, {});
    for (const n of notifs) {
      await client.query(
        `INSERT INTO public.notification_outbox (ride_event_id, recipient_id, channel, title, body)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (ride_event_id, recipient_id, channel) DO NOTHING`,
        [ev.rows[0].id, n.profileId, n.channel, n.title, n.body]);
    }
    return { enqueued: notifs.length };
  });
}

module.exports = { performAction, emitRequested, TRANSITIONS };
