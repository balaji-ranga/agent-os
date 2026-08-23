# Getting started (CEO)

## What Flolah is

Flolah is the **AI Company OS**: you (the CEO) hire **AI employees** (digital workers), chat with them, run standups, track work on Kanban, store **company knowledge** (Master Data), build visual workflows, connect MCP servers and SaaS **Connectors**, and publish or consume A2A services (Public or Secured with OAuth client credentials). Product messaging and primitives: [`AI-COMPANY-OS.md`](../AI-COMPANY-OS.md).

## Register and log in

1. Open the Flolah site → **Register** (new CEO) or **Log in**. Public how-to (no login): [https://flolah.cloud/docs/](https://flolah.cloud/docs/).
2. Registration provisions your tenant: standard AI employees (COO, specialists, Workflow Builder, Platform Help, …), org docs, starter **departments** knowledge table, and Platform Help documents for RAG. Choose **country + region** from ISO 3166 dropdowns (not free text) and **LLM provider + default chat model** on the same form as Profile (Platform default, OpenAI, OpenRouter, Ollama free, DeepSeek local). API keys are **not** collected at register — after login set **`Platform_BYOK`** under **API Keys** if you chose OpenAI/OpenRouter.
3. **Legal:** self-serve **Register** requires accepting **Terms of Service** and **Privacy Policy** (checkbox). Versions are stored with your account (`terms_version` / `privacy_version` / `terms_accepted_at`). Read the text at `/legal/terms.html`, `/legal/privacy.html` (also marketing host and Login footers). Cookie inventory and **open-source notices** (Node.js, Docker, OpenSearch, Open Connector, and others): `/legal/cookies.html`, `/legal/open-source.html`, `/legal/THIRD_PARTY_NOTICES.md`. Admins creating users may skip accept.
4. After login you may land on **Company setup** (`/company-setup`) if the first-run gate is still open — complete the wizard or skip, then use **home chat** / **My Org**. You can reopen setup anytime from the avatar menu → **Company setup**. Guide: [29-company-setup.md](./29-company-setup.md).

Admin accounts manage platform users; CEOs get the full product nav. Invited **employees** (sub-users) log in at the same page, inherit the CEO company, and see a permission-filtered nav (always: Home, Kanban, Profile). Help **45**.

### MFA (multi-factor)

Your org may **require** MFA or leave it optional (**inherit** platform default).

1. On first login (when required), complete **EMAIL** (OTP to your address) or **TOTP** (authenticator app) as offered.
2. **TOTP first enrollment:** the screen shows a **QR code** and the **security key**. Scan the QR with Google Authenticator, Authy, Microsoft Authenticator, or 1Password — or type the security key manually — then enter the 6-digit code. Store the security key somewhere safe.
3. Complete the code challenge; use **resend** if the email OTP is delayed.
4. Later: **Profile** → MFA settings (enable/disable when policy allows).

## First five minutes

1. If redirected to **Company setup** (`/company-setup`), complete or skip the wizard (avatar → **Company setup** anytime after). For pipeline work pick **Revenue Company**. Guide: [29-company-setup.md](./29-company-setup.md).
2. Chat with the **COO** — **tell the COO the outcome first** (what success looks like, deadline, spend cap, what must not happen). Do not open Workflow Builder until you inspect a step on the Goal Plan. Expand **How your company runs** above the Home dashboard if the org picture is unclear (help **49**).
3. Open the **bell** (top bar) — empty until the team notifies you or standups produce updates.
4. Open **Profile** (avatar menu) — set name and MFA prefs. For OpenAI/OpenRouter BYOK, open **Settings → API Keys**, edit the seeded **`Platform_BYOK`** slot, then on Profile choose **provider + chat model** (do not paste keys on Profile).
5. Open **Knowledge** (Master Data) — confirm **departments** and Platform Help documents exist. Optionally open **Content Explorer** to browse uploads and generated media.
6. Ask **Platform Help**: "How do scheduled goals work?", "What is Company setup?" Open **Workflows** only after the COO has a plan you want to inspect.
7. Open **Kanban** (`/kanban`) — defaults to **Weekly**. Use **Agent** filter and card checkboxes / **Select all**; task drawer shows **Task ID**. Top-bar **Search (Ctrl+K)** finds tasks and **workflow run ids**.
8. Optional — avatar menu → **Onboarding**, or chat **Onboarding Helper**, for freeform departments/AI employees (selective Review + Apply). Prompt recipes: [27-onboarding-helper.md](./27-onboarding-helper.md).
9. Optional — multi-user browser / social logins: **Connectors → Browser Session package**, start the Windows worker headed, confirm **Online**. Tokens & IP: **Settings → Tokens management** / **IP Whitelists**. Guide: [22-browser-session-and-recipes.md](./22-browser-session-and-recipes.md).
10. Optional — ask the COO to **schedule a lasting goal** (“every weekday at 9…” / “every hour check…”), **edit** it later, or open **Management → Scheduled goals** (**Generate plan → Amend plan manually**). Guide: [28-scheduled-goals.md](./28-scheduled-goals.md). Example outcome (verified CRM, spend cap): [48-pipeline-under-constraints.md](./48-pipeline-under-constraints.md).

## Profile and AI model (BYOK)

Path: avatar → **Profile** (`/profile`). Same **provider + default model** picks appear on **Register**.

- Update display name, email, **country + region (ISO 3166 dropdowns)**, mobile, password, MFA.
- **Model preference:**
  - **Platform default** — uses the admin-selected platform LLM (no personal key). Ops `.env` covers Brave Search and Replicate video.
  - **Ollama free / DeepSeek (local)** — no LLM key. Pick a chat model at Register/Profile. Non-platform Profiles seed vault slots (`Platform_BYOK`, `Replicate_BYOK`, `BRAVE_SEARCH_BYOK`, `elevenlabs-key`) as **unset** — Edit under **API Keys** when needed.
  - **OpenAI / OpenRouter** — pick **provider** and a curated (or custom) **chat model** at Register or Profile. Then fill vault key **`Platform_BYOK`** under **API Keys** so AI employees can call the API. Endpoints come from `GET /api/auth/llm-catalog` — you do not paste base URLs or keys on Register.
  - **Efficiency mode** (Yes/No, default No) — **Yes** routes short jobs (learnings summary, chat archive titles, Brain / IBKR recaps, broadcast/COO classify, leftover goal-plan args, policy/goal enrich) to local Ollama instead of `Platform_BYOK`. Agent Chat / Builder / certify / browser / vision / image/video stay on the Profile provider. Requires the Ollama service. **No** = existing behaviour.
- **Workflow Brain:** for DeepSeek or OpenRouter nodes you can set **Thinking mode** (and effort) in the node attributes — see [07-workflow-nodes-reference](./07-workflow-nodes-reference.md).

Full vault guide: [15-api-keys-vault.md](./15-api-keys-vault.md). Optional **Tools → Model** / **Tools → Rate limits** on `/content-tools` (help **11**). Browse uploads/generated media: [26-content-explorer.md](./26-content-explorer.md).

AI employees still run through AgentSystem; your BYOK preference affects how the platform selects models for eligible paths.

## Multi-tenant isolation

Your standups, Kanban tasks, Knowledge, **scheduled goals**, workflows, API Keys, Connectors, and MCP registrations belong to **you**. Other CEOs cannot see them. Resync and employee workspaces are scoped to your tenant (`t-{you}--{agentId}`).
