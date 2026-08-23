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
- Package source: `backend/local-browser-worker/` (worker `2.1.0`, Playwright **1.55.1+**, persistent profile)

See also: [CLIENT-BROWSER-SESSION.md](./CLIENT-BROWSER-SESSION.md), Connectors UI, platform-help [22-browser-session-and-recipes.md](./platform-help/22-browser-session-and-recipes.md), [33-ip-whitelists.md](./platform-help/33-ip-whitelists.md).

## Record and replay a Track 1 recipe

Recipes use the same owner-scoped Desktop Local worker as autonomous Track 1 tasks. They do not require the legacy
shared Client Chrome lease.

1. Start `Start-BrowserWorker.ps1` and confirm **Browser Session → Desktop Local** shows **online**.
2. Open **Browser Session → Record recipe → New recording**.
3. Give the recipe a unique, descriptive name. Agents replay by exact name, so prefer names such as
   `GitHub repository vulnerability pages` over `My recipe`.
4. Optionally provide the first URL, then choose **Begin capturing pages**. The backend pins the recorder task to the
   currently selected Desktop Local node and will not silently switch to managed Playwright.
5. In the Playwright Chrome window, navigate to each stable page in the desired order. Back in Flolah, use
   **Capture this page** for navigation checkpoints and **Execute + record** for click, type, and key actions.
6. For changing text such as a social post, select **Type**, enter a safe sample, enable
   **Replace this text with agent input when replayed**, and name the input (for example `post_content`). The sample
   is executed during recording, while the recipe stores `{{post_content}}`.
7. Choose **Done — save recipe**. Confirm that the recipe shows its required input names.
8. Grant the intended COO or specialist both `browse_recipe_list` and `browse_recipe_run` in
   **Agent Workspace → Tool access**.
9. Ask the agent to run the exact recipe with the changing value. The tool call is:

   ```json
   {
     "recipe_name": "LinkedIn dynamic post",
     "inputs": { "post_content": "The text to publish" }
   }
   ```

   The agent should call `browse_recipe_list`, supply every returned `required_inputs` name to `browse_recipe_run`,
   then wait with `browse_task_status`. Missing inputs fail before Flolah performs any browser action.

The recorder executes only actions explicitly entered in the wizard; it does not passively intercept arbitrary mouse
clicks or typing. Placeholders work across supported action arguments and are resolved from the replay task's owner-scoped
`inputs` object. Never use dynamic inputs for passwords, tokens, payment data, or other secrets.

## Task planning, evidence, and tab lifecycle

- Autonomous tasks create a compact observable plan before acting.
- Every successful action is stored with execution evidence. Screenshot goals require a real screenshot artifact.
- A separate completion check validates current page state and evidence before a task can become `completed`.
- Missing mandatory evidence fails the task instead of accepting an unsupported `done` claim.
- Desktop-worker tabs created for completed or failed tasks remain available briefly for review, then close automatically.
  Set `input.keep_tab_open=true` only when a caller deliberately needs the task-owned tab retained.
- Tabs not created by the worker, and tasks blocked for login or approval, are not automatically closed.
