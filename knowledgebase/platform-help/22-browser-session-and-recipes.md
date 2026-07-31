# Browser Session, recipes, and browse_* agent tools

## What it is

**Browser Session** (`/browser-session`) lets you run natural-language browser work in:

- **Managed Playwright** (`openclaw` profile) — server-side Chromium, or
- **Client Chrome** — your desktop Chrome with the OpenClaw Browser Relay extension attached

Agents do **not** drive this with the built-in OpenClaw `browser` tool in chat (that path times out / is denied for specialists). They use Agent OS **`browse_*` content tools**, which the backend runs over CDP (dedicated `browser-cdp` agent).

## CEO setup (Client Chrome)

1. Open **Browser Session** in the left nav.
2. Opt in to Client Chrome / Browser Relay and install the extension pack if prompted.
3. Attach a tab, log into sites you care about (LinkedIn, etc.), then **Mark ready**.
4. Optionally set **URL allow / deny** lists (deny always wins).
5. **Recorder (wizard):** Browser Session → **Record a recipe** → **Start record wizard** → name the recipe → confirm Chrome ready → navigate in Chrome and click **Capture this page** after each URL → **Done — save recipe**.

### Multi-user (same server)

Recipes and tasks stay private to your account. The browser relay pairing string is **shared** for the whole Flolah instance (one WSS token per gateway).

Only **one** user can hold **Client Chrome** at a time (**exclusive lease**):

- If Mark ready fails because someone else holds the lease, wait until they **Opt out**, or keep working with managed Playwright (your agents automatically fall back).
- Status shows who holds the lease. Your agents never drive another user's attached Chrome tabs.

## Agent tools (grant in Workspace → Tool access)

| Tool | Purpose |
|------|---------|
| `browse_session_status` | Profile (`chrome` vs `openclaw`), gateway, chrome lease, setup hints |
| `browse_task_start` | Free-form NL goal (`mode: autonomous`); async `task_id` |
| `browse_task_status` | Poll / wait (`wait_ms` up to 90000) |
| `browse_snapshot` / `browse_act` | Single-step observe / act |
| `browse_recipe_list` | List **your** saved recipes only |
| `browse_recipe_run` | **Play** a recipe by `recipe_name` (preferred) or `recipe_id` |

**Access:** Recipes and tasks are stored per CEO (`ceo_user_id`). Agents only see **your** recipes. Grant **list** and **run** separately — list alone does not play recipes. Default org agents (COO, Workflow Builder, Platform Help, TechResearcher) get browse tools at boot; custom agents need an explicit grant.

## Recipe vs autonomous (what agents should do)

1. You **name a recipe** / say run-replay-play / use the saved trail → `browse_recipe_list` → **`browse_recipe_run`**.
2. Ask matches a **known saved pattern** (e.g. LinkedIn notifications) → list, name-match, run; else autonomous and say so.
3. One-off goals (flights, check a URL) → **`browse_task_start`** autonomous.
4. Agents must not invent recipe names.

Live task progress also appears in agent chat **History** (Browser Tasks strip) when a `task_id` is active.

## Chat feedback → learnings

Thumbs **down** on an agent chat reply requires a short comment. Comments feed **`learnings_summary`** (highest priority). Use this when an agent picked the wrong mode (recipe vs autonomous) or mishandled a browser goal.

## Safety

- Do not book, pay, or submit via automation.
- Blocked URLs return an error — agents must not bypass your allow/deny lists.
- Prefer deep-link search summaries over clicking Book/Pay.
- Do not expect two users' Client Chrome sessions to run in parallel on one gateway — use managed mode or take turns on the lease.

## Ops / redeploy (for admins)

Repeatable on every deploy:

- Backend seeds `browse_*` in `content_tools_meta` and grants defaults (`seed-browser-session-tools.js`).
- OpenClaw configure (`configure-openclaw-docker.js` / `apply-openclaw-agents-config.js`): `browser.enabled=true`, dedicated **`browser-cdp`** agent (`tools.profile=coding` + `alsoAllow: ["browser"]`), **no** global `tools.allow` containing `browser` (that strips CDP).
- Env: `BROWSER_TASK_CDP_AGENT_ID` (default `browser-cdp`) on backend + openclaw.
- Extension schemas include `browse_recipe_run` (`openclaw-extensions/agent-os-content-tools`).
- Verify: `node deploy/scripts/verify-openclaw-parity.js`

More detail: `knowledgebase/CLIENT-BROWSER-SESSION.md`.
