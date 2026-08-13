-- ─────────────────────────────────────────────────────────────
-- 8 Second Rides — rev 7: driver-owned vehicles + HLSR hang tag
-- Run manually against the live DB:
--   psql "$DATABASE_URL" -f api/migrations/007_driver_vehicles.sql
-- Safe to re-run — IF NOT EXISTS guarded.
--
-- Gives each vehicle a persistent owning driver (separate from the
-- per-shift driver_shifts.vehicle_id and per-ride ride_assignments —
-- those track "who's driving this trip right now", this tracks "whose
-- car is this normally"), and a field for the HLSR parking/lot-access
-- hang tag number. Admin can set all of this up (Admin → Drivers), but
-- the intended workflow is the driver does it themselves from their
-- own portal.
--
-- The unique index means a driver can only be assigned one vehicle at
-- a time — the API clears any prior assignment before setting a new
-- one, so reassigning "just works" without hitting this constraint.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS driver_id UUID REFERENCES public.profiles(id);
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS hang_tag TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_driver_uniq ON public.vehicles (driver_id) WHERE driver_id IS NOT NULL;
