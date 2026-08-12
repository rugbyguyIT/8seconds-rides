// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — outbox flush + inspection
//   POST /api/notifications/flush   x-flush-secret OR admin JWT
//        (GitHub Actions cron hits this every 5 min — SWA managed
//         functions can't run timer triggers, same as 8 Seconds nightly)
//   GET  /api/notifications/recent  admin
// ─────────────────────────────────────────────────────────────
const { app } = require('@azure/functions');
const { query } = require('../db');
const { json, err, requireRole } = require('../middleware');
const { flushOutbox } = require('../notifier');

app.http('notificationsFlush', {
  methods: ['POST'], authLevel: 'anonymous', route: 'notifications/flush',
  handler: async (request) => {
    const secret = process.env.FLUSH_SECRET;
    const provided = request.headers.get('x-flush-secret');
    if (!secret || provided !== secret) {
      const { error, status } = await requireRole(request, 'admin');
      if (error) return err(error, status);
    }
    const result = await flushOutbox(100);
    return json(result);
  },
});

app.http('notificationsRecent', {
  methods: ['GET'], authLevel: 'anonymous', route: 'notifications/recent',
  handler: async (request) => {
    const { error, status } = await requireRole(request, 'admin');
    if (error) return err(error, status);
    const r = await query(
      `SELECT o.id, o.channel, o.title, o.body, o.status, o.attempts, o.created_at, o.sent_at,
              p.full_name AS recipient
       FROM public.notification_outbox o JOIN public.profiles p ON p.id = o.recipient_id
       ORDER BY o.created_at DESC LIMIT 100`);
    return json(r.rows);
  },
});
