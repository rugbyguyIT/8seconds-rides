// ─────────────────────────────────────────────────────────────
// 8 Seconds Ride Management — address autocomplete (Mapbox Search Box)
//   GET /api/geocode/suggest?q=&session=   typeahead suggestions
//   GET /api/geocode/retrieve?id=&session= full address + coordinates
// Proxied server-side so the Mapbox token never reaches the browser.
// Env: MAPBOX_TOKEN (a secret "sk." token scoped to Search is fine —
// this never needs write/style scopes).
//
// Session tokens: the Search Box API bills a whole type-to-select
// sequence as one lookup instead of per-keystroke, as long as the same
// session_token is reused across the suggest calls and the one retrieve
// call that ends it. The client generates a fresh UUID per session.
// ─────────────────────────────────────────────────────────────
const { app } = require('@azure/functions');
const { json, err, requireAuth } = require('../middleware');

// Command Center's live map (js/command.js) needs a Mapbox *public*
// token (starts "pk.") to draw real street tiles in the browser — a
// different, safe-to-expose token from MAPBOX_TOKEN above (that one's
// a secret "sk." token and must never reach the client). Same Mapbox
// account, just grab the public token from account settings and add
// it as the MAPBOX_PUBLIC_TOKEN app setting. Optional: if unset, the
// Command Center falls back to its stylized (non-satellite) board.
app.http('mapPublicToken', {
  methods: ['GET'], authLevel: 'anonymous', route: 'config/map-token',
  handler: async (request) => {
    const { error, status } = await requireAuth(request);
    if (error) return err(error, status);
    return json({ token: process.env.MAPBOX_PUBLIC_TOKEN || null });
  },
});

// Biases results toward NRG Park / Houston without excluding elsewhere
// (riders/handlers/hotels are all over the metro, not just on-site).
const HOUSTON_PROXIMITY = '-95.4103,29.6857'; // NRG Gate 10, from the seeded venue library

app.http('geocodeSuggest', {
  methods: ['GET'], authLevel: 'anonymous', route: 'geocode/suggest',
  handler: async (request) => {
    const { error, status } = await requireAuth(request);
    if (error) return err(error, status);
    const token = process.env.MAPBOX_TOKEN;
    if (!token) return err('Address lookup is not configured yet (MAPBOX_TOKEN missing).', 503);

    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    const session = url.searchParams.get('session') || '';
    if (q.length < 3) return json({ suggestions: [] });
    if (!session) return err('session is required');

    const mbUrl = new URL('https://api.mapbox.com/search/searchbox/v1/suggest');
    mbUrl.searchParams.set('q', q);
    mbUrl.searchParams.set('session_token', session);
    mbUrl.searchParams.set('access_token', token);
    mbUrl.searchParams.set('country', 'US');
    mbUrl.searchParams.set('limit', '5');
    mbUrl.searchParams.set('proximity', HOUSTON_PROXIMITY);
    mbUrl.searchParams.set('types', 'address,poi,street');

    try {
      const r = await fetch(mbUrl);
      if (!r.ok) return err('Address lookup failed. Try again.', 502);
      const data = await r.json();
      const suggestions = (data.suggestions || []).map(s => ({
        id: s.mapbox_id,
        name: s.name,
        address: s.place_formatted || s.full_address || '',
      }));
      return json({ suggestions });
    } catch (e) {
      return err('Address lookup failed. Try again.', 502);
    }
  },
});

app.http('geocodeRetrieve', {
  methods: ['GET'], authLevel: 'anonymous', route: 'geocode/retrieve',
  handler: async (request) => {
    const { error, status } = await requireAuth(request);
    if (error) return err(error, status);
    const token = process.env.MAPBOX_TOKEN;
    if (!token) return err('Address lookup is not configured yet (MAPBOX_TOKEN missing).', 503);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const session = url.searchParams.get('session') || '';
    if (!id) return err('id is required');
    if (!session) return err('session is required');

    const mbUrl = new URL(`https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(id)}`);
    mbUrl.searchParams.set('session_token', session);
    mbUrl.searchParams.set('access_token', token);

    try {
      const r = await fetch(mbUrl);
      if (!r.ok) return err('Could not load that address. Try again.', 502);
      const data = await r.json();
      const feat = data.features?.[0];
      if (!feat) return err('Could not load that address. Try again.', 502);
      const [lng, lat] = feat.geometry.coordinates;
      return json({
        address: feat.properties.place_formatted || feat.properties.full_address || feat.properties.name,
        lat, lng,
      });
    } catch (e) {
      return err('Could not load that address. Try again.', 502);
    }
  },
});
