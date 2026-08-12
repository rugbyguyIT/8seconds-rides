// ─────────────────────────────────────────────────────────────
// 8 Second Rides — admin-editable vehicle classes + photos
//   GET  /api/vehicle-classes                 list (any authenticated role)
//   POST /api/vehicle-classes                 create {key, label}           (admin)
//   PATCH /api/vehicle-classes/{id}            update {label,active,photo_url} (admin)
//   POST /api/vehicle-classes/{id}/photo       {mode:'upload', data_url}       (admin)
//                                               {mode:'generate', prompt}       (admin)
// Vehicle photos work the same way via vehicles.js's PATCH /api/vehicles/{id}
// (photo_url field) — this file just owns the shared upload/generate logic.
//
// Env for uploads:  AZURE_STORAGE_CONNECTION_STRING
// Env for AI photos: OPENAI_API_KEY
// Both are optional — if missing, the relevant action returns a clear
// 503 instead of a stack trace, same pattern as MAPBOX_TOKEN.
// ──────────────────────────────────────────────────────────
const { app } = require('@azure/functions');
const { query } = require('../db');
const { json, err, requireAuth, requireRole, logApp } = require('../middleware');
const blob = require('../blob');

async function generateVehiclePhoto(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error('AI photo generation is not configured yet (OPENAI_API_KEY missing).'), { status: 503 });
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: `Professional studio product photo of ${prompt}, three-quarter front angle, clean plain light-grey background, realistic, no text, no watermark, no people`,
      size: '1024x1024',
      n: 1,
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw Object.assign(new Error('AI photo generation failed. Try again.'), { status: 502, detail });
  }
  const data = await r.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw Object.assign(new Error('AI photo generation returned no image.'), { status: 502 });
  return `data:image/png;base64,${b64}`;
}

app.http('vehicleClasses', {
  methods: ['GET', 'POST'], authLevel: 'anonymous', route: 'vehicle-classes',
  handler: async (request) => {
    if (request.method === 'GET') {
      const { error, status } = await requireAuth(request);
      if (error) return err(error, status);
      const r = await query(`SELECT * FROM public.vehicle_classes WHERE active = TRUE ORDER BY sort_order, label`);
      return json(r.rows);
    }
    const { error, status } = await requireRole(request, 'admin');
    if (error) return err(error, status);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { key, label } = body || {};
    if (!key || !label) return err('key and label are required');
    const slug = String(key).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug) return err('key must contain at least one letter or number');
    try {
      const r = await query(
        `INSERT INTO public.vehicle_classes (key, label) VALUES ($1,$2) RETURNING *`,
        [slug, String(label).trim()]);
      return json(r.rows[0], 201);
    } catch (e) {
      if (e.code === '23505') return err(`A class with key "${slug}" already exists`, 409);
      throw e;
    }
  },
});

app.http('vehicleClassesUpdate', {
  methods: ['PATCH'], authLevel: 'anonymous', route: 'vehicle-classes/{id}',
  handler: async (request) => {
    const { error, status } = await requireRole(request, 'admin');
    if (error) return err(error, status);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const sets = []; const vals = []; let i = 1;
    for (const f of ['label', 'active', 'photo_url', 'sort_order']) {
      if (body[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push(body[f]); }
    }
    if (!sets.length) return err('Nothing to update');
    vals.push(request.params.id);
    const r = await query(`UPDATE public.vehicle_classes SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    return json(r.rows[0] || null);
  },
});

// Shared photo endpoint for a vehicle CLASS. Vehicle-level photo upload
// reuses the same {mode,...} contract via /api/vehicles/{id}/photo below.
app.http('vehicleClassPhoto', {
  methods: ['POST'], authLevel: 'anonymous', route: 'vehicle-classes/{id}/photo',
  handler: async (request) => {
    const { user, error, status } = await requireRole(request, 'admin');
    if (error) return err(error, status);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    try {
      const url = await resolvePhoto('class', request.params.id, body, user);
      const r = await query(`UPDATE public.vehicle_classes SET photo_url = $1 WHERE id = $2 RETURNING *`, [url, request.params.id]);
      return json(r.rows[0] || null);
    } catch (e) {
      logApp('warn', 'vehicle_class.photo_failed', e.message, { profile_id: user.sub, email: user.email });
      return err(e.message, e.status || 500);
    }
  },
});

app.http('vehiclePhoto', {
  methods: ['POST'], authLevel: 'anonymous', route: 'vehicles/{id}/photo',
  handler: async (request) => {
    const { user, error, status } = await requireRole(request, 'dispatch', 'admin');
    if (error) return err(error, status);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    try {
      const url = await resolvePhoto('vehicle', request.params.id, body, user);
      const r = await query(`UPDATE public.vehicles SET photo_url = $1 WHERE id = $2 RETURNING *`, [url, request.params.id]);
      return json(r.rows[0] || null);
    } catch (e) {
      logApp('warn', 'vehicle.photo_failed', e.message, { profile_id: user.sub, email: user.email });
      return err(e.message, e.status || 500);
    }
  },
});

// {mode:'upload', data_url} — stores exactly what was uploaded.
// {mode:'generate', prompt} — asks OpenAI for an image, then stores it
// to our own blob storage so it doesn't depend on a third-party URL's
// lifetime, and returns our permanent URL either way.
async function resolvePhoto(prefix, id, body, user) {
  const { mode, data_url, prompt } = body || {};
  if (!blob.configured()) {
    const e = new Error('Photo storage is not configured yet (AZURE_STORAGE_CONNECTION_STRING missing).');
    e.status = 503; throw e;
  }
  if (mode === 'upload') {
    if (!data_url) { const e = new Error('data_url is required'); e.status = 400; throw e; }
    return blob.uploadDataUrl(prefix, id, data_url);
  }
  if (mode === 'generate') {
    if (!prompt || !prompt.trim()) { const e = new Error('prompt is required'); e.status = 400; throw e; }
    const generated = await generateVehiclePhoto(prompt.trim());
    return blob.uploadDataUrl(prefix, id, generated);
  }
  const e = new Error(`mode must be "upload" or "generate"`); e.status = 400; throw e;
}
