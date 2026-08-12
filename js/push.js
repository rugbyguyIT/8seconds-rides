// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — Push Notification subscription manager
//
// Call initPushNotifications() after login on any dashboard.
// Silently skips if browser doesn't support push or user has
// previously denied permission.
// ─────────────────────────────────────────────────────────────

// How long to wait before prompting after login (ms)
const PUSH_PROMPT_DELAY_MS = 5000;

// LocalStorage key to avoid re-prompting every login
const PUSH_PROMPTED_KEY = 'rides_push_prompted';

/**
 * Call once after a successful login on any portal page.
 * Fetches the VAPID public key, then requests permission and subscribes.
 */
async function initPushNotifications() {
  // Feature check
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  // Already subscribed? Re-save subscription in case it changed
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  if (!reg) return;

  const existing = await reg.pushManager.getSubscription().catch(() => null);
  if (existing) {
    // Re-register silently to keep DB in sync
    await _saveSubscription(existing);
    return;
  }

  // If user previously denied, don't ask again
  if (Notification.permission === 'denied') return;

  // Wait a beat before prompting so the dashboard has loaded
  await new Promise(r => setTimeout(r, PUSH_PROMPT_DELAY_MS));

  await _requestAndSubscribe(reg);
}

/**
 * Explicitly request permission and subscribe (call from a "Enable notifications" button).
 */
async function enablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, error: 'Push not supported in this browser' };
  }
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  if (!reg) return { ok: false, error: 'Service worker not ready' };
  return _requestAndSubscribe(reg);
}

/**
 * Unsubscribe from push on this device.
 */
async function disablePushNotifications() {
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  await sub.unsubscribe().catch(() => {});
  // Remove from server
  const token = localStorage.getItem('rides_token') || sessionStorage.getItem('rides_token') || '';
  await fetch('/api/push-subscriptions', {
    method:  'DELETE',
    headers: { 'Content-Type': 'application/json', 'x-rides-token': token },
    body:    JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
}

/**
 * Returns the current push permission state: 'granted' | 'denied' | 'default'
 */
function pushPermissionState() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

// ── Internal helpers ──────────────────────────────────

async function _requestAndSubscribe(reg) {
  // Request permission FIRST — iOS Safari only allows this inside the
  // user's tap gesture, and any awaited network call beforehand can void
  // the gesture and silently auto-deny the request.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, error: 'Permission denied' };

  // Get VAPID public key from server
  let vapidPublicKey;
  try {
    const res  = await fetch('/api/push-subscriptions/vapid-public-key', { cache: 'no-store' });
    if (!res.ok) return { ok: false, error: `VAPID key fetch failed (HTTP ${res.status})` };
    const data = await res.json();
    // Sanitize — strip accidental quotes/whitespace from env-var values
    vapidPublicKey = String(data.vapidPublicKey || '').trim().replace(/^['"]+|['"]+$/g, '');
    if (!vapidPublicKey) return { ok: false, error: 'Server returned empty VAPID key' };
  } catch (e) {
    return { ok: false, error: `VAPID key fetch failed: ${e.message}` };
  }

  // Decode + validate the key BEFORE handing it to the browser — a Web
  // Push applicationServerKey must be a 65-byte uncompressed P-256 point
  // starting with 0x04. Safari reports bad keys with the useless
  // "The string did not match the expected pattern." — we say what's wrong.
  let appServerKey;
  try {
    appServerKey = _urlBase64ToUint8Array(vapidPublicKey);
  } catch (e) {
    return { ok: false, error: `VAPID key is not valid base64url (${e.message})` };
  }
  if (appServerKey.length !== 65 || appServerKey[0] !== 4) {
    return { ok: false, error: `Server VAPID key invalid: ${appServerKey.length} bytes, first byte 0x${appServerKey[0].toString(16)} (expected 65 bytes / 0x4)` };
  }

  // Subscribe
  let subscription;
  try {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: appServerKey,
    });
  } catch (e) {
    return { ok: false, error: `Subscribe failed — ${e.name}: ${e.message}` };
  }

  return _saveSubscription(subscription);
}

async function _saveSubscription(subscription) {
  const token = localStorage.getItem('rides_token') || sessionStorage.getItem('rides_token') || '';
  try {
    const sub  = subscription.toJSON();
    const res  = await fetch('/api/push-subscriptions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-rides-token': token },
      body:    JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys }),
    });
    if (!res.ok) return { ok: false, error: `Save failed (HTTP ${res.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Save failed: ${e.message}` };
  }
}

function _urlBase64ToUint8Array(base64String) {
  const padding  = '='.repeat((4 - base64String.length % 4) % 4);
  const base64   = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData  = atob(base64);
  const output   = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
  return output;
}
