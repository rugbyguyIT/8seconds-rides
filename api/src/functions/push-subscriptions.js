// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — web push subscriptions (8 Seconds pattern)
// ─────────────────────────────────────────────────────────────
const { app } = require('@azure/functions');
const { query } = require('../db');
const { json, err, requireAuth } = require('../middleware');

app.http('vapidPublicKey', {
  methods: ['GET'], authLevel: 'anonymous', route: 'push-subscriptions/vapid-public-key',
  handler: async () => json({ vapidPublicKey: (process.env.VAPID_PUBLIC_KEY || '').trim() }),
});

app.http('pushSubscriptions', {
  methods: ['POST', 'DELETE'], authLevel: 'anonymous', route: 'push-subscriptions',
  handler: async (request) => {
    const { user, error, status } = await requireAuth(request);
    if (error) return err(error, status);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    if (request.method === 'DELETE') {
      await query(`DELETE FROM public.push_subscriptions WHERE endpoint = $1 AND profile_id = $2`,
        [body.endpoint, user.sub]);
      return json({ ok: true });
    }
    const { endpoint, keys } = body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) return err('endpoint and keys required');
    await query(
      `INSERT INTO public.push_subscriptions (profile_id, endpoint, p256dh, auth)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (endpoint) DO UPDATE SET profile_id = $1, p256dh = $3, auth = $4`,
      [user.sub, endpoint, keys.p256dh, keys.auth]);
    return json({ ok: true });
  },
});
