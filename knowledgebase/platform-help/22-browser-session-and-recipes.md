# Browser Session, recipes, and browse_* agent tools

## What it is

**Browser Session** (`/browser-session`) lets you run natural-language browser work in:

1. **Managed Playwright** (`openclaw` profile) — server-side Chromium on the platform.
2. **Client Chrome** — your desktop Chrome with the AgentSystem Browser Relay extension (shared gateway WSS; exclusive lease).
3. **Desktop Local worker** (recommended multi-user) — long-lived Windows Playwright on **your** PC, online via Connectors package. Concurrent CEOs each run their own worker; no shared tab lease.

Agents do **not** drive this with the built-in AgentSystem `browser` tool in chat (that path is denied for specialists). They use Agent OS **`browse_*` content tools**. When your desktop worker is **Online**, open/snapshot/act and many recipes route to the laptop; otherwise the backend uses managed AgentSystem / CDP (`browser-cdp`).

## CEO setup A — Client Chrome (Browser Relay)

1. Open **Browser Session** in the left nav.
2. Opt in to Client Chrome / Browser Relay and install the extension pack if prompted.
3. Attach a tab, log into sites you care about, then **Mark ready**.
4. Optionally set **URL allow / deny** lists (deny always wins).
5. **Recorder (wizard):** **Record a recipe** ? navigate and **Capture this page** ? **Done — save recipe**.

### Multi-user lease (relay only)

Recipes and tasks stay private to your account. The relay pairing string is **shared** for the whole instance (one WSS token per gateway).

Only **one** user can hold **Client Chrome** at a time (**exclusive lease**):

- If Mark ready fails because someone else holds the lease, wait until they **Opt out**, use **managed Playwright**, or use the **Desktop Local worker** below.
- Status shows who holds the lease. Agents never drive another user's attached Chrome tabs.

## CEO setup B — Desktop Local worker (Connectors package)

**Best path when multiple CEOs need real browser sessions at the same time.**

1. Open **Connectors** ? **Browser Session package (local worker)**.
2. Download **full** package (portable Node) or **lite** (Node 18+ on PATH).
3. Unzip privately. Keep `.env` secret (`BROWSER_WORKER_TOKEN` starts with `bwk_`).
4. Confirm package defaults:
   - `BROWSER_HEADLESS=0` (headed window — use this for logins / 2FA)
   - `BROWSER_USER_DATA_DIR=browser-profile` (cookies/logins persist across restarts)
   - `AGENT_OS_BASE_URL` = your Flolah origin (no `/api` suffix)
5. Run `scripts\Start-BrowserWorker.ps1` (first run installs Playwright Chromium).
6. Log into sites **in the worker Chromium window** (not necessarily your everyday Chrome profile).
7. Leave the process running (optional Task Scheduler script). Confirm **Online** on Connectors.
8. Optional IP lock: **Settings ? IP Whitelists** (Browser Session package) or the Connectors IP panel — **same store**.
9. Revoke old tokens under **Settings ? Tokens management** if a zip is lost; re-download mints a new token.

### Sign-in and changing the browser profile

- This is **Playwright Chromium** by default ? everyday Chrome cookies are not reused.
- Keep `BROWSER_HEADLESS=0` for Google / Flow login and 2FA.
- If Google shows **?This browser or app may not be secure?**, set in the package `.env`:
  - `BROWSER_CHANNEL=chrome` (uses installed Google Chrome)
  - `BROWSER_USER_DATA_DIR=browser-profile-chrome` (fresh profile; do not reuse the Chromium profile folder)
  - Restart `Start-BrowserWorker.ps1`, then sign in in the new Chrome window.
- Default profile folder: `browser-profile\` under the unzipped package (`BROWSER_USER_DATA_DIR=browser-profile`).
- To use another profile: set `BROWSER_USER_DATA_DIR` in the package `.env` to a new relative or absolute path, restart the worker, then sign in again in that window.
- Do not delete the active profile folder if you want the Google session to stick; do not share `browser-profile\` or the zip `.env`.

### Video content (Google Flow flavour)

Video pack **Flavour 1** (`flow_browser`) needs this worker **Online**, with Google signed in inside the worker window. Orchestrator then runs **run video media** (=8s per scene) and **run video assembly**. Details: [41-video-content-studio.md](./41-video-content-studio.md).

Ops detail: [BROWSER-SESSION-DESKTOP-LOCAL.md](../BROWSER-SESSION-DESKTOP-LOCAL.md). Token inventory: [34-tokens-management.md](./34-tokens-management.md). IP rules: [33-ip-whitelists.md](./33-ip-whitelists.md).

### Loopback (optional workflows)

While the worker runs: `POST http://127.0.0.1:3020/v1/open` (and snapshot/act/status) with `Authorization: Bearer <same bwk_ token>`. Default bind is loopback only.

## Agent tools (grant in Workspace ? Tool access)

| Tool | Purpose |
|------|---------|
| `browse_session_status` | Profile (`chrome` / `openclaw` / desktop worker), gateway, chrome lease, setup hints |
| `browse_task_start` | Free-form NL goal (`mode: autonomous`); async `task_id` |
| `browse_task_status` | Poll / wait (`wait_ms` up to 90000) |
| `browse_snapshot` / `browse_act` | Single-step observe / act |
| `browse_recipe_list` | List **your** saved recipes only |
| `browse_recipe_run` | **Play** a recipe by `recipe_name` (preferred) or `recipe_id` |

**Access:** Recipes and tasks are stored per CEO (`ceo_user_id`). Agents only see **your** recipes. Grant **list** and **run** separately. Default org agents get browse tools at boot; custom agents need an explicit grant.

## Recipe vs autonomous (what agents should do)

1. Named recipe / play-replay ? `browse_recipe_list` ? **`browse_recipe_run`**.
2. Known saved pattern ? list, name-match, run; else autonomous and say so.
3. One-off goals ? **`browse_task_start`** autonomous.
4. Agents must not invent recipe names.

Live task progress appears in agent chat **History** (Browser Tasks strip) when a `task_id` is active.

## Chat feedback ? learnings

Thumbs **down** on an agent chat reply requires a short comment. Comments feed **`learnings_summary`**. Use this when an agent picked the wrong mode or mishandled a browser goal.

## Safety

- Do not book, pay, or submit via automation.
- Blocked URLs return an error — agents must not bypass allow/deny lists.
- Prefer deep-link search summaries over clicking Book/Pay.
- Desktop worker profile cookies are **private to that laptop folder** — treat `browser-profile\` like a password store; do not share the zip or profile directory.

## Ops / redeploy (admins)

- Backend seeds `browse_*` in `content_tools_meta` and grants defaults (`seed-browser-session-tools.js`).
- AgentSystem: `browser.enabled=true`, dedicated **`browser-cdp`** agent; no global tools.allow strip of CDP.
- Env (cloud): `BROWSER_TASK_CDP_AGENT_ID`, `BROWSER_WORKER_OFFLINE_MS`, `BROWSER_WORKER_JOB_TIMEOUT_MS`.
- Package source: `backend/local-browser-worker/` (worker version 1.1+; Playwright **1.55.1+** for verified browser downloads; `launchPersistentContext`).
- Verify AgentSystem: `node deploy/scripts/verify-AgentSystem-parity.js`.

More detail: [CLIENT-BROWSER-SESSION.md](../CLIENT-BROWSER-SESSION.md), [BROWSER-SESSION-DESKTOP-LOCAL.md](../BROWSER-SESSION-DESKTOP-LOCAL.md).
