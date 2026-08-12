# 8 Seconds Ride Management — Azure Setup Runbook

Goal: from zero to *creating users and testing rides* on a live URL. Mirrors the 8 Seconds
deployment (`calm-smoke` SWA + `hlsr-8sec-db`), so everything here will feel familiar.
Budget: the SWA Free tier and a burstable B1ms Postgres (~$15–30/mo) are fine for testing.

## 1. Azure resources (~20 min, Azure Portal)

1. **Resource group** — create `8sec-rides-rg` (South Central US, same as 8 Seconds).
2. **Azure Database for PostgreSQL Flexible Server**
   - Name: e.g. `8sec-rides-db` → host `8sec-rides-db.postgres.database.azure.com`
   - Workload: Development · Compute: Burstable B1ms · Version 16
   - Auth: PostgreSQL authentication, admin user `ridesadmin`, strong password
     (avoid `$` in the password — remember the single-quote shell pain in 8 Seconds)
   - Networking: "Allow public access from any Azure service" ON, and add your home IP
     so you can run psql. SSL required stays ON.
3. **Static Web App**
   - Name: `8sec-rides` · Plan: Free · Region: closest to South Central
   - Source: GitHub → `rugbyguyIT/8seconds-rides`, branch `main`
   - Build presets: Custom → App location `/`, Api location `api`, Output location *(blank)*
   - Creating it auto-commits a workflow file with its own deploy token secret — that's your
     CI/CD, same as 8 Seconds' `azure-static-web-apps-*.yml`. First deploy runs immediately.

## 2. Database schema (~5 min)

From Azure Cloud Shell or local psql (single quotes around the URL, 8 Seconds rule):

    psql 'postgresql://ridesadmin:<PASSWORD>@8sec-rides-db.postgres.database.azure.com:5432/postgres?sslmode=require' \
      -f api/migrations/001_schema.sql

This creates every table and seeds the venue library (gates, clubs, lots, hotels, airports).

## 3. App settings (SWA → Settings → Environment variables)

| Setting | Value | Required for |
|---|---|---|
| `DATABASE_URL` | the full postgres URL above | everything |
| `JWT_SECRET` | long random string (`openssl rand -base64 48`) | auth |
| `BOOTSTRAP_SECRET` | another random string — **remove after step 4** | first admin |
| `OTP_TEST_CODE` | e.g. `123456` — fixed sign-in code while Twilio is not connected | OTP testing |
| `FLUSH_SECRET` | random string, also add as GitHub repo secret | notification cron |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | `npx web-push generate-vapid-keys` | push (optional day 1) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_MESSAGING_SERVICE_SID` | from Twilio (can reuse 8 Seconds') | real SMS (optional day 1) |

GitHub repo secrets (Settings → Secrets → Actions): `APP_URL` = your SWA URL, `FLUSH_SECRET` = same
value as above. That powers `.github/workflows/notification-flush.yml` (every 5 min) — copy that
workflow file from the rev-1 zip (it couldn't be pushed via API; see README note).

## 4. First admin (~1 min)

    curl -X POST https://<your-swa>.azurestaticapps.net/api/auth/bootstrap \
      -H "Content-Type: application/json" \
      -d '{"bootstrap_secret":"<BOOTSTRAP_SECRET>","email":"rugbyguytx@gmail.com","password":"<pick-one>","full_name":"Kyle Sandoval"}'

Then **delete the `BOOTSTRAP_SECRET` app setting** — that permanently disables the endpoint.

## 5. Smoke test (~10 min)

1. Open the SWA URL → sign in with your admin email + password (24 h session).
2. Admin → create a **vehicle** ("Suburban U4"), a **driver**, a **rider** (class VIP), and a
   **handler**; link the handler to the rider. OTP roles need a mobile number; with
   `OTP_TEST_CODE=123456` set, any of them signs in with that code — no SMS needed yet.
3. In a second browser/incognito: sign in as the **rider**, request a ride
   (venue dropdowns are pre-seeded).
4. As **dispatch/admin**: approve it, then assign the driver + vehicle.
5. Third browser or your phone: sign in as the **driver** → Start Drive → Arrived →
   Passenger on board → Complete. Watch statuses update everywhere (15 s polling), and check
   Admin: `GET /api/health` shows counts; `/api/notifications/recent` shows the queued
   push/SMS rows (status `skipped` until VAPID/Twilio are configured — expected).
6. Cancel-with-reason, driver alerts ("Vehicle issue"/"Heavy traffic"), no-show, and
   force-logout are all live — worth testing each once.

## 6. When you're ready for real notifications

- **Push:** set the three VAPID vars; on iPhone the PWA must be added to the Home Screen
  before push works (16.4+ requirement) — this is why SMS stays the critical channel.
- **SMS:** fastest path is reusing the 8 Seconds Twilio Messaging Service (A2P already
  registered); then remove `OTP_TEST_CODE` so real codes go out.

## Troubleshooting notes (inherited from 8 Seconds)

- 401s on every API call → check you're sending `x-rides-token`, not `Authorization`.
- `psql` connection errors → single-quote the URL; check the server firewall allows your IP.
- Deploy not firing → the SWA-generated workflow file is the source of truth; `git push origin main`.
- Stale JS after deploy → bump `CACHE_VERSION` in `sw.js` (same rule as 8 Seconds).
