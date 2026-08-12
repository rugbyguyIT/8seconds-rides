-- ─────────────────────────────────────────────────────────────
-- 8 Seconds Ride Management — schema rev 1
-- Run manually (8 Seconds convention — nothing auto-runs SQL):
--   psql '<DATABASE_URL>' -f api/migrations/001_schema.sql
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL,
  phone_mobile  TEXT,
  role          TEXT NOT NULL CHECK (role IN ('rider','handler','driver','dispatch','admin','display')),
  enduser_class TEXT CHECK (enduser_class IN ('vip','executive','performer','guest') OR enduser_class IS NULL),
  photo_url     TEXT,                      -- REQUIRED in practice for drivers (bio photo shown to all personas)
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  password_hash TEXT,                      -- dispatch/admin only; others sign in by SMS OTP
  token_version INT  NOT NULL DEFAULT 1,   -- bump to force-logout everywhere instantly
  sms_consent   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.handler_assignments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handler_id UUID NOT NULL REFERENCES public.profiles(id),
  enduser_id UUID NOT NULL REFERENCES public.profiles(id),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (handler_id, enduser_id)
);

CREATE TABLE IF NOT EXISTS public.vehicles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT NOT NULL,                -- 'Suburban U4'
  plate      TEXT,
  capacity   INT  NOT NULL DEFAULT 6,
  class      TEXT NOT NULL DEFAULT 'suv' CHECK (class IN ('suv','sedan','cart','ada')),  -- carts dormant but supported
  color_desc TEXT,                          -- 'White Suburban'
  active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.driver_shifts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     UUID NOT NULL REFERENCES public.profiles(id),
  vehicle_id    UUID REFERENCES public.vehicles(id),
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  checked_in_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.locations (
  id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name   TEXT NOT NULL,
  kind   TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('gate','club','suite','lot','hotel','airport','venue','other')),
  lat    DOUBLE PRECISION,
  lng    DOUBLE PRECISION,
  notes  TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Rev 1 models a ride as a single leg + round_trip flag.
-- Planned migration 002: ride_legs table for true multi-leg trips.
CREATE TABLE IF NOT EXISTS public.rides (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enduser_id          UUID NOT NULL REFERENCES public.profiles(id),
  requested_by        UUID NOT NULL REFERENCES public.profiles(id),
  status              TEXT NOT NULL DEFAULT 'requested' CHECK (status IN
    ('requested','approved','assigned','en_route','arrived','in_progress','completed','denied','cancelled','no_show')),
  pickup_location_id  UUID REFERENCES public.locations(id),
  dropoff_location_id UUID REFERENCES public.locations(id),
  pickup_text         TEXT,   -- free-text fallback when not in the venue library
  dropoff_text        TEXT,
  scheduled_at        TIMESTAMPTZ,          -- NULL = ASAP
  party_size          INT NOT NULL DEFAULT 1,
  ada_required        BOOLEAN NOT NULL DEFAULT FALSE,
  round_trip          BOOLEAN NOT NULL DEFAULT FALSE,
  priority_class      TEXT,                 -- denormalized from profile at request time (informational only)
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rides_status_idx ON public.rides (status);
CREATE INDEX IF NOT EXISTS rides_enduser_idx ON public.rides (enduser_id);

-- Reassignment = end old row, insert new row. History preserved for reporting.
CREATE TABLE IF NOT EXISTS public.ride_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     UUID NOT NULL REFERENCES public.rides(id),
  driver_id   UUID NOT NULL REFERENCES public.profiles(id),
  vehicle_id  UUID NOT NULL REFERENCES public.vehicles(id),
  assigned_by UUID REFERENCES public.profiles(id),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ,
  end_reason  TEXT
);
CREATE INDEX IF NOT EXISTS ride_assignments_ride_idx ON public.ride_assignments (ride_id) WHERE active;
CREATE INDEX IF NOT EXISTS ride_assignments_driver_idx ON public.ride_assignments (driver_id) WHERE active;

-- Append-only audit of every state change; drives notifications, timelines, reporting.
CREATE TABLE IF NOT EXISTS public.ride_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id    UUID NOT NULL REFERENCES public.rides(id),
  event      TEXT NOT NULL CHECK (event IN
    ('requested','approved','denied','assigned','reassigned','started','arrived','picked_up',
     'dropped_off','completed','cancelled','no_show','eta_10','eta_5','driver_alert')),
  actor_id   UUID REFERENCES public.profiles(id),
  actor_role TEXT,
  reason     TEXT,
  payload    JSONB,     -- driver_alert: { alertKind: 'vehicle'|'traffic', note }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ride_events_ride_idx ON public.ride_events (ride_id, created_at);

CREATE TABLE IF NOT EXISTS public.vehicle_positions (
  id          BIGSERIAL PRIMARY KEY,
  vehicle_id  UUID NOT NULL REFERENCES public.vehicles(id),
  ride_id     UUID REFERENCES public.rides(id),
  driver_id   UUID REFERENCES public.profiles(id),
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  heading     REAL,
  speed       REAL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_positions_latest_idx ON public.vehicle_positions (vehicle_id, recorded_at DESC);

-- Transactional outbox. UNIQUE constraint = duplicate notifications are impossible.
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_event_id UUID NOT NULL REFERENCES public.ride_events(id),
  recipient_id  UUID NOT NULL REFERENCES public.profiles(id),
  channel       TEXT NOT NULL CHECK (channel IN ('push','sms')),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','skipped')),
  attempts      INT NOT NULL DEFAULT 0,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ride_event_id, recipient_id, channel)
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON public.notification_outbox (created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id),
  endpoint   TEXT UNIQUE NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.otp_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id),
  code_hash  TEXT NOT NULL,
  attempts   INT NOT NULL DEFAULT 0,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID,
  email      TEXT,
  action     TEXT,
  detail     TEXT,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Seed: venue library ──────────────────────────────
INSERT INTO public.locations (name, kind, lat, lng) VALUES
  ('NRG Gate 10',                   'gate',    29.6857, -95.4103),
  ('NRG Gate 13',                   'gate',    29.6832, -95.4056),
  ('Corral Club — Suite Level',     'club',    29.6847, -95.4107),
  ('Chairman''s Suite',             'suite',   29.6849, -95.4112),
  ('The Hideout',                   'club',    29.6822, -95.4079),
  ('Committee Lot (Yellow)',        'lot',     29.6889, -95.4144),
  ('Star Trailer Lot',              'lot',     29.6836, -95.4160),
  ('Astrodome — Committee Entrance','venue',   29.6847, -95.4076),
  ('NRG Center',                    'venue',   29.6817, -95.4093),
  ('Hotel ZaZa — Museum District',  'hotel',   29.7210, -95.3868),
  ('Post Oak Hotel — Uptown',       'hotel',   29.7444, -95.4614),
  ('Hobby Airport — Private Aviation','airport',29.6454, -95.2789),
  ('IAH — Signature Aviation',      'airport', 29.9902, -95.3368)
ON CONFLICT DO NOTHING;

-- First admin: use POST /api/auth/bootstrap (see SETUP-GUIDE.md), or
-- generate a hash with scripts/hash-password.js and insert manually.
