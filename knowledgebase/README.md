# Agent OS — Knowledge base

Documentation lives here so Cursor and humans can find it. **Root README.md** stays at `agent-os/README.md` and is the main entry point.

## Index (for Cursor / future reference)

| File | Purpose |
|------|---------|
| **AI-COMPANY-OS.md** | **Canonical** category (AI Company OS), golden messaging layers, terminology (AI employee vs agent API), OS primitives, screen map, design rule for new features, Phase A–F roadmap. Refer for portal/website copy. |
| **PHASE-D-E-F-OPERATE.md** | Phase D Day 0 operating model + Day 1 autonomy install; Phase E harden; Phase F self-improve. |
| **BUSINESS-CORE-WORKSPACE-PLAN.md** | Business Core (Twenty/ERPNext + optional profile), tenancy maps, prefab CRM/ERP agents, Home vs Workspace (`/work`), Phase 1–2; entitlements rules. **Validate Phase 1 before Phase 2.** |
| **SQLITE-TO-POSTGRES-MIGRATION.md** | **End-to-end** Flolah App SQLite (`agent-os.db` + `ceo.db`) → PostgreSQL DB `flolah` on shared `twenty-db` (separate from Twenty CRM schemas). Architecture, packages A–G, cutover, parity, out-of-scope stores. |

| **VISION.md** | Product purpose, vision, core strengths, differentiator, and strategic focuses (AI Company OS + governed A2A). |
| **PITCH.md** | One-pager pitch: problem, solution, differentiators, audience, and success journey (from VISION + AI-COMPANY-OS). |
| **platform-help/** | CEO end-user Platform Help corpus (RAG). Highlights: **02** Digest/Workspace Builder/nav + Settings IP/Tokens; **11** Tools/Model/media; **16–17** Connectors/desktop; **19–20** crons + IBKR; **21–27** external→onboarding; **28–32** goals/setup/content/MCP OAuth/Business Core; **22** Browser Session + desktop worker; **33** IP Whitelists; **34** Tokens management |
| **AGENT-WORKSPACE-TEMPLATES.md** | Platform-shared agent workspace MD templates: apply in Agent Workspace, Admin CRUD, CEO publish-as-template. |
| **TESTING.md** | Restart steps, full API test, frontend manual tests, smoke test, standup→COO→TechResearcher test, standup UI checklist. |
| **GITHUB-SETUP.md** | One-time: create agent-os repo on GitHub and push (Options A/B, security check). |
| **IMPLEMENTATION_PLAN.md** | Product/roadmap: vision, architecture, phases (1–5), skills, TTS, token monitoring, references. |
| **AGENT_REVIEW_AND_SKILLS.md** | Agent review (COO, TechResearcher, SocialAssistant); secure skill recommendations and where skills live. |
| **CONFIGURE-CLAUDE-OPUS.md** | How to set Claude Opus (or other Anthropic models) in `~/.openclaw/openclaw.json` and API key. |
| **GATEWAY-PAIRING-1008.md** | Fix "gateway closed (1008): pairing required" — token in openclaw.json and OPENCLAW_GATEWAY_TOKEN. |
| **SESSION-HISTORY-VISIBILITY-TREE.md** | Fix "Session history visibility is restricted to the current session tree" — use injected session key or set `tools.sessions.visibility`. |
| **JOB-APPLICANT-WORKFLOW.md** | Job Applicant pipeline: four agents, profile intake, tools, Sheets/GDrive/Playwright plan, setup via `scripts/setup-job-applicant-agents.js`. |
| **DEPLOY-CENTOS-PODMAN.md** | Production deploy on CentOS/RHEL/Hostinger with Podman or Docker Compose: SELinux, firewall, volumes, OpenClaw/Chromium, OpenConnector, browser login, optional profiles. |
| **knowledgeGraph.md** | Neo4j knowledge graph for internal OpenClaw agent behavior, Kanban feedback, autonomous self-improvement, and progressive improvement dashboard. |
| **IBKR-TRADING-WORKFLOW.md** | IBKR MCP options, maker/checker paper workflow (budget, brackets, CEO day plan), Agent OS wiring, env vars, and security guardrails. |
| **IBKR-MONTHLY-TRADING-PLAN.md** | Monthly Positive Return trading system: split VPS/laptop architecture, market-data tools, Maker (Claude Opus)/Checker (deepseek-v4-flash), monthly drawdown guardrail, notifications + daily digest email, and phased implementation plan. |
| **platform-help/20-ibkr-monthly-trading.md** | **CEO / Platform Help:** W1–W5 purpose & outcomes, isolation, flow diagrams, bridge, **prerequisites**, **step-by-step setup**, **run/monitor**, **VPS deploy**, **IBKR Summary + Clear data**. |
| **IBKR-MONTHLY-MAKER-TOOLS.md** | Maker tool catalog: paper vs live requirements, which tools need API keys (FMP / Anthropic / DeepSeek / IBKR), and caching TTLs. |
| **IBKR-MONTHLY-WORKFLOWS.md** | W1–W5 + bridge defs, ops tables, Summary UI / clear APIs. |
| **IBKR-MONTHLY-EXECUTION-MODEL.md** | Cloud vs laptop workflows: when each runs, expected outcomes, day-plan statuses, and laptop↔VPS failure recovery. |
| **IBKR-MONTHLY-MAKER-PROMPT.md** | Canonical Maker system prompt (strategy + execution recovery + JSON schema). |
| **IBKR-MONTHLY-CHECKER-PROMPT.md** | Canonical Checker system prompt (approve/reject checklist + recovery focus). |
| **IBKR-MONTHLY-PHASE4.md** | Phase 4 runbook: certify env (Opus + deepseek-v4-flash), paper E2E script, W1/W3/W5 certify helper (not W2), Task Scheduler, multi-week paper before live. |
| **CLIENT-BROWSER-SESSION.md** | Client Chrome Browser Relay + NL browser tasks, `browse_*` tools, recipes, desktop local worker pointer, OpenClaw `browser-cdp`. |
| **BROWSER-SESSION-DESKTOP-LOCAL.md** | Implemented: Connectors Browser Session package; headed Playwright + persistent profile (BROWSER_HEADLESS=0, BROWSER_USER_DATA_DIR); owner jobs / IP whitelist. |
| **platform-help/22-browser-session-and-recipes.md** | CEO Platform Help: Browser Session UI, tool grants, recipe vs autonomous, feedback. |
| **IBKR-LOCAL-BRIDGE.md** | Laptop Phase 2 local HTTP bridge (`backend/local-ibkr-bridge/`): loopback auth, Gateway wrappers, webhook events, Task Scheduler, offline test. |
| **OPENCONNECTOR-WEBHOOKS.md** | OpenConnector MCP setup, event webhooks, email-inbound webhooks, disk file pollers, entitlements, e2e test. |

## Not in knowledgebase (stay at repo root or other paths)

- **README.md** — at `agent-os/README.md` (main project doc).
- **openclaw-workspace-templates/** — SOUL.md, MEMORY.md, AGENTS.md used by scripts; do not move.
- **openclaw-skills/** — SKILL.md and README per skill; install scripts reference these paths.
- **.cursor/agents/** — Cursor subagent instructions (code-review, remote-host-config, etc.).

## Video Tours / Onboarding (new)

| Doc | Topics |
|-----|--------|
| [VIDEO-TOURS-CEO-CURRICULUM.md](./VIDEO-TOURS-CEO-CURRICULUM.md) | <=12 CEO Video Tours playlist, production checklist |
| [video-tours/](./video-tours/) | Local scripts, VTT, exported mp4 assets |
| [CONTENT-CREATION-ORG-BLUEPRINT.md](./CONTENT-CREATION-ORG-BLUEPRINT.md) | Future content-studio org + agent/workflow map |
| [ONBOARDING-HELPER-PLAN.md](./ONBOARDING-HELPER-PLAN.md) | Onboarding Helper plan (UI + OpenClaw bridge) |
| [platform-help/27-onboarding-helper.md](./platform-help/27-onboarding-helper.md) | CEO help: selective apply + E2E chat prompt recipes |
| [platform-help/28-scheduled-goals.md](./platform-help/28-scheduled-goals.md) | CEO help: scheduled goals (hourly/daily/weekdays/weekly; create/edit/pause; COO tools) |
| [platform-help/29-company-setup.md](./platform-help/29-company-setup.md) | CEO help: Company setup first-run wizard vs Onboarding Helper |
| [platform-help/35-update-company-setup.md](./platform-help/35-update-company-setup.md) | Update Company Setup → company_memory Knowledge table |
| [platform-help/30-content-creator-ops.md](./platform-help/30-content-creator-ops.md) | CEO help: content ops publish / community / Ops Reporter (bell not email) |
| [platform-help/31-mcp-connectors-oauth.md](./platform-help/31-mcp-connectors-oauth.md) | CEO/ops help: Connectors → MCPs OAuth (Facebook, App override, other providers) |
| [AMENDMENT-CONTENT-MEDIA-API-PUBLISH.md](./AMENDMENT-CONTENT-MEDIA-API-PUBLISH.md) | Design amendment: Meta Graph publish, comments ingest, content_creator pack |
