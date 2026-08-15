# 8 Second Rides — Driver & Admin Subdomains Runbook

Goal: `drive.8secondrides.net` opens straight to a driver-branded sign-in, and
`admin.8secondrides.net` opens straight to an admin/dispatch-branded sign-in — each
installable as its own separate "app" on a phone home screen. Everything code-side has
already shipped (separate PWA manifests + branded sign-in copy). What's left is entirely
in the Azure Portal and wherever `8secondrides.net`'s DNS is managed — Cowork can't touch
either of those, so this is the part that's on you. ~15 minutes, no downtime.

**Important — this is cosmetic, not a security boundary.** Both subdomains, and the main
domain, serve the exact same app and the exact same login page. What actually decides who
can do what is the sign-in itself and each user's role (driver / dispatch / admin) — that's
enforced by the API on every request, regardless of which URL someone typed in. The
subdomains just make the *right* front door obvious and give each group of users their own
installable icon; they don't lock anyone out of anything the login system wouldn't already.

## 1. Add the custom domains in Azure (~10 min, Azure Portal)

You'll do this twice — once per subdomain. Start with `drive.8secondrides.net`:

1. Go to your Static Web App resource (the one already hosting 8 Second Rides — same one
   from `SETUP-GUIDE.md`, step 1.3).
2. Left menu → **Custom domains** → **+ Add**.
3. Domain name: `drive.8secondrides.net`. Azure will detect it as a subdomain (not the
   apex/root domain) and offer **CNAME** validation — that's the one you want, it's the
   simpler path.
4. Azure shows you a CNAME record to create: something like

       Name:  drive
       Value: <your-app-name>.azurestaticapps.net

   Leave this Azure screen open — you'll come back to it after the DNS record exists.
5. Repeat steps 2–4 for `admin.8secondrides.net` (Name: `admin`, same target value).

Occasionally Azure asks for a short-lived **TXT** validation record first (this happens if
it can't otherwise confirm you control the domain) — if you see that step, add the TXT
record it shows you the same way as the CNAME below, then continue.

## 2. Add the DNS records (~5 min, wherever `8secondrides.net` is registered/managed)

Log in to your DNS provider for `8secondrides.net` (registrar, or Cloudflare/Route 53/etc.
if DNS is delegated elsewhere) and add:

| Type | Name | Value |
|---|---|---|
| CNAME | `drive` | `<your-app-name>.azurestaticapps.net` |
| CNAME | `admin` | `<your-app-name>.azurestaticapps.net` |

Use the exact target value Azure showed you in step 1 — it's specific to your Static Web
App resource. If your DNS provider requires a trailing dot on CNAME targets, add it; most
modern providers (Cloudflare, Route 53, GoDaddy's newer UI) don't need one.

## 3. Wait for validation + SSL (~5–30 min, automatic)

Back in the Azure Portal's Custom domains screen, Azure polls DNS and validates each
domain automatically once the CNAME resolves — no button to click. After validation, Azure
also **automatically issues and manages a free SSL certificate** for each subdomain; no
extra step, no cost, no renewal to remember. DNS propagation is usually fast (minutes) but
can occasionally take longer depending on your provider and any DNS caching upstream.

You'll know it worked when both `drive.8secondrides.net` and `admin.8secondrides.net`
show a green "Ready" (or equivalent) status next to them in the Custom domains list, and
loading either URL in a browser shows the padlock with no certificate warning.

## 4. Smoke test (~5 min)

1. Open `https://drive.8secondrides.net` — you should land on the sign-in page with
   **"Driver Sign In · Houston"** and **"Ready to roll."** instead of the generic greeting.
2. Open `https://admin.8secondrides.net` — you should see **"Admin & Dispatch · Houston"**
   and **"Welcome back."**
3. Sign in on each as normal (your email + OTP/password) — this works identically to the
   main domain, since sign-in already redirects everyone to the right page for their role.
4. On a phone, open `drive.8secondrides.net` in the browser and use "Add to Home Screen" —
   confirm it installs as **"8 Second Drive"** with its own icon, distinct from the main
   app. Same for `admin.8secondrides.net` → **"8 Second Admin"**.
5. The original `https://<your-app-name>.azurestaticapps.net` URL (and any other domain
   already bound to the app) keeps working exactly as before, with the generic "Saddle up."
   greeting — nothing about the main entry point changes.

## Troubleshooting

- **Azure won't validate the domain** → double check the CNAME `Name` is exactly `drive` or
  `admin` (not `drive.8secondrides.net` — most DNS providers just want the subdomain part),
  and that the `Value` exactly matches what Azure showed you, with no typos.
- **"Domain already in use" error in Azure** → each hostname can only be bound to one Azure
  resource at a time; make sure nothing else (an old test SWA, a different app) already
  claimed it.
- **Certificate warning after "Ready" status** → give it a few more minutes; certificate
  issuance sometimes lags a minute or two behind the domain showing as validated. If it's
  still failing after 30+ minutes, remove and re-add that custom domain in Azure.
- **Branding text doesn't change** → hard-refresh (the sign-in page is set to
  `no-cache, must-revalidate`, so a stale cached copy shouldn't be the cause, but browsers
  occasionally hold on anyway). Also confirm you're on the *subdomain* URL, not the apex
  domain or the `.azurestaticapps.net` one — those intentionally keep the generic greeting.
- **Want a third subdomain later** (e.g. for riders or handlers) → same recipe: add the
  custom domain in Azure, add its CNAME in DNS, optionally give that page its own
  `manifest-*.json` and a `brandByHostname()` entry in `index.html` if you want distinct
  branding/installability for it too.
