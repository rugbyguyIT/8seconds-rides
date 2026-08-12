-- ─────────────────────────────────────────────────────────────
-- 8 Seconds Ride Management — rev 3: address autocomplete
-- Run manually against the live DB (8 Seconds convention):
--   psql "$DATABASE_URL" -f api/migrations/003_geocoding.sql
-- Safe to re-run — IF NOT EXISTS guarded.
-- ─────────────────────────────────────────────────────────────

-- Off-site pickups/dropoffs typed as free text (not picked from the venue
-- library) can now carry the coordinates the rider actually selected from
-- the address-autocomplete dropdown. NULL when a venue location_id was
-- used instead (that row already has lat/lng via the locations join).
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS pickup_lat  DOUBLE PRECISION;
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS pickup_lng  DOUBLE PRECISION;
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS dropoff_lat DOUBLE PRECISION;
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS dropoff_lng DOUBLE PRECISION;
