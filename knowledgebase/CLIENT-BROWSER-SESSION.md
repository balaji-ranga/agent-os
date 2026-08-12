# Client Browser Session + Browser Tasks / Recipes

Use **Browser Session** (`/browser-session`) to run natural-language tasks in managed Playwright or a CEO-attached Chrome tab (Browser Relay), and to record reusable recipes.

## Multi-user / exclusive Client Chrome lease

Recipes, tasks, and URL policy are scoped by `ceo_user_id` (each CEO only sees their own).

The AgentSystem Browser Relay pairing WSS (`/browser/extension#<token>`) is **one per gateway** — not per user. To stop agent B from driving user A's attached Chrome, Agent OS enforces an **exclusive chrome lease**:

- Only **one** CEO may **Mark client session ready** at a time.
- That CEO's agents resolve to AgentSystem profile `chrome`; everyone else resolves to managed `AgentSystem` (even if they opted into client mode).
- A second CEO who marks ready gets **409** until the holder **Opts out** or clears ready.
- Status includes `chrome_lease: { holder_ceo_user_id, holder_label, is_holder, note }`.



## Desktop Local worker (multi-user Client Chrome)

True concurrent Client Chrome for multiple users uses **Desktop Local Mode** (per-CEO long-lived local browser worker) — not shared AgentSystem WSS session codes. See **[BROWSER-SESSION-DESKTOP-LOCAL.md](./BROWSER-SESSION-DESKTOP-LOCAL.md)**.

Worker defaults on the CEO PC: headed (`BROWSER_HEADLESS=0`) and persistent Playwright profile (`BROWSER_USER_DATA_DIR=browser-profile`) so site logins survive restarts. Package download lives under **Connectors** (or Browser Session when linked). Operator guide: [BROWSER-SESSION-DESKTOP-LOCAL.md](./BROWSER-SESSION-DESKTOP-LOCAL.md). Platform Help: [platform-help/22-browser-session-and-recipes.md](./platform-help/22-browser-session-and-recipes.md).

When the desktop worker is **online**, backend `browse_*` / open-snapshot-act prefer the laptop job queue; otherwise managed AgentSystem / Client Chrome lease apply as documented above.

## Content tools

| Tool | Purpose |
|------|---------|
| `browse_session_status` | Session profile (`chrome` / `AgentSystem`), gateway, setup, chrome lease |
| `browse_task_start` | Async NL autonomous (or recipe_replay if also granted `browse_recipe_run`) |
| `browse_task_status` | Status / wait (`wait_ms` ≤ 90000) |
| `browse_snapshot` / `browse_act` | Single-step |
| `browse_recipe_list` | List CEO-owned recipes |
| `browse_recipe_run` | Play recipe by `recipe_name` or `recipe_id` |

Grant **list** vs **run** separately in **Agent Workspace → Tool access**. Recipes/tasks are scoped by `ceo_user_id`.

## Safe task flow

1. `browse_session_status`.
2. Free-form: `browse_task_start` → returns `task_id` immediately.
3. Recipe: `browse_recipe_list` → `browse_recipe_run`.
4. `browse_task_status` until completed / failed / blocked_on_input.

## Recipe vs autonomous

Named recipe / replay / saved trail → **`browse_recipe_run`**. Known pattern (e.g. LinkedIn notifications) → list + match. One-off goals → autonomous `browse_task_start`. Never invent recipe names.

## Chat thumbs → learnings

Thumbs-down on agent chat requires a comment; it feeds `learnings_summary` as a critical signal.

## URL policy

Deny wins. Non-empty allow list restricts opens. Patterns: `*`, `*.domain.com`, `domain.com/*`, `https://domain/path/*`.

## Redeploy / AgentSystem (ops)

Must stay true on every init/configure:

1. `browser.enabled = true`
2. Agent **`browser-cdp`** (env `BROWSER_TASK_CDP_AGENT_ID`) with `tools.profile=coding` and `alsoAllow: ["browser"]` — **no** `tools.allow` on that agent
3. Global `tools.allow` must **not** include `browser` (cleared by `configure-AgentSystem-docker.js`)
4. Backend startup: `seedBrowserSessionToolsIfMissing` + `grantBrowserSessionToolsToDefaultAgents`
5. Extension `PARAM_SCHEMAS` + plugin `contracts.tools` include `browse_*`
6. Verify: `node deploy/scripts/verify-AgentSystem-parity.js`

CEO guide: `knowledgebase/platform-help/22-browser-session-and-recipes.md`.
