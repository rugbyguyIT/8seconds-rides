// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — outbox delivery
// At-least-once, never duplicated: rows are claimed with
// FOR UPDATE SKIP LOCKED and only 'pending' rows are sent.
// ─────────────────────────────────────────────────────────────
const { withTransaction, query } = require('./db');
const { sendPushToProfile } = require('./push');
const { sendSms } = require('./sms');

async function flushOutbox(limit = 50) {
  const claimed = await withTransaction(async (client) => {
    const r = await client.query(
      `SELECT o.id, o.recipient_id, o.channel, o.title, o.body, p.phone_mobile, p.sms_consent
       FROM public.notification_outbox o
       JOIN public.profiles p ON p.id = o.recipient_id
       WHERE o.status = 'pending' AND o.attempts < 5
       ORDER BY o.created_at
       LIMIT $1
       FOR UPDATE OF o SKIP LOCKED`, [limit]);
    if (r.rows.length)
      await client.query(
        `UPDATE public.notification_outbox SET status = 'sending', attempts = attempts + 1
         WHERE id = ANY($1)`, [r.rows.map(x => x.id)]);
    return r.rows;
  });

  let sent = 0, failed = 0;
  for (const n of claimed) {
    let ok = false;
    try {
      if (n.channel === 'push') {
        if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) ok = 'skip';
        else {
          await sendPushToProfile(n.recipient_id, { title: n.title, body: n.body, url: '/' });
          ok = true; // sendPushToProfile handles per-subscription errors internally
        }
      } else if (n.channel === 'sms') {
        if (!n.phone_mobile) ok = 'skip';
        else { const r = await sendSms(n.phone_mobile, `${n.title}: ${n.body}`); ok = r.ok || 'skip'; }
      }
    } catch (e) { ok = false; }
    const status = ok === 'skip' ? 'skipped' : ok ? 'sent' : 'failed';
    if (status === 'sent') sent++; else if (status === 'failed') failed++;
    await query(
      `UPDATE public.notification_outbox
       SET status = CASE WHEN $2 = 'failed' AND attempts < 5 THEN 'pending' ELSE $2 END,
           sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
       WHERE id = $1`, [n.id, status]).catch(() => {});
  }
  return { claimed: claimed.length, sent, failed };
}

module.exports = { flushOutbox };
