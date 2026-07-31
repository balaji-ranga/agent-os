# Flolah Platform Help — Index

**Audience:** CEOs (end users) and the **Platform Help** agent.  
**Consumption:** Uploaded into each CEO’s **Master Data → Documents** and searched with `master_data_rag` (keyword chunk RAG). Do not paste this entire tree into an agent’s SOUL.

| Doc | Topics |
|-----|--------|
| [01-getting-started.md](./01-getting-started.md) | Register, login, MFA, Profile / BYOK via **API Keys** |
| [02-navigation-and-chrome.md](./02-navigation-and-chrome.md) | Left nav map (API Keys, Efficiency, Connectors), bell, profile, Admin **Crons** / **A2A logs** |
| [03-dashboard-agents-chat.md](./03-dashboard-agents-chat.md) | Org chart, chat, workspace MD, **templates** Apply/Publish, tools access, Resync |
| [04-kanban-standups-broadcast.md](./04-kanban-standups-broadcast.md) | Kanban (agent-owned status), standups → COO, Broadcast, `notify_ceo` when/when-not |
| [05-master-data-rag.md](./05-master-data-rag.md) | Tables, CSV, documents, RAG; **Purge all uploads**; protected Help/User Guide docs |
| [06-workflows-building.md](./06-workflows-building.md) | Create / edit / publish / run workflows, I/O mapping, templates |
| [07-workflow-nodes-reference.md](./07-workflow-nodes-reference.md) | Every node type incl. **Connector**; attributes, inputs, outputs |
| [08-mcp-integrations.md](./08-mcp-integrations.md) | Register MCP, test, use in workflows / Brain (vs Connectors) |
| [09-a2a-agent-exchange.md](./09-a2a-agent-exchange.md) | External agents, Publish A2A (sync/async, callback, deny_all/whitelist), AgentExchange **Test agent**, Admin **A2A invocation logs**, mock callback inbox |
| [10-policies-guardrails.md](./10-policies-guardrails.md) | CEO common guardrails for all agents + Brain nodes |
| [10-job-applicant-pipeline.md](./10-job-applicant-pipeline.md) | Job profiles & prebuilt job workflows |
| [11-content-tools-scripts-profile.md](./11-content-tools-scripts-profile.md) | **Tools** UI (`/content-tools`), AGENT-OS-OPS, **summary caches** (`learnings_summary`, `brain_history`), scripts, AI Snipper, Efficiency View (**Org / Department / Agent View**, Reset usage), Profile |
| [12-troubleshooting.md](./12-troubleshooting.md) | Common issues (A2A deny_all 403, notify, Kanban, API Keys, Connectors, **scheduled job didn't run**, storage/purge, department budget) |
| [13-workflow-autonomous-certify.md](./13-workflow-autonomous-certify.md) | Maker/Checker certify jobs, status-on-request, resume inputs |
| [14-workflow-dynamic-values.md](./14-workflow-dynamic-values.md) | `{{…}}` templates, variables, trigger input, **vault** auth |
| [15-api-keys-vault.md](./15-api-keys-vault.md) | **API Keys** vault, `Platform_BYOK`, workflow/MCP/Connector secrets |
| [16-connectors-openconnector.md](./16-connectors-openconnector.md) | **Connectors** SaaS apps + workflow Connector node + **Download local IBKR bridge** |
| [17-desktop-windows-download.md](./17-desktop-windows-download.md) | **Download for Windows** — local orchestrator, tokens, IP whitelist (W2 execute) |
| [18-agent-budgets-and-org-members.md](./18-agent-budgets-and-org-members.md) | Department purpose/budget, **agent token + error budgets** (warn-then-block), **Efficiency → Agent View**, external/A2A agents as org leaf members |
| [19-scheduled-jobs-and-crons.md](./19-scheduled-jobs-and-crons.md) | Platform crons vs your own schedules, **COO status checker** (daily report + HTML email), **data retention** purge, Storage (MB) |
| [20-ibkr-monthly-trading.md](./20-ibkr-monthly-trading.md) | **IBKR Monthly Positive Return**: W1–W5, Variables (`daily_budget_usd`), Connectors bridge download, learnings from cancels/fills |
| [21-external-tools-and-apis.md](./21-external-tools-and-apis.md) | **External tools & APIs** needing keys: DeepSeek, OpenAI, Claude, OpenRouter, Brevo SMTP, Brave, FMP, Replicate, ElevenLabs, Hunyuan3D, IBKR, Connectors |
| [22-browser-session-and-recipes.md](./22-browser-session-and-recipes.md) | **Browser Session**, Client Chrome relay, `browse_*` tools, recipes list/run, tool access, chat thumbs → learnings |
| [23-avatars-virtual-room.md](./23-avatars-virtual-room.md) | **3D Avatars**, Virtual Rooms, scenes, @mention routing, media overlays, ElevenLabs TTS/STT, optional Hunyuan3D |
| [24-agent-channels.md](./24-agent-channels.md) | **Slack / WhatsApp** per-CEO BYOK wizard, vault tokens, OpenClaw bindings |
| [25-speech-and-published-scenes.md](./25-speech-and-published-scenes.md) | **Published Scenes** public `/p/vr/:slug`, free Whisper STT + Piper TTS, `speech_stt` / `speech_tts` nodes |

**Product name:** Flolah (Automate, Innovate, Elevate) — Agent OS underneath.

**Specialist agent:** Chat with **Platform Help** (`platformhelp`) for how-to, navigation, workflow node questions, MCP/A2A/Connectors/API Keys onboarding, and light troubleshooting. For building or fixing graphs, prefer **Workflow Builder**. For day-to-day ops and delegation, prefer the **COO**.
