-- ─────────────────────────────────────────────────────────────
-- 8 Second Rides — rev 8: driver-initiated vehicle requests
-- Run manually against the live DB:
--   psql "$DATABASE_URL" -f api/migrations/008_vehicle_assignment_requests.sql
-- Safe to re-run — IF NOT EXISTS guarded.
--
-- A driver picks their own vehicle at the start of a show/shift (or
-- switches it) from the Driver portal — but the pick doesn't take
-- effect until dispatch or admin approves it. This table is the
-- request queue; approving it performs the actual vehicles.driver_id
-- assignment (same clear-then-set as an admin's direct assign in
-- fleet.js — one vehicle per driver, per migration 007's unique index).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_assignment_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id   UUID NOT NULL REFERENCES public.vehicles(id),
  driver_id    UUID NOT NULL REFERENCES public.profiles(id),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','cancelled')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at   TIMESTAMPTZ,
  decided_by   UUID REFERENCES public.profiles(id),
  note         TEXT
);
CREATE INDEX IF NOT EXISTS var_pending_idx ON public.vehicle_assignment_requests (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS var_driver_idx  ON public.vehicle_assignment_requests (driver_id, requested_at DESC);
