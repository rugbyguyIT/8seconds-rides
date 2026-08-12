-- ─────────────────────────────────────────────────────────────
-- 8 Seconds Ride Management — rev 2: names, settings, logging
-- Run manually against the live DB (8 Seconds convention):
--   psql "$DATABASE_URL" -f api/migrations/002_settings_logging.sql
-- Safe to re-run — every statement is IF NOT EXISTS / IF EXISTS guarded.
-- ─────────────────────────────────────────────────────────────

-- ── Profiles: split name into first/last (source of truth) ────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_name  TEXT NOT NULL DEFAULT '';

-- Backfill from existing full_name for any rows created before this migration.
-- Splits on the first space: "Kyle Sandoval" -> first_name 'Kyle', last_name 'Sandoval'.
-- Single-word names land entirely in first_name (safe default, editable in Admin → Users).
UPDATE public.profiles
SET first_name = COALESCE(NULLIF(split_part(trim(full_name), ' ', 1), ''), full_name),
    last_name  = CASE WHEN position(' ' in trim(full_name)) > 0
                       THEN trim(substring(trim(full_name) from position(' ' in trim(full_name)) + 1))
                       ELSE '' END
WHERE first_name = '' AND last_name = '' AND full_name IS NOT NULL AND full_name <> '';

-- full_name remains in the table as a denormalized "First Last" convenience
-- column (every screen in the UI reads it) — the API layer now always
-- computes it from first_name + last_name on create/update, so it can
-- never drift out of sync again.

-- ── Audit logs: upgrade to full security-log shape ─────────────
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS full_name  TEXT;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS ip_address TEXT;
-- Backfill ip_address from the older 'ip' column so nothing already
-- logged is lost; both columns are written going forward.
UPDATE public.audit_logs SET ip_address = ip WHERE ip_address IS NULL AND ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_profile_id ON public.audit_logs (profile_id);

-- ── Application / error logs ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error')),
  event      TEXT NOT NULL,
  detail     TEXT,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  email      TEXT,
  page_url   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_logs_level      ON public.app_logs (level);
CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON public.app_logs (created_at DESC);

-- ── App-wide settings (singleton row) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  id                 SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- enforce a single row
  org_display_name   TEXT NOT NULL DEFAULT '8 Seconds Ride Management',
  support_phone      TEXT,
  support_email      TEXT,
  sms_sender_label   TEXT NOT NULL DEFAULT '8Sec Rides',
  app_theme          TEXT NOT NULL DEFAULT 'classic' CHECK (app_theme IN ('classic','editorial')),
  pilot_mode         BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
