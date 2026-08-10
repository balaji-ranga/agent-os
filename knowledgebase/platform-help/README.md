# Flolah Platform Help — Index

**Audience:** CEOs (end users) and the **Platform Help** agent.  
**Consumption:** Uploaded into each CEO’s **Master Data → Documents** and searched with `master_data_rag` (keyword chunk RAG). Do not paste this entire tree into an agent’s SOUL.

| Doc | Topics |
|-----|--------|
| [01-getting-started.md](./01-getting-started.md) | Register, login, MFA, Profile / BYOK + **chat model** via **API Keys** |
| [02-navigation-and-chrome.md](./02-navigation-and-chrome.md) | Left nav map, sections **collapsed by default**, Digest formulas (per-agent hourly rates), Workspace Builder, Home **OEI** pointer (**36**) |
| [03-dashboard-agents-chat.md](./03-dashboard-agents-chat.md) | Org chart, chat **attachments**, inline auth media players, workspace MD, **templates** Apply/Publish, tools access, Resync |
| [04-kanban-standups-broadcast.md](./04-kanban-standups-broadcast.md) | Kanban (agent-owned status), standups → COO, Broadcast, `notify_ceo` when/when-not |
| [05-master-data-rag.md](./05-master-data-rag.md) | Tables (incl. **company_memory**), CSV, documents, RAG; **Inbound attachments**; **Purge all uploads**; protected Help/User Guide docs |
| [06-workflows-building.md](./06-workflows-building.md) | Create / edit / publish / run workflows, I/O mapping, templates |
| [07-workflow-nodes-reference.md](./07-workflow-nodes-reference.md) | Every node type incl. **Connector**; attributes, inputs, outputs |
| [08-mcp-integrations.md](./08-mcp-integrations.md) | Register MCP, test, use in workflows / Brain (vs Connectors OAuth tab) |
| [09-a2a-agent-exchange.md](./09-a2a-agent-exchange.md) | External agents, Publish A2A (sync/async, callback, deny_all/whitelist), AgentExchange **Test agent**, Admin **A2A invocation logs**, mock callback inbox |
| [10-policies-guardrails.md](./10-policies-guardrails.md) | CEO common guardrails for all agents + Brain nodes |
| [10-job-applicant-pipeline.md](./10-job-applicant-pipeline.md) | Job profiles & prebuilt job workflows |
| [11-content-tools-scripts-profile.md](./11-content-tools-scripts-profile.md) | **Tools** UI, **Tools → Model** mapping, **MEDIA: / auth media lockdown**, platform feedback tools, chat attachments / inbound media, AGENT-OS-OPS, summary caches, scripts, AI Snipper, Efficiency View, Profile **provider + model** |
| [12-troubleshooting.md](./12-troubleshooting.md) | Common issues (A2A, notify, Kanban, API Keys, Connectors, **WhatsApp Media failed**, inbound attachments, scheduled jobs, storage/purge, department budget) |
| [13-workflow-autonomous-certify.md](./13-workflow-autonomous-certify.md) | Maker/Checker certify jobs, status-on-request, resume inputs |
| [14-workflow-dynamic-values.md](./14-workflow-dynamic-values.md) | `{{…}}` templates, variables, trigger input, **vault** auth |
| [15-api-keys-vault.md](./15-api-keys-vault.md) | **API Keys** vault, auto-seeded BYOK slots, `Platform_BYOK` / Replicate / Brave / ElevenLabs |
| [16-connectors-openconnector.md](./16-connectors-openconnector.md) | **Connectors → OpenConnector** SaaS apps + Connector node + IBKR bridge; MCPs tab points to **31** |
| [17-desktop-windows-download.md](./17-desktop-windows-download.md) | **Download for Windows** — local orchestrator, tokens, IP whitelist (W2 execute) |
| [18-agent-budgets-and-org-members.md](./18-agent-budgets-and-org-members.md) | Department purpose/budget, **agent token + error budgets** (warn-then-block), **Efficiency → Agent View**, external/A2A agents as org leaf members |
| [19-scheduled-jobs-and-crons.md](./19-scheduled-jobs-and-crons.md) | Platform crons vs your own schedules, **COO status checker** (daily report + HTML email), **data retention** purge, Storage (MB); points to **Scheduled goals** |
| [20-ibkr-monthly-trading.md](./20-ibkr-monthly-trading.md) | **IBKR Monthly Positive Return**: W1–W5 goals/outcomes, flow diagrams, per-CEO isolation, bridge download, **IBKR Summary UI** (scrollable cards + **Clear data…**) |
| [21-external-tools-and-apis.md](./21-external-tools-and-apis.md) | **External tools & APIs** needing keys; content-tool delivery (`MEDIA:` + auth `/api/media`) |
| [22-browser-session-and-recipes.md](./22-browser-session-and-recipes.md) | **Browser Session**, Client Chrome, **Desktop Local worker** (Connectors package, headed + persistent profile), `browse_*`, recipes, learnings |
| [23-avatars-virtual-room.md](./23-avatars-virtual-room.md) | **3D Avatars**, Virtual Rooms, scenes, @mention routing, media overlays (`MEDIA:` not bare HTTPS), ElevenLabs TTS/STT, optional Hunyuan3D |
| [24-agent-channels.md](./24-agent-channels.md) | **Slack / WhatsApp** BYOK wizard, vault tokens, OpenClaw bindings, **outbound MEDIA: attach**, **inbound → inbound/attachments/** |
| [25-speech-and-published-scenes.md](./25-speech-and-published-scenes.md) | **Published Scenes** public `/p/vr/:slug`, free Whisper STT + Piper TTS, guest VR tokens vs `MEDIA_PUBLIC_SIGNED`, `speech_stt` / `speech_tts` |
| [26-content-explorer.md](./26-content-explorer.md) | **Content Explorer** — browse/preview/download uploaded + generated files |
| [27-onboarding-helper.md](./27-onboarding-helper.md) | **Onboarding Helper** — chat save/apply tools, selective Review cards, **E2E prompt recipes** (MarketWatcher + Workflow Builder Ollama loop) |
| [28-scheduled-goals.md](./28-scheduled-goals.md) | **Scheduled goals** — hourly/daily/weekdays/weekly CEO prompts; create/edit/pause UI + COO tools |
| [29-company-setup.md](./29-company-setup.md) | **Company setup** — first-run wizard `/company-setup` (type, mission, DNA, team Apply, management style); vs Onboarding Helper |
| [30-content-creator-ops.md](./30-content-creator-ops.md) | **Content creator ops** — Facebook Page via Meta Graph MCP, publish social, comment ingest/triage, Ops Reporter **bell** (not email), Company Operate |
| [31-mcp-connectors-oauth.md](./31-mcp-connectors-oauth.md) | **Connectors → MCPs** OAuth: Facebook / Meta Graph, CEO App ID override, other OAuth MCPs; OpenConnector config → **16** + OPENCONNECTOR-WEBHOOKS |
| [32-business-core-crm-erp.md](./32-business-core-crm-erp.md) | **Business Core** — optional Twenty CRM / ERPNext ERP, prefab **Maker/Checker** AI employees, platform MCPs `mcp-flolah-crm` / `mcp-flolah-erp`, `/work` + embed menus |
| [33-ip-whitelists.md](./33-ip-whitelists.md) | **IP Whitelists** — Settings central firewall for IBKR bridge, Workflow download, A2A, Browser Session worker (shared store with federated UIs) |
| [34-tokens-management.md](./34-tokens-management.md) | **Tokens management** — list/revoke external package tokens (desktop, IBKR bridge, Browser Session) |
| [35-update-company-details.md](./35-update-company-details.md) | **Update Company Details** — avatar menu edits to Knowledge `company_memory` |
| [36-operational-effectiveness.md](./36-operational-effectiveness.md) | **OEI** — Home score 0–100 (Green≥75), 14-day domains, **goal runs vs distinct goals**, COO tool `operational_effectiveness` (not Digest $) |
| [37-company-pnl.md](./37-company-pnl.md) | **Company P&L** — design roadmap: run cost · CRM/channel/IBKR income · vs today’s tokens/CRM/ERP/OEI; full plan `knowledgebase/AUTOMATED-PNL.md` |
| [38-maker-checker-coordination.md](./38-maker-checker-coordination.md) | **Maker/Checker Option 1** — Kanban control plane, ERP hard submit, CRM high-risk process gate, optional workflows (`run erp/crm maker checker`), org sync optional |
| [39-erpnext-help-tier-a.md](./39-erpnext-help-tier-a.md) | **ERPNext Tier A (Platform Help RAG)** — product how-to only; live books → COO / ERP agents |
| [40-twenty-crm-help-tier-a.md](./40-twenty-crm-help-tier-a.md) | **Twenty CRM Tier A (Platform Help RAG)** — product how-to only; live pipeline → COO / CRM agents |

**Video Tours (UI):** User menu → **Help → Video Tours** (/video-tours) — playlist of short CEO tours (script/captions now; mp4 when exported). Not ingested as RAG docs.

**Product name:** Flolah (Automate, Innovate, Elevate) — Agent OS underneath.

**Specialist agent:** Chat with **Platform Help** (`platformhelp`) for how-to, navigation, **Company setup**, **Scheduled goals**, **OEI / Home score** (**36**), **planned company P&L cost/income** (**37**, design roadmap), **content/social publish**, **Business Core CRM/ERP** (**32**, Maker/Checker **38**, ERPNext/Twenty Tier A **39–40** — docs only, no live books), workflow node questions, MCP/A2A/Connectors/API Keys, and light troubleshooting. **Answer-first policy:** Platform Help always explains from help RAG first; it may soft-recommend COO / CRM Maker / Workflow Builder for live data or execution, but never redirects with specialty-only “talk to X” replies. Backend hard peer-referral is **disabled** for `platformhelp`. For **structured first company shape**, use **Company setup** `/company-setup` (**29**). For **content_creator** operate (publish, community, weekly ops rollup), see **30**. For **Facebook / MCP OAuth Connect** setup (and other OAuth MCPs), see **31**. For **CRM/ERP + Maker/Checker**, see **32** + **38**. For **package IP firewall** see **33**; **external package tokens** **34**. For **mission/DNA after setup**, avatar **Update Company Details** (**35**). For freeform **strategic org chat** (departments/agents), use **Onboarding Helper** + `/onboarding` (**27**). For building or fixing graphs, prefer **Workflow Builder**. For day-to-day ops, delegation, **recurring goals**, **OEI**, and **CRM/ERP read-only status**, prefer the **COO**.
