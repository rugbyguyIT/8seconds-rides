# App icons & logo — manual upload required

GitHub API pushes from this tool are text-only, so real PNG binaries can't be
committed that way. Real branded art now exists (from Kyle) — it needs to be
uploaded once via the GitHub web UI (drag-and-drop into the repo works fine,
no CLI needed):

Upload into `/icons/` (replace the placeholders):
- `icon-192.png` (192×192) — PWA manifest icon
- `icon-512.png` (512×512) — PWA manifest icon
- `apple-touch-icon.png` (180×180) — iOS "Add to Home Screen" icon
- `favicon-32.png` (32×32) — browser tab icon

Upload into `/images/` (new folder — create it during upload):
- `login-logo.png` — the full crest/badge logo shown on the sign-in screen

All five files were generated from Kyle's source art and delivered in this
chat — download them and drag them into the matching GitHub folder at
`github.com/rugbyguyIT/8seconds-rides`, commit to `main`, and the site picks
them up automatically (Azure SWA redeploys on every push). No code changes
needed after upload.
