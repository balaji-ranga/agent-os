# Browser Session — Desktop Local Mode

**Status:** Implemented as Connectors **Browser Session package** (owner-scoped local worker).

## Product summary

| Item | Behavior |
|------|----------|
| Download | **Connectors** → *Browser Session package (local worker)* (full or lite) |
| Auth | Per-download `bwk_…` token stored hashed, bound to `owner_user_id`; optional **client IP whitelist** |
| Runtime | Long-lived Windows process; loopback :3020 for workflow APIs; outbound register/heartbeat/jobs |
| Browser | Playwright **persistent Chromium** (`BROWSER_USER_DATA_DIR=browser-profile`); **headed by default** (`BROWSER_HEADLESS=0`) |
| Agents | When worker **online**, `browse_*` / recipe / autonomous open-snapshot-act run on the laptop; else managed OpenClaw |
| Isolation | Tokens and jobs never cross CEOs; loopback binds 127.0.0.1 |

## CEO setup

1. Connectors → Download Browser Session package (full recommended).
2. Unzip privately — keep `.env` secret.
3. `scripts\Start-BrowserWorker.ps1` (first run installs Playwright Chromium).
4. A **headed** Chromium window opens. Log into sites you need (cookies live in `browser-profile\`).
5. Leave running (or Task Scheduler). Confirm **Online** on Connectors.
6. Optional: public IP/CIDR whitelist under **Settings → IP Whitelists** (Browser Session package flag) or Connectors IP UI — **one central store**.
7. Agents / Browser Session recipes run against your machine.

### Cookies and logins

- Profile is **not** real Google Chrome; log in once inside the worker window.
- Keep `BROWSER_HEADLESS=0` for first login / 2FA.
- Do not delete `browser-profile\` while you want sessions to stick; restarts reuse it.
- Profile is **excluded** from re-download zips (only a `.gitkeep` placeholder is packed).

### Existing installs (upgrade)

1. Replace `src\server.js` (or re-download a new package zip).
2. Ensure `.env` has `BROWSER_HEADLESS=0` and `BROWSER_USER_DATA_DIR=browser-profile`.
3. Restart the worker; log in again if you previously used an ephemeral context.

## Ops

- Tables: `browser_worker_tokens`, `owner_ip_whitelists` (`apply_browser_worker`), `browser_worker_nodes`, `browser_worker_jobs`
- APIs: `/api/integrations/browser-worker/*` (session), `/api/browser-worker/v1/*` (worker bearer + IP)
- Central IP API: `/api/settings/ip-whitelists`
- Env (cloud): `BROWSER_WORKER_OFFLINE_MS`, `BROWSER_WORKER_JOB_TIMEOUT_MS`
- Package env (laptop `.env`): `BROWSER_WORKER_TOKEN`, `AGENT_OS_BASE_URL`, `BROWSER_HEADLESS=0`, `BROWSER_USER_DATA_DIR`
- Package source: `backend/local-browser-worker/` (worker `1.1.0`, Playwright **1.55.1+**, persistent profile)

See also: [CLIENT-BROWSER-SESSION.md](./CLIENT-BROWSER-SESSION.md), Connectors UI, platform-help [22-browser-session-and-recipes.md](./platform-help/22-browser-session-and-recipes.md), [33-ip-whitelists.md](./platform-help/33-ip-whitelists.md).
