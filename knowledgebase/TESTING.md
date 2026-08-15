# Agent OS — Testing

## Platform Help agent (local)

After pulling Platform Help changes:

```powershell
cd backend
node scripts/seed-platform-help-agent.js
node scripts/test-platform-help-seed.js
node scripts/test-platform-help-rag.js
# Register temp CEO + list agent + Master Data docs (skips chat):
$env:SKIP_CHAT='1'; node scripts/test-platform-help-chat.js
# Full chat (needs OpenClaw gateway paired + content-tools plugin loaded):
node scripts/test-platform-help-chat.js
```

Also run from repo root: `node scripts/ensure-all-agent-workspaces.js` and `node scripts/apply-openclaw-agents-config.js`, then restart the gateway.

Help corpus: `knowledgebase/platform-help/` → Master Data docs titled `Flolah Help — …`. Agent id: `platformhelp`.

## Tool API rate limits (per-user call caps)

After changing `backend/src/services/tool-api-rate-limits.js` or the Tools → Rate limits UI:

```powershell
cd backend
node scripts/test-tool-api-rate-limits.js
```

Expect: consume → 429 when capped → manual/auto reset audit → skip Kanban/browse. UI: **Tools → Rate limits** on `/content-tools` (help **11**). Cron: `TOOL_API_RATE_LIMIT_RESET_CRON` (default `5 0 * * *`).

## Video content studio (storyboard CEO PDF)

After changing `standard/video-content/workflow-reasoning.json` or the CEO-gate PDF attach path:

```powershell
cd backend
node scripts/test-video-storyboard-ceo-approval.js
# Re-publish golden graphs for CEOs who already have Story/Scene/Prompt (no new hires):
$env:REFRESH_WORKFLOWS_ONLY='1'; node scripts/seed-video-content-workflows.js
# Full pack smoke (install + two sample boards):
$env:WORKFLOW_SEED_OWNER_ID='ceo-bala'; node scripts/test-video-content-phase1.js
```

The **run video storyboard** CEO Kanban card must show a scene summary and a PDF on **Artifacts**.

## OpenClaw chat 404 / Agent Chat 502 (Docker / VPS)

Healthcheck only hits gateway `/`. If `openclaw.json` lost `gateway.http.endpoints.chatCompletions`, **POST `/v1/chat/completions` returns 404** while the container stays “healthy”, and Agent OS chat maps that to **502**.

```bash
# On VPS (fatal gate is also part of vps-deploy-latest.sh):
cd /opt/agent-os/deploy
bash scripts/vps-verify-openclaw-chat.sh

# Expect: openclaw chat gate OK (http=200|401|400 — anything except 404)
```

Code paths:
- Safe openclaw writes: `backend/src/services/openclaw-config-safe.js`
- Entrypoint repair: `deploy/scripts/ensure-openclaw-gateway-config.js`
- Live probe: `deploy/scripts/vps-verify-openclaw-chat.sh`

## Onboarding Helper + Workflow Builder (prompt E2E)

Docs + copy-paste prompts: `knowledgebase/platform-help/27-onboarding-helper.md`.

```powershell
# Against VPS (public URL from AGENT_OS_PUBLIC_URL, e.g. https://flolah.cloud):
$env:BASE_URL = "https://flolah.cloud"
$env:TOKEN = "<ceo-session-token>"
node backend/scripts/e2e-onboarding-wf-prompts.mjs
```

Seeds tools `onboarding_save_proposal` / `onboarding_apply_proposal` on backend startup; re-seed agent grants if needed:

```bash
docker exec -w /opt/agent-os/backend agent-os-backend-1 node scripts/seed-onboarding-helper-agent.js
```

## IBKR Monthly Positive Return (local)

```powershell
cd backend
$env:IBKR_TRADING_ENABLED='0'; $env:BRIDGE_MOCK_IBKR='1'
node scripts/test-monthly-trading-seeds.js
node scripts/test-monthly-trading-paper-e2e.js
node scripts/test-local-ibkr-bridge-package.js
node scripts/certify-monthly-trading-workflows.js --dry-run
# Re-seed W3 after event-parse / ingest changes:
node scripts/seed-monthly-trading-w3-workflow.js
# Optional: unit-level transactional clear (from backend, custom script; or use UI Clear data…)
# Preview/clear are owner-scoped APIs:
#   GET  /api/ibkr-trading/summary/clear-transactional
#   POST /api/ibkr-trading/summary/clear-transactional  body {"confirm":"CLEAR_IBKR_TRANSACTIONAL"}
```

Docs: `knowledgebase/IBKR-MONTHLY-WORKFLOWS.md`, `platform-help/20-ibkr-monthly-trading.md` (Summary UI + clear), Phase 4 runbook `IBKR-MONTHLY-PHASE4.md`. UI route: `/ibkr-summary`.

## Master Data purge-all + protected help docs

```powershell
cd backend
node scripts/test-purge-all-documents.js
```

UI: **Master Data → Documents → Purge all uploads** deletes CEO uploads only. Platform Help / User Guide show a **protected** badge and cannot be deleted.

## Agent delete: FK cascade + no resurrection

```powershell
cd backend
node scripts/test-agent-delete-cascade.js
```

Covers the two bugs this replaced: a bare `DELETE FROM agents` still fails with `FOREIGN KEY constraint failed` when the agent has Kanban assignments (the test asserts that), while `deleteAgentCascade()` succeeds, unassigns the cards instead of deleting them, reparents children, and leaves nothing behind when it rejects a COO delete.

It also asserts the agent stays deleted: `deleted_agents` tombstones keep the id out of `listStandardAgentIds()` (so the boot-time full-catalog re-grant for privileged CEOs cannot take it back) and `POST /api/openclaw/sync` skips tombstoned ids instead of re-inserting them.

UI: **Dashboard → org chart → Remove**. After removing, restart the backend and hit **Sync from OpenClaw** — the agent must not return.

## Restart services before testing

Restart **backend**, **frontend**, and **OpenClaw gateway** so the latest code and config are loaded:

1. **Backend** (port 3001): stop any running process (Ctrl+C), then:
   ```powershell
   cd c:\Users\balaj\projects\agents\agent-os\backend
   npm run dev
   ```
2. **Frontend** (port 3000): stop, then:
   ```powershell
   cd c:\Users\balaj\projects\agents\agent-os\frontend
   npm run dev
   ```
3. **OpenClaw gateway** (port 18789): stop, then:
   ```powershell
   openclaw gateway --port 18789
   ```
   Or use **start-all.ps1** from `agent-os` to open all three in separate windows.

## Full API test (all features)

From the **agent-os** folder (or with `BASE_URL` set):

```powershell
node tests/api-full.js
```

This covers:

- **Health** — GET /health
- **Agents** — GET /agents, POST /agents (new agent creation), GET /agents/:id
- **Standups** — GET /standups, POST /standups (schedule standup), GET /standups/:id, POST /standups/:id/run-coo (summary)
- **Agent workspace (MD files)** — GET /agents/:id/workspace/files, GET .../files/:name (read), PUT .../files/:name (update MD)
- **Human–agent** — GET /agents/:id/chat (history), POST /agents/:id/chat (send message)

Optional env:

- `SKIP_RUN_COO=1` — skip Run COO (needs ANTHROPIC_API_KEY in backend .env).
- `SKIP_CHAT=1` — skip chat send (needs OpenClaw gateway running).
- `BASE_URL=http://127.0.0.1:3001` — backend URL (default when frontend proxy is not used).

## Frontend test cases (manual)

After opening http://127.0.0.1:3000:

1. **Dashboard — Org chart**  
   Agent names and roles come from the DB (no hardcoded names). You should see CEO (me) and, under it, the COO agent (name + role from DB) and delegated agents.

2. **New agent creation**  
   Open **Agent Workspaces** → **Add agent**: enter name and role (optional department, reports-to, budgets), submit. The new agent appears under Agent Workspaces and on the Dashboard org chart. Org chart → **Design** can also add agents.

3. **Schedule standups**  
   In "Daily standups summary", click "Create standup". A new standup appears in the list. Select it to see COO summary / CEO summary (empty until "Run COO" is used).

4. **Updating MD files**  
   Open an agent's Workspace (from Dashboard or Workspace (MD) page). Select soul, agents, or memory; edit the text and click Save. Reload to confirm persistence.

5. **Summary (Run COO)**  
   Select a standup, optionally add responses via API, then click "Run COO". COO summary and CEO summary should appear (requires ANTHROPIC_API_KEY in backend .env). Use "Listen (Edge TTS)" to hear the summary.

6. **Human–agent interaction**  
   From the Dashboard or Workspace page, open "Chat" for an agent. Send a message; the reply appears (requires OpenClaw gateway running and agent workspace/agent dir set up).

7. **TOTP first login**  
   With `MFA_MODE=TOTP` and MFA required, a new CEO/admin who has not enrolled yet must see both a **QR code** and the **security key** on login/register, then a 6-digit code field. Enrolled users only see the code field (no QR/key).

## Smoke test (quick)

```powershell
cd backend
npm run test:smoke
```

Runs GET /health, GET /agents, GET /standups. Backend must be running.

## Budgets / Agent View / org leaf members

No running backend needed — these hit the DB and module graph directly:

```powershell
node backend/scripts/verify-budgets-org-members.js   # tables + ledger + warn-then-block + allocation split
node backend/scripts/verify-module-graph.js          # routers/services import cleanly (no circular breaks)
node backend/scripts/verify-agent-view-api.js        # authenticated Agent View / budgets / org-members (backend up)
node backend/scripts/test-org-member-delegation-e2e.js  # mock A2A leaf member + COO delegation + budget block
node backend/scripts/test-tool-api-rate-limits.js       # per-user tool API call caps (day/month, audit, block)
```

On VPS after deploy:

```bash
bash /opt/agent-os/deploy/scripts/vps-smoke-budgets-org-members.sh
bash /opt/agent-os/deploy/scripts/vps-regression-full.sh
```

### Goal plans (multiphase adhoc)

```bash
# Durable CRM→ERP + Platform Help specialty + notify_ceo (force-complete child terminals by default)
docker exec -w /opt/agent-os/backend agent-os-backend-1 node scripts/test-goal-plan-adhoc-e2e.mjs
# Async ack + goal-correlated terminal notifies (plan still running after create; notifies include agr + title)
docker exec -w /opt/agent-os/backend agent-os-backend-1 node scripts/test-goal-plan-async-ui.mjs
# or via full regression pack on VPS (mints session; no password needed):
bash /opt/agent-os/deploy/scripts/vps-regression-full.sh
# npm aliases (from backend/):
#   test:e2e:goal-plan | test:goal-plan:async-ui | test:goal-plan:unit | test:goal-plan:acceptance
```

Env: `REGRESSION_GOAL_PLAN` (pack, default on), `REGRESSION_GOAL_PLAN_FORCE_TERMINAL` (default 1), `REGRESSION_CEO_ID`, `GOAL_PLAN_MAX_SPECIALTY`.

Ad-hoc chat **reuse trap:** COO session/MEMORY may quote an old `agr-…` on a similar prompt — start **New chat** or say *create a new plan*. Backend create always stores a new `agr-…` when the tool is invoked. Scheduled **plan-mode** fires also create a new `agr-…` each tick (approved `plan_json` is only the step template).

`vps-regression-full.sh` sets `AGENT_OS_REGRESSION_TOKEN` so `tests/lib/ceo-session.js` skips password login (needed when MFA is on or the default password is not in env).

Manual UI checks:

1. **Departments** — Dashboard department picker → **Edit**: set purpose + monthly token budget; confirm the row updates in **Master Data → `departments`**.
2. **Agent budgets** — Agent Workspaces → **Add agent** with a monthly token budget and error budget %; confirm they appear in **Efficiency View → Agent View → Edit budget**.
3. **Agent View** — `/efficiency` → **Agent View** tab: selector lists internal agents plus any leaf members, gauges render, and the Activity / Outcomes / Token budget / Reliability charts switch.
4. **Warn-then-block** — set a tiny token budget (e.g. 100) on a test agent, chat with it twice; the second turn should be refused with a budget message (HTTP 429) and a bell warning should have arrived at 80%.
5. **Org leaf members** — External Agents (or AgentExchange for your own publication) → **Add to org** with department + reports-to; confirm the badge shows in the org designer, then **Resync ORG.md & AGENTS.md** and check the COO's ORG.md lists the member key.
6. **COO delegation to a leaf member** — ask the COO for work matching the leaf member's purpose; a Kanban card should be created, the agent invoked, and the card completed or failed with the outcome.

---

## Standup → COO → TechResearcher test

This test validates: **COO had a standup with inputs on topics for LinkedIn "AI for Finance industry" → COO messages TechResearcher to do research and come back with topics → COO summarizes for CEO Bala.**

### Prerequisites

- **Backend** running (`cd backend && npm run dev`)
- **OpenClaw gateway** running (`openclaw gateway --port 18789`) so TechResearcher can reply
- **OPENAI_API_KEY** set in backend `.env` for COO summarization
- TechResearcher and COO (BalServe) in DB: run `node scripts/ensure-techresearcher.js` and `node scripts/seed-all.js` if needed

### Run automated test

From the **backend** folder:

```bash
node scripts/run-standup-research-test.js
```

Steps performed:

1. Create standup with topic: AI for Finance industry (LinkedIn research).
2. Add standup response (topics for research for LinkedIn).
3. Run COO summarization on standup (requires OPENAI_API_KEY).
4. COO messages TechResearcher via `POST /agents/techresearcher/chat/from-agent` (requires gateway).
5. Add TechResearcher reply to standup and run COO again for CEO summary.

View the standup in the Dashboard at http://127.0.0.1:3000.

### Manual alternative

1. **Dashboard** → Create standup (pick date/time) → add a response with content: "Topics for research for publish to LinkedIn: AI for Finance industry."
2. Click **Run COO** to get COO/CEO summary.
3. **Chat** → open TechResearcher → send: "From our standup we need research and 3–5 talking points for a LinkedIn post on AI for Finance industry. Please research and reply with angles we can use."
4. Copy TechResearcher's reply, add it as another response to the standup (or create a new standup), then **Run COO** again for the final summary for Bala.

### Agent-to-agent (COO → TechResearcher)

The backend supports **COO messaging TechResearcher** via:

- **API:** `POST /agents/techresearcher/chat/from-agent` with body `{ "from_agent_id": "balserve", "message": "..." }`
- **Frontend:** use `api.agentChatFromAgent('techresearcher', 'balserve', message)` (e.g. from a "Send from COO" button).

The message is stored in TechResearcher's chat as "From BalServe (COO): ..." and the reply is returned and persisted.

---

## Standup flow — UI test checklist

Test from the **Dashboard** in the browser. No backend scripts required.

### Prerequisites

- Backend and frontend running. All API routes are under `/api`; the frontend proxies `/api` to the backend (or set `VITE_API_URL` to the backend base URL including `/api`).
- OpenClaw Gateway running (for COO chat and for "Get work from team" — delegation uses Gateway cron one-shot jobs that POST to the backend webhook).
- At least one agent in the org with COO set, and at least one delegated agent (e.g. TechResearcher).

### 1. Create standup → COO chat opens

- [ ] Open **Dashboard**.
- [ ] In **Standups**, set date/time and click **Create standup**.
- [ ] Right side shows **COO chat — [date/time]** and an empty message area.
- [ ] Placeholder text: "No messages yet. Send the day's tasks to the COO below."

### 2. Chat is specific to that standup

- [ ] Send a message in the chat (e.g. "Focus on research today").
- [ ] You see **You:** and **COO:** messages in the same chat.
- [ ] Select a **different** standup from the list (or create another).
- [ ] Chat content changes; the new standup has its own (possibly empty) history.
- [ ] Select the first standup again; your earlier messages and COO replies are still there.

### 3. Get work from team → updates in chat

- [ ] With a standup selected, click **Get work from team**.
- [ ] A COO reply appears in the chat (e.g. "I've asked the team...").
- [ ] Click **Check for updates** (or wait for cron to run).
- [ ] New COO messages appear in the **same** chat with agent updates (when cron has run and agents have responded).

### 4. Optional summary

- [ ] **Run COO summary** runs without error (may need agent responses in standup_responses for non-empty summary).
- [ ] If a summary exists, **Listen** reads it; **Summary** details section can be expanded to read COO/CEO text.

### 5. Open existing scheduled standup

- [ ] With at least one standup in the list, click it (do not create a new one).
- [ ] COO chat opens for that schedule with that standup's messages only.
- [ ] Sending a message and using **Get work from team** / **Check for updates** keeps everything in this standup's chat.

**Expected flow:** Create or open standup → COO chat is the main view → give tasks in chat → COO delegates via cron → child agent responses show up in this chat. Each standup has its own chat history.

## Scheduled goals (COO plan vs specialty employee)

Help **28**. **Generate draft plan** is COO-only (`agentAllowsScheduledGoalPlan` = `is_coo`).

- [ ] On `/scheduled-goals`, pick a non-COO employee (e.g. Business Discovery): Generate / Amend / Build / feedback are disabled; hover mentions COO-only plans.
- [ ] **Save & schedule** activates with `plan_status: none` (no specialty ladder).
- [ ] Pick the COO: Generate draft works; lettered `A) … B) …` stays sequential specialties (not `kanban_create_task` → `notify_ceo` → `agent_continue`).
- [ ] BD Act schedule: prompt `business_discover` persist + handoff; do **not** name `kanban_create_task` / `notify_ceo` or a **B) CRM Maker** block. CRM starts from the assigned Kanban card (orphan watcher, ~5 min).

```powershell
# Local / container:
cd backend
node scripts/test-goal-plan-specialty-coo-native.mjs
```

VPS: `bash /opt/agent-os/deploy/scripts/vps-verify-scheduled-goals.sh`

## Social Researcher + Business Discovery (VPS)

Requires hired employees (AgentExchange) and Places: platform `GOOGLE_PLACES_API_KEY` **or** vault **`GOOGLE_PLACES_BYOK`**. Live Nearby/Discover runs when geocode returns 200; otherwise the smoke asserts structured 503.

```bash
cd /opt/agent-os/deploy
bash scripts/vps-smoke-social-research.sh
# or:
docker compose --env-file .env exec -T -w /opt/agent-os/backend backend node scripts/test-places-parse-text.mjs
docker compose --env-file .env exec -T -w /opt/agent-os/backend backend node scripts/vps-test-social-research.mjs
# Tampines research-brief chat (fresh session + table assert):
docker compose --env-file .env exec -T -w /opt/agent-os/backend backend node scripts/e2e-tampines-discover.mjs
```

Help **42**. Nearby Search FieldMask must not include `nextPageToken` (HTTP 400). After adding a Places key, start a **new chat**.

## Admin Tools Onboarding (VPS Docker)

Requires `DOCKER_TOOLS_ENABLED=1`, compose overlay `docker-compose.docker-tools.yml`, and a privileged OTP session (authenticator if enrolled, otherwise email; 30 min, `ADMIN_PRIVILEGED_SESSION_TTL_MS`).

```bash
cd /opt/agent-os/deploy
docker compose exec -T -w /opt/agent-os/backend \
  -e ADMIN2_EMAIL=admin2@agent-os.local \
  -e ADMIN2_PASSWORD=... \
  -e ADMIN2_TOTP_SECRET=... \
  backend node scripts/test-docker-tool-onboarding-vps.js
```

Grant via Agent Workspace tool access, then optional TechResearcher invoke smoke:
`node scripts/test-techresearcher-echo-probe-grant.js`.

## Admin AgentSystem recovery (privileged session)

Helpers (no OTP, no mutate): `cd backend && node scripts/test-admin-privileged-session.js`

UI: Admin login → **AgentSystem recovery**. Status loads without OTP. Drain / restart / repair require OTP; session lasts 30 minutes (`ADMIN_PRIVILEGED_SESSION_TTL_MS`). Help **43**.
