-- ─────────────────────────────────────────────────────────────
-- 8 Second Rides — rev 6: Command Center kiosk is PIN-only, no
-- "Create user" step required.
--
-- Auto-provisions one hidden system profile (role='display') that the
-- kiosk PIN is stored against under the hood (its password_hash IS the
-- PIN, same mechanism as before — just no longer something an admin has
-- to create manually). Admins set/change the PIN from
-- Admin → Settings → Command Center kiosk; this row never appears in
-- the Users list and there is no "Display" option in Create user anymore.
--
-- Safe to re-run — ON CONFLICT guarded. Run manually against the live DB:
--   psql "$DATABASE_URL" -f api/migrations/006_kiosk_system_profile.sql
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.profiles (id, email, first_name, last_name, full_name, role, status, password_hash)
VALUES (
  '00000000-0000-0000-0000-00000000c0de',
  'command-center@kiosk.internal',
  'Command', 'Center', 'Command Center',
  'display', 'active', NULL
)
ON CONFLICT (id) DO NOTHING;
