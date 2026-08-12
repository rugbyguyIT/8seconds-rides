const { app } = require('@azure/functions');
const { query } = require('../db');
const { json, err, requireRole } = require('../middleware');

app.http('health', {
  methods: ['GET'], authLevel: 'anonymous', route: 'health',
  handler: async (request) => {
    const { error, status } = await requireRole(request, 'admin');
    if (error) return err(error, status);
    let db = false, counts = {};
    try {
      const r = await query(`SELECT
        (SELECT count(*) FROM public.profiles) AS profiles,
        (SELECT count(*) FROM public.rides) AS rides,
        (SELECT count(*) FROM public.notification_outbox WHERE status = 'pending') AS pending_notifications`);
      db = true; counts = r.rows[0];
    } catch {}
    return json({
      ok: db, db, counts,
      config: {
        jwt: !!process.env.JWT_SECRET,
        vapid: !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY,
        twilio: !!process.env.TWILIO_ACCOUNT_SID,
        otp_test_mode: !!process.env.OTP_TEST_CODE,
        bootstrap_enabled: !!process.env.BOOTSTRAP_SECRET,
      },
    });
  },
});
