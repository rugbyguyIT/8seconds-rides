-- ─────────────────────────────────────────────────────────────
-- 8 Second Rides — rev 4: admin-editable vehicle classes + photos
-- Run manually against the live DB:
--   psql "$DATABASE_URL" -f api/migrations/004_vehicle_classes.sql
-- Safe to re-run — IF NOT EXISTS guarded.
-- ─────────────────────────────────────────────────────────────

-- Vehicle classes used to be a hardcoded CHECK constraint
-- (suv/sedan/cart/ada). They're now a real table so admins can add
-- their own (Limo, Sprinter Van, Bus, ...) without a code change, and
-- each class can carry a reference photo (uploaded or AI-generated).
CREATE TABLE IF NOT EXISTS public.vehicle_classes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL UNIQUE,   -- stable slug, e.g. 'suv' — referenced by vehicles.class
  label      TEXT NOT NULL,          -- display name, e.g. 'SUV'
  photo_url  TEXT,                   -- reference photo shown when a vehicle has no photo of its own
  sort_order INT NOT NULL DEFAULT 100,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.vehicle_classes (key, label, sort_order) VALUES
  ('suv',   'SUV',            10),
  ('sedan', 'Sedan',          20),
  ('ada',   'ADA Van',        30),
  ('cart',  'Cart (dormant)', 40)
ON CONFLICT (key) DO NOTHING;

-- Drop the old fixed CHECK constraint so vehicles.class can reference
-- any active vehicle_classes.key going forward (validated in the API
-- layer, not the DB — consistent with the rest of this schema's
-- no-trigger / app-level-validation convention).
ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_class_check;

-- Per-vehicle photo override. NULL = fall back to the class's photo_url.
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS photo_url TEXT;
