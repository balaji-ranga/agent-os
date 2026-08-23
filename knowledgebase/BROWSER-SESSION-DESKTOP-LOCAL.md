# Browser Session — Desktop Local Mode

**Status:** Implemented as Connectors **Browser Session package** (owner-scoped local worker).

**Browser Protocol v1 / multi-executor upgrade:** The worker persists a node ID, registers as an
independent executor, returns structured generation-scoped element references, accepts bounded action
batches, and reports typed failures. A CEO may keep this worker and the Flolah Chrome extension online
simultaneously; jobs are addressed to exactly one node.

## Product summary

| Item | Behavior |
|------|----------|
| Download | **Connectors** → *Browser Session package (local worker)* (full or lite) |
| Auth | Per-download `bwk_…` token stored hashed, bound to `owner_user_id`; optional **client IP whitelist** |
| Runtime | Long-lived Windows process; loopback :3020 for workflow APIs; outbound register/heartbeat/jobs |
| Browser | Playwright **persistent** profile; default **Chrome channel** (`BROWSER_CHANNEL=chrome`, folder `browser-profile-chrome\`); **headed by default** (`BROWSER_HEADLESS=0`). If Google blocks Playwright, `Start-ChromeForGoogleLogin.ps1` + `BROWSER_CDP_URL`. |
| Agents | `browse_*` tasks select and pin a compatible owner-scoped executor; managed OpenClaw remains available for public/isolated work |
| Isolation | Tokens and jobs never cross CEOs; loopback binds 127.0.0.1 |

## CEO setup

1. Connectors → Download Browser Session package (full recommended).
2. Unzip privately — keep `.env` secret.
3. `scripts\Start-BrowserWorker.ps1` (first run installs Playwright; default channel is Chrome).
4. A **headed** window opens. Log into sites you need (cookies live in `browser-profile-chrome\` when using Chrome channel).
5. Leave running (or Task Scheduler). Confirm **Online** on Connectors.
6. Optional: public IP/CIDR whitelist under **Settings → IP Whitelists** (Browser Session package flag) or Connectors IP UI — **one central store**.
7. Agents / Browser Session recipes run against your machine.

### Cookies and logins

- Default engine is Playwright **Chrome channel**, not your everyday Chrome profile; log in once inside the worker window.
- Keep `BROWSER_HEADLESS=0` for first login / 2FA.
- If Google shows **This browser or app may not be secure**: stop the worker, run `scripts\Start-ChromeForGoogleLogin.ps1`, sign in, set `BROWSER_CDP_URL=http://127.0.0.1:9222` in `.env`, then start the worker (it attaches and does not relaunch Chrome).
- Do not delete the active profile folder while you want sessions to stick; restarts reuse it.
- Profile is **excluded** from re-download zips (only a `.gitkeep` placeholder is packed).
- **Change profile:** set `BROWSER_USER_DATA_DIR` in the package `.env` to another relative or absolute folder, restart the worker, then sign in again. Used by video Flavour 1 (Google Flow) — see platform-help **41**.

### Existing installs (upgrade)

1. Replace `src\server.js` (or re-download a new package zip).
2. Ensure `.env` has `BROWSER_HEADLESS=0` and `BROWSER_USER_DATA_DIR=browser-profile`.
3. Restart the worker; log in again if you previously used an ephemeral context.

## Ops

- Tables: `browser_worker_tokens`, `owner_ip_whitelists` (`apply_browser_worker`), `browser_worker_nodes`, `browser_worker_jobs`
- Multi-executor registry: `browser_executor_nodes`; extension enrollment: `browser_extension_pairing_codes` (hash only, short-lived, single-use)
- APIs: `/api/integrations/browser-worker/*` (session), `/api/browser-worker/v1/*` (worker bearer + IP)
- Central IP API: `/api/settings/ip-whitelists`
- Env (cloud): `BROWSER_WORKER_OFFLINE_MS`, `BROWSER_WORKER_JOB_TIMEOUT_MS`
- Package env (laptop `.env`): `BROWSER_WORKER_TOKEN`, `AGENT_OS_BASE_URL`, `BROWSER_HEADLESS=0`, `BROWSER_CHANNEL=chrome`, `BROWSER_USER_DATA_DIR`, optional `BROWSER_CDP_URL`
- Package source: `backend/local-browser-worker/` (worker `1.1.0`, Playwright **1.55.1+**, persistent profile)

See also: [CLIENT-BROWSER-SESSION.md](./CLIENT-BROWSER-SESSION.md), Connectors UI, platform-help [22-browser-session-and-recipes.md](./platform-help/22-browser-session-and-recipes.md), [33-ip-whitelists.md](./platform-help/33-ip-whitelists.md).
