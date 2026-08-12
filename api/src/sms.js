// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — SMS helper (Twilio)
//
// Env vars required:
//   TWILIO_ACCOUNT_SID   — from Twilio Console dashboard (starts 'AC...')
//   TWILIO_AUTH_TOKEN    — from Twilio Console dashboard
// And ONE sender (Messaging Service preferred for production):
//   TWILIO_MESSAGING_SERVICE_SID  — 'MG...'  (preferred), OR
//   TWILIO_FROM_PHONE             — E.164 number you own, e.g. +13105551234
//
// Usage (unchanged from the ACS version):
//   const { sendSms } = require('../sms');
//   await sendSms('+17135550001', 'Your code is 482910');
// ─────────────────────────────────────────────────────────────

let _client = null;

function _getClient() {
  if (_client) return _client;
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not configured');
  const twilio = require('twilio');
  _client = twilio(sid, token);
  return _client;
}

/**
 * Normalise a US phone number to E.164 (+1XXXXXXXXXX).
 * Returns null if the number can't be parsed.
 */
function formatPhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return null;
}

/**
 * Build a masked hint for the UI: "***-***-1234"
 */
function phoneHint(raw) {
  const e164 = formatPhone(raw);
  if (!e164) return null;
  const d = e164.replace(/\D/g, ''); // 11 digits
  return `***-***-${d.slice(-4)}`;
}

/**
 * Send an SMS message via Twilio.
 * @param {string} to  — raw phone number (10 or 11 digits, any format)
 * @param {string} message
 * @returns {{ ok: boolean, error?: string, sid?: string }}
 */
async function sendSms(to, message) {
  const fromPhone  = process.env.TWILIO_FROM_PHONE;
  const msgService = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!fromPhone && !msgService) {
    console.warn('[sms] No TWILIO_FROM_PHONE or TWILIO_MESSAGING_SERVICE_SID set — skipping SMS');
    return { ok: false, error: 'Twilio sender not configured' };
  }

  const toE164 = formatPhone(to);
  if (!toE164) {
    console.warn(`[sms] Could not parse phone number: "${to}"`);
    return { ok: false, error: 'Invalid phone number' };
  }

  try {
    const client = _getClient();
    const params = { to: toE164, body: message };
    // Prefer a Messaging Service (handles sender pool + A2P) if present,
    // otherwise send from the single purchased number.
    if (msgService) params.messagingServiceSid = msgService;
    else            params.from = fromPhone;

    const result = await client.messages.create(params);

    // Twilio resolves on accept; a hard send failure throws. A non-throwing
    // 'failed'/'undelivered' status only appears later via webhooks, so for
    // our synchronous purposes a returned SID means accepted-for-delivery.
    if (result.errorCode) {
      console.warn(`[sms] Twilio error ${result.errorCode} to ${toE164}: ${result.errorMessage}`);
      return { ok: false, error: result.errorMessage || `Twilio error ${result.errorCode}` };
    }
    return { ok: true, sid: result.sid };
  } catch (e) {
    console.error('[sms] sendSms error:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Bulk-send the same message to many phone numbers.
 * Returns array of { to, ok, error }.
 */
async function sendSmsBulk(phones, message) {
  const results = await Promise.allSettled(
    phones.map(p => sendSms(p, message).then(r => ({ to: p, ...r })))
  );
  return results.map(r => r.status === 'fulfilled' ? r.value : { to: '?', ok: false, error: r.reason?.message });
}

module.exports = { sendSms, sendSmsBulk, formatPhone, phoneHint };
