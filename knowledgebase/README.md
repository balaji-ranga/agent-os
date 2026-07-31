# Agent OS — Knowledge base

Documentation lives here so Cursor and humans can find it. **Root README.md** stays at `agent-os/README.md` and is the main entry point.

## Index (for Cursor / future reference)

| File | Purpose |
|------|---------|
| **VISION.md** | Product purpose, vision, core strengths, differentiator, and strategic focuses (agent company OS + governed A2A). |
| **PITCH.md** | One-pager pitch: problem, solution, differentiators, audience, and success journey (from VISION). |
| **platform-help/** | CEO end-user Platform Help corpus (RAG; includes **20–25**: IBKR, external tools, browser session, avatars, channels, speech/published scenes) |
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
| **IBKR-MONTHLY-MAKER-TOOLS.md** | Maker tool catalog: paper vs live requirements, which tools need API keys (FMP / Anthropic / DeepSeek / IBKR), and caching TTLs. |
| **IBKR-MONTHLY-WORKFLOWS.md** | W1–W5 + bridge: ID, where, schedule/trigger, tools, purpose, outcome (quick reference tables). |
| **IBKR-MONTHLY-EXECUTION-MODEL.md** | Cloud vs laptop workflows: when each runs, expected outcomes, day-plan statuses, and laptop↔VPS failure recovery. |
| **IBKR-MONTHLY-MAKER-PROMPT.md** | Canonical Maker system prompt (strategy + execution recovery + JSON schema). |
| **IBKR-MONTHLY-CHECKER-PROMPT.md** | Canonical Checker system prompt (approve/reject checklist + recovery focus). |
| **IBKR-MONTHLY-PHASE4.md** | Phase 4 runbook: certify env (Opus + deepseek-v4-flash), paper E2E script, W1/W3/W5 certify helper (not W2), Task Scheduler, multi-week paper before live. |
| **CLIENT-BROWSER-SESSION.md** | Client Chrome Browser Relay + NL browser tasks, `browse_*` tools, recipe list/run, OpenClaw `browser-cdp` redeploy checklist. |
| **platform-help/22-browser-session-and-recipes.md** | CEO Platform Help: Browser Session UI, tool grants, recipe vs autonomous, feedback. |
| **IBKR-LOCAL-BRIDGE.md** | Laptop Phase 2 local HTTP bridge (`backend/local-ibkr-bridge/`): loopback auth, Gateway wrappers, webhook events, Task Scheduler, offline test. |
| **OPENCONNECTOR-WEBHOOKS.md** | OpenConnector MCP setup, event webhooks, email-inbound webhooks, disk file pollers, entitlements, e2e test. |

## Not in knowledgebase (stay at repo root or other paths)

- **README.md** — at `agent-os/README.md` (main project doc).
- **openclaw-workspace-templates/** — SOUL.md, MEMORY.md, AGENTS.md used by scripts; do not move.
- **openclaw-skills/** — SKILL.md and README per skill; install scripts reference these paths.
- **.cursor/agents/** — Cursor subagent instructions (code-review, remote-host-config, etc.).
