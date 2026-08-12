# 8 Second Rides

Internal "VIP Uber" for the Houston Livestock Show and Rodeo — sibling app to
[HLSR 8 Seconds](https://www.8secondsevents.com) and built on the same stack and conventions.

**Stack:** Azure Static Web Apps (static front end + managed Azure Functions Node v4 API at `/api/*`),
Azure Database for PostgreSQL Flexible Server, GitHub Actions CI/CD, custom JWT auth, web-push + Twilio SMS.

## Personas / roles

| Role | Sign-in | Session | Portal |
|---|---|---|---|
| `rider` (VIP/Exec/Performer) | SMS OTP | persistent (365d, revocable) | `/pages/rider.html` |
| `handler` (EA) | SMS OTP | persistent | `/pages/handler.html` |
| `driver` | SMS OTP | persistent | `/pages/driver.html` |
| `dispatch` | password | **12 h forced logout** | `/pages/dispatch.html` |
| `admin` | password | **24 h forced logout** | `/pages/admin.html` |
| `display` (command room) | provisioned | 90 d, read-only | `/pages/dispatch.html` |

## Architecture in one paragraph

Every ride mutation goes through `api/src/rides-core.js → performAction()`: a guarded state
transition, an append-only `ride_events` row naming the actor, and `notification_outbox` rows —
all in one Postgres transaction. The outbox is flushed immediately in-process and swept every
5 minutes by a GitHub Actions cron (`.github/workflows/notification-flush.yml`), giving
at-least-once delivery with a hard uniqueness guarantee against duplicate push/SMS. Driver
phones POST GPS to `/api/positions` while a ride is live; dispatch polls `/api/positions/latest`.

Ride states: `requested → approved → assigned → en_route → arrived → in_progress → completed`
(+ `denied / cancelled / no_show`). Humans decide everything: approval, timing, and vehicle
(decision of record, Aug 2026).

## Known conventions inherited from 8 Seconds

- Azure SWA strips the `Authorization` header → all API calls use **`x-rides-token`**.
- Migrations are **manual** (`psql -f api/migrations/001_schema.sql`) — nothing auto-runs SQL.
- `token_version` column = instant force-logout.
- No build step: plain HTML/CSS/JS, deployed as-is.

## Getting started

See **SETUP-GUIDE.md** for the full Azure runbook (resources, app settings, schema, first admin,
first test ride). For local API dev: `cd api && npm install && func start` with a
`local.settings.json` providing `DATABASE_URL` and `JWT_SECRET`.

## Rev 1 scope and the roadmap

Rev 1 = auth, user/fleet/venue management, full ride lifecycle with notifications, driver GPS
(polling). Deliberately deferred: Mapbox live map + command-room dashboard (design approved in
the mockup), ETA computation + 10/5-min proximity alerts, refresh-token rotation, ride legs
(`002` migration), Azure Web PubSub for push-based tracking. The stylesheet is the extracted
8 Seconds design system; for pixel-exact parity you can drop in `css/style.css` from the
`rugbyguyIT/hlsr` repo — class names are compatible.
