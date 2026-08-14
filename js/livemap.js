// ───────────────────────────────────────────────────
// Shared live vehicle-position map — one real map (Mapbox GL) with a
// stylized SVG fallback when no MAPBOX_PUBLIC_TOKEN is configured.
// Used by Command Center (full-size, with Recenter/Zoom-to-city
// controls) and the Admin dashboard (smaller, same behavior) so both
// stay pixel-for-pixel identical instead of drifting apart as two
// copies of the same code.
//
// createLiveMap({
//   fallbackId, realId,        required — the two map containers
//   vehLayerId,                required — <g> inside the fallback SVG
//   controlsId,                optional — Recenter/Zoom-to-city button row (works in both real-map and SVG-fallback mode)
//   center: [lng, lat],        default camera center (Recenter target)
//   bounds: [[swLng,swLat],[neLng,neLat]], "Zoom to city" target
//   zoom, recenterZoom,        default 13 / 15
// }) -> { init(), refresh(positions, rideByVehicle), recenter(), zoomToCity(), resize(), startAutoCycle(seconds), stopAutoCycle(), isReal(), isAutoCycling() }
// ───────────────────────────────────────────────────
// Three colors, on purpose: gray = not carrying anyone right now, orange
// (rodeo orange) = en route to a pickup or waiting there, green = has a
// rider and is headed to the destination. No blue/other states — status
// detail still shows in the tag text underneath.
const VEH_IDLE_FILL = '#8a93a3';
const RIDE_VEH_STATE = {
  assigned:    { fill: 'var(--orange)', tag: 'EN ROUTE',      ring: true },
  en_route:    { fill: 'var(--orange)', tag: 'EN ROUTE',      ring: true },
  arrived:     { fill: 'var(--orange)', tag: 'WAITING',       ring: true },
  in_progress: { fill: 'var(--green)',  tag: 'TO DESTINATION', ring: false },
};

function createLiveMap(cfg) {
  let realMap = null;
  const mapMarkers = {};      // vehicle_id -> mapboxgl.Marker, kept across refreshes
  let fleetAutoFitDone = false; // only auto-fit the camera to the fleet once — after that Recenter/Zoom to city are the only things that move it
  let forcedBbox = null;      // SVG-fallback equivalent of a manual camera move — set by recenter()/zoomToCity() so those buttons do something even before a Mapbox token is configured
  let lastPos = [], lastRideByVehicle = {}; // so recenter()/zoomToCity() can redraw immediately instead of waiting for the next poll

  // Lat/lng -> local SVG coordinates. Auto-fits to wherever the fleet
  // actually is (padded) so this works regardless of the venue's real
  // coordinates, with a sane Houston-area fallback when nothing has
  // reported in yet.
  function computeBbox(points) {
    const lats = points.map(p => p.lat).filter(v => typeof v === 'number' && isFinite(v));
    const lngs = points.map(p => p.lng).filter(v => typeof v === 'number' && isFinite(v));
    let minLat = Math.min(...lats), maxLat = Math.max(...lats);
    let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    if (!lats.length || !isFinite(minLat) || (maxLat - minLat < 0.002 && maxLng - minLng < 0.002)) {
      return { minLat: 29.60, maxLat: 29.76, minLng: -95.48, maxLng: -95.34 };
    }
    const padLat = Math.max((maxLat - minLat) * 0.28, 0.01);
    const padLng = Math.max((maxLng - minLng) * 0.28, 0.01);
    return { minLat: minLat - padLat, maxLat: maxLat + padLat, minLng: minLng - padLng, maxLng: maxLng + padLng };
  }
  function toXY(lat, lng, bbox) {
    const x = ((lng - bbox.minLng) / (bbox.maxLng - bbox.minLng)) * 1000;
    const y = (1 - (lat - bbox.minLat) / (bbox.maxLat - bbox.minLat)) * 600;
    return { x: Math.max(24, Math.min(976, x)), y: Math.max(24, Math.min(576, y)) };
  }
  // Never the rider's name — just the driver's name if this vehicle is
  // currently on a ride, otherwise the vehicle's own label/number.
  function vehLabel(pos, ride) {
    return (ride && ride.driver_name) || pos.label;
  }
  // Hover tooltip: who's actually in the car. This does NOT need a
  // role check here — the server already strips enduser_name/photo/id
  // from the API response for role='display' (rides.js ridesList), so
  // ride.enduser_name simply won't exist for the kiosk. Admin/dispatch
  // get the real response and see it on hover; the kiosk gets nothing
  // to show even if someone inspects the DOM. Same pattern as the
  // pin label already uses for keeping the rider off the board.
  function vehTooltip(pos, ride) {
    const state = ride && RIDE_VEH_STATE[ride.status];
    const tag = state ? state.tag : 'IDLE';
    if (ride && ride.enduser_name) return `${ride.enduser_name} — ${tag}`;
    return `${vehLabel(pos, ride)} — ${tag}`;
  }
  function vehicleMarkup(pos, ride, bbox) {
    const { x, y } = toXY(pos.lat, pos.lng, bbox);
    const state = ride && RIDE_VEH_STATE[ride.status];
    const fill = state ? state.fill : VEH_IDLE_FILL;
    const tag = state ? state.tag : 'IDLE';
    const stale = !!pos.stale && !ride;
    // The rider's name shows on the board itself now, not just on hover —
    // still safe for the kiosk: the server already strips enduser_name
    // for role='display' (see rides.js ridesList / vehTooltip's comment),
    // so `ride.enduser_name` simply won't exist there and this line never
    // renders, no client-side role check needed.
    const rider = ride && ride.enduser_name;
    return `<g class="veh${stale ? ' veh-stale' : ''}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
      <title>${esc(vehTooltip(pos, ride))}</title>
      ${state && state.ring ? `<circle class="veh-ring" r="9" style="stroke:${fill}"/>` : ''}
      <circle class="veh-dot" r="7" style="fill:${fill}"/>
      <rect x="-36" y="-30" width="72" height="15" rx="4" class="veh-tag-bg"/>
      <text x="0" y="-19" text-anchor="middle" class="veh-tag">${esc(vehLabel(pos, ride))}</text>
      <rect x="-28" y="12" width="56" height="13" rx="4" class="veh-tag-bg" style="fill:${fill};opacity:.92"/>
      <text x="0" y="21.5" text-anchor="middle" class="veh-tag" style="font-size:7.5px">${tag}</text>
      ${rider ? `<rect x="-40" y="27" width="80" height="13" rx="4" class="veh-tag-bg"/>
      <text x="0" y="36.5" text-anchor="middle" class="veh-tag" style="font-size:7.5px">${esc(rider)}</text>` : ''}
    </g>`;
  }

  // Real map (Mapbox GL) marker sync — actual HTML markers pinned to
  // real lat/lng instead of a hand-projected SVG dot, so it's real
  // streets/imagery underneath.
  function updateRealMapMarkers(pos, rideByVehicle) {
    const seen = new Set();
    pos.forEach((p) => {
      seen.add(p.vehicle_id);
      const ride = rideByVehicle[p.vehicle_id];
      const state = ride && RIDE_VEH_STATE[ride.status];
      const fill = state ? state.fill : VEH_IDLE_FILL;
      const tag = state ? state.tag : (p.stale ? 'STALE' : 'IDLE');
      let m = mapMarkers[p.vehicle_id];
      if (!m) {
        const el = document.createElement('div');
        el.className = 'mb-veh-marker';
        el.innerHTML = `<div class="mb-veh-label"></div><div class="mb-veh-dot"></div><div class="mb-veh-tag"></div><div class="mb-veh-rider"></div>`;
        m = new mapboxgl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(realMap);
        mapMarkers[p.vehicle_id] = m;
      } else {
        m.setLngLat([p.lng, p.lat]);
      }
      const el = m.getElement();
      const dot = el.querySelector('.mb-veh-dot'), tagEl = el.querySelector('.mb-veh-tag'),
            labelEl = el.querySelector('.mb-veh-label'), riderEl = el.querySelector('.mb-veh-rider');
      dot.style.background = fill; dot.classList.toggle('stale', !!p.stale && !ride);
      tagEl.textContent = tag; tagEl.style.background = fill;
      // Driver's name while they're on a ride, vehicle number otherwise.
      labelEl.textContent = vehLabel(p, ride);
      // Rider's name shows on the board itself now too, for admin/dispatch
      // only — the server already strips enduser_name for role='display'
      // (see rides.js ridesList / vehTooltip's comment), so this element
      // just stays empty and hidden for the kiosk with no client-side
      // role check needed.
      const rider = ride && ride.enduser_name;
      riderEl.textContent = rider || '';
      riderEl.style.display = rider ? '' : 'none';
      // Hover tooltip — re-set every refresh too, same reasoning as the
      // label above. See vehTooltip()'s comment for why no role check
      // is needed here (server already redacts enduser_name for role='display').
      el.title = vehTooltip(p, ride);
    });
    Object.keys(mapMarkers).forEach((id) => {
      if (!seen.has(id)) { mapMarkers[id].remove(); delete mapMarkers[id]; }
    });
    // Auto-fit to the fleet once, the first time positions show up, so
    // the map opens on something sensible. After that the camera is
    // manual-only (Recenter / Zoom to city) so it doesn't keep
    // snapping back out from under whoever's looking at it.
    if (pos.length && !fleetAutoFitDone) {
      fleetAutoFitDone = true;
      const bbox = computeBbox(pos);
      realMap.fitBounds([[bbox.minLng, bbox.minLat], [bbox.maxLng, bbox.maxLat]], { padding: 40, duration: 400, maxZoom: 16 });
    }
  }

  // Loads a public Mapbox token from the server (never committed/hardcoded
  // — see api/src/functions/geocode.js mapPublicToken) and, if one is
  // configured, swaps the stylized SVG board for a real interactive map.
  // If it's not configured yet, the SVG board keeps working exactly as
  // before — nothing regresses for venues that haven't set it up.
  async function init() {
    if (typeof mapboxgl === 'undefined') return;
    const { data } = await api('/config/map-token');
    const token = data && data.token;
    if (!token) return;
    mapboxgl.accessToken = token;
    document.getElementById(cfg.fallbackId).style.display = 'none';
    document.getElementById(cfg.realId).style.display = 'block';
    realMap = new mapboxgl.Map({
      container: cfg.realId,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: cfg.center, // replaced by fitBounds once vehicles report in
      zoom: cfg.zoom || 13,
      attributionControl: false,
    });
    realMap.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
  }

  function refresh(pos, rideByVehicle) {
    pos = pos || []; rideByVehicle = rideByVehicle || {};
    lastPos = pos; lastRideByVehicle = rideByVehicle;
    if (realMap) {
      updateRealMapMarkers(pos, rideByVehicle);
    } else {
      const bbox = forcedBbox || computeBbox(pos);
      const layer = document.getElementById(cfg.vehLayerId);
      if (layer) layer.innerHTML = pos.map(p => vehicleMarkup(p, rideByVehicle[p.vehicle_id], bbox)).join('');
    }
  }

  // Recenter/Zoom to city work on the real Mapbox map when one's
  // configured. Without a Mapbox token (SVG fallback board), there's no
  // real camera to move — instead these pin the fallback's projection to
  // a fixed box around NRG / all of Houston, same idea, drawn by hand.
  function recenter() {
    if (realMap) {
      if (cfg.center) realMap.flyTo({ center: cfg.center, zoom: cfg.recenterZoom || 15, duration: 700 });
      return;
    }
    if (!cfg.center) return;
    const [lng, lat] = cfg.center;
    forcedBbox = { minLat: lat - 0.008, maxLat: lat + 0.008, minLng: lng - 0.01, maxLng: lng + 0.01 };
    refresh(lastPos, lastRideByVehicle);
  }
  function zoomToCity() {
    if (realMap) {
      if (cfg.bounds) realMap.fitBounds(cfg.bounds, { padding: 30, duration: 900 });
      return;
    }
    if (!cfg.bounds) return;
    const [[swLng, swLat], [neLng, neLat]] = cfg.bounds;
    forcedBbox = { minLat: swLat, maxLat: neLat, minLng: swLng, maxLng: neLng };
    refresh(lastPos, lastRideByVehicle);
  }
  // Mapbox needs an explicit nudge after its container's size changes
  // (e.g. an expand/minimize toggle) — it doesn't watch for that itself.
  function resize() {
    if (realMap) realMap.resize();
  }

  // Hands-free camera cycle for an unattended kiosk display: alternate
  // between "zoom out to see the whole city" and "recenter on the
  // venue" on a fixed beat, so nobody has to stand at the board and
  // click. Reuses recenter()/zoomToCity() as-is — same real-map vs
  // SVG-fallback behavior either way, just triggered by a timer
  // instead of a click.
  let autoCycleTimer = null;
  let autoCycleAtCity = false;
  function startAutoCycle(seconds) {
    stopAutoCycle();
    const secs = Math.max(5, Number(seconds) || 20);
    autoCycleAtCity = false;
    autoCycleTimer = setInterval(() => {
      if (autoCycleAtCity) recenter(); else zoomToCity();
      autoCycleAtCity = !autoCycleAtCity;
    }, secs * 1000);
  }
  function stopAutoCycle() {
    if (autoCycleTimer) { clearInterval(autoCycleTimer); autoCycleTimer = null; }
    autoCycleAtCity = false;
  }

  return {
    init, refresh, recenter, zoomToCity, resize, startAutoCycle, stopAutoCycle,
    isReal: () => !!realMap,
    isAutoCycling: () => !!autoCycleTimer,
  };
}
