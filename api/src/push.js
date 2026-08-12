// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — Web Push helper
//
// Env vars required:
//   VAPID_PUBLIC_KEY   — generated base64url public key
//   VAPID_PRIVATE_KEY  — generated base64url private key
//   VAPID_SUBJECT      — mailto: or https: contact URL
//                        e.g. "mailto:admin@rodeohouston.com"
//
// Usage:
//   const { sendPush, sendPushToProfile } = require('../push');
//   await sendPushToProfile(profileId, { title: 'New invite!', body: '...', url: '/pages/exec.html' });
// ─────────────────────────────────────────────────────────────

const webpush  = require('web-push');
const { query } = require('./db');

let _configured = false;

function _configure() {
  if (_configured) return;
  const pub     = process.env.VAPID_PUBLIC_KEY;
  const priv    = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@rodeohouston.com';
  if (!pub || !priv) {
    console.warn('[push] VAPID keys not configured — push notifications disabled');
    return;
  }
  webpush.setVapidDetails(subject, pub, priv);
  _configured = true;
}

/**
 * Send a push notification to a single PushSubscription object.
 * @param {{ endpoint, keys: { p256dh, auth } }} subscription
 * @param {{ title, body, url, icon }} payload
 */
async function sendPush(subscription, payload) {
  _configure();
  if (!_configured) return { ok: false, error: 'VAPID not configured' };

  try {
    await webpush.sendNotification(subscription, JSON.stringify({
      title: payload.title || '8 Seconds Ride Management',
      body:  payload.body  || '',
      icon:  payload.icon  || '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      url:   payload.url   || '/',
    }));
    return { ok: true };
  } catch (e) {
    // 410 Gone = subscription expired/unsubscribed — caller should delete it
    return { ok: false, status: e.statusCode, error: e.message };
  }
}

/**
 * Send a push to ALL active subscriptions for a given profile.
 * Automatically removes expired subscriptions (HTTP 410).
 * @param {string} profileId
 * @param {{ title, body, url, icon }} payload
 */
async function sendPushToProfile(profileId, payload) {
  _configure();
  if (!_configured) return;

  let subs;
  try {
    const res = await query(
      `SELECT id, endpoint, p256dh, auth FROM public.push_subscriptions WHERE profile_id = $1`,
      [profileId]
    );
    subs = res.rows;
  } catch (e) {
    console.error('[push] DB error fetching subscriptions:', e.message);
    return;
  }

  if (!subs.length) return;

  await Promise.all(subs.map(async sub => {
    const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
    const result = await sendPush(subscription, payload);
    if (!result.ok && result.status === 410) {
      // Subscription gone — clean it up
      await query(`DELETE FROM public.push_subscriptions WHERE id = $1`, [sub.id]).catch(() => {});
      console.log(`[push] Removed stale subscription ${sub.id} for profile ${profileId}`);
    } else if (!result.ok) {
      console.warn(`[push] Failed to push to ${sub.endpoint}: ${result.error}`);
    }
  }));
}

/**
 * Send a push to multiple profile IDs (bulk).
 */
async function sendPushToProfiles(profileIds, payload) {
  if (!profileIds?.length) return;
  await Promise.all(profileIds.map(id => sendPushToProfile(id, payload)));
}

module.exports = { sendPush, sendPushToProfile, sendPushToProfiles };
