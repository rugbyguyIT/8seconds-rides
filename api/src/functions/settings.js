// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — app-wide settings (singleton row)
//   GET   /api/app-settings   any signed-in role (theme must be readable app-wide)
//   PATCH /api/app-settings   admin only, writes an audit log entry
// ─────────────────────────────────────────────────────────────
const { app } = require('@azure/functions');
const { query } = require('../db');
const { json, err, requireAuth, requireRole, logAudit } = require('../middleware');

const FIELDS = ['org_display_name', 'support_phone', 'support_email', 'sms_sender_label', 'app_theme', 'pilot_mode'];

app.http('appSettingsGet', {
  methods: ['GET'], authLevel: 'anonymous', route: 'app-settings',
  handler: async (request) => {
    const { error, status } = await requireAuth(request);
    if (error) return err(error, status);
    const r = await query(`SELECT ${FIELDS.join(', ')}, updated_at FROM public.app_settings WHERE id = 1`);
    return json(r.rows[0] || {});
  },
});

app.http('appSettingsUpdate', {
  methods: ['PATCH'], authLevel: 'anonymous', route: 'app-settings',
  handler: async (request) => {
    const { user, error, status } = await requireRole(request, 'admin');
    if (error) return err(error, status);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    if (body.app_theme && !['classic', 'editorial'].includes(body.app_theme)) return err('app_theme must be classic or editorial');
    const sets = []; const vals = []; let i = 1;
    for (const f of FIELDS) if (body[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push(body[f]); }
    if (!sets.length) return err('Nothing to update');
    sets.push(`updated_by = $${i++}`); vals.push(user.sub);
    sets.push(`updated_at = now()`);
    const r = await query(
      `UPDATE public.app_settings SET ${sets.join(', ')} WHERE id = 1 RETURNING ${FIELDS.join(', ')}, updated_at`, vals);
    await logAudit(request, {
      profile_id: user.sub, email: user.email, action: 'settings.updated',
      detail: JSON.stringify(body),
    });
    return json(r.rows[0]);
  },
});

module.exports = {};
