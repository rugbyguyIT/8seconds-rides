// Shared ride rendering helpers for all portals
const STATUS_META = {
  requested:   { badge: 'badge-pending',  strip: 'var(--amber)',  label: 'Awaiting approval', icon: 'fa-hourglass-half' },
  approved:    { badge: 'badge-approved', strip: 'var(--green)',  label: 'Approved',           icon: 'fa-circle-check' },
  assigned:    { badge: 'badge-active',   strip: 'var(--blue)',   label: 'Driver assigned',    icon: 'fa-id-badge' },
  en_route:    { badge: 'badge-live',     strip: 'var(--orange)', label: 'Driver en route',    icon: 'fa-circle' },
  arrived:     { badge: 'badge-live',     strip: 'var(--orange)', label: 'Driver arrived',     icon: 'fa-location-dot' },
  in_progress: { badge: 'badge-live',     strip: 'var(--orange)', label: 'In progress',        icon: 'fa-car-side' },
  completed:   { badge: 'badge-neutral',  strip: 'var(--navy)',   label: 'Completed',          icon: 'fa-flag-checkered' },
  denied:      { badge: 'badge-no',       strip: 'var(--red)',    label: 'Declined',           icon: 'fa-ban' },
  cancelled:   { badge: 'badge-no',       strip: 'var(--red)',    label: 'Cancelled',          icon: 'fa-xmark' },
  no_show:     { badge: 'badge-no',       strip: 'var(--red)',    label: 'No-show',            icon: 'fa-user-slash' },
};
const CLASS_CHIP = { vip: 'class-vip', executive: 'class-exec', performer: 'class-performer', guest: 'class-vip' };

function rideRoute(r) {
  return `${esc(r.pickup_name || r.pickup_text || '?')} <i class="fa-solid fa-arrow-right-long route-arrow"></i> ${esc(r.dropoff_name || r.dropoff_text || '?')}`;
}
function rideMeta(r) {
  const bits = [`<span class="event-meta-item"><i class="fa-solid fa-clock"></i> ${esc(fmtWhen(r.scheduled_at))}</span>`,
                `<span class="event-meta-item"><i class="fa-solid fa-user-group"></i> Party of ${r.party_size}</span>`];
  if (r.round_trip) bits.push(`<span class="event-meta-item"><i class="fa-solid fa-rotate"></i> Round trip</span>`);
  if (r.ada_required) bits.push(`<span class="event-meta-item"><i class="fa-brands fa-accessible-icon"></i> ADA</span>`);
  if (r.driver_name) bits.push(`<span class="event-meta-item"><i class="fa-solid fa-id-badge"></i> ${esc(r.driver_name)} · ${esc(r.vehicle_label || '')}</span>`);
  return bits.join('');
}
function rideCard(r, actionsHtml, titlePrefix) {
  const m = STATUS_META[r.status] || STATUS_META.requested;
  return `<div class="event-card"><div class="ec-strip" style="background:${m.strip}"></div><div class="ec-body">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div class="event-title">${titlePrefix ? esc(titlePrefix) + ' · ' : ''}${rideRoute(r)}</div>
      <span class="badge ${m.badge}"><i class="fa-solid ${m.icon}"></i> ${m.label}</span>
    </div>
    <div class="event-meta">${rideMeta(r)}</div>
    ${actionsHtml ? `<div class="event-footer"><span class="small muted">Requested ${esc(fmtWhen(r.created_at))}</span><div class="event-actions">${actionsHtml}</div></div>` : ''}
  </div></div>`;
}
async function rideAction(id, action, extra, confirmMsg) {
  if (confirmMsg && !confirm(confirmMsg)) return;
  let reason;
  if (['deny', 'cancel_active'].includes(action)) {
    reason = prompt('Reason (required — the rider and handler will see it):');
    if (!reason) return;
  }
  const { data, error } = await api(`/rides/${id}/action`, 'POST', { action, reason, ...(extra || {}) });
  if (error) { toastMsg('Could not complete that', error); return; }
  toastMsg('Done', `${data.enqueued} notification${data.enqueued === 1 ? '' : 's'} queued.`);
  if (typeof refresh === 'function') refresh();
}
function locationOptions(locs, sel) {
  return `<option value="">${sel || 'Choose…'}</option>` +
    locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
}
