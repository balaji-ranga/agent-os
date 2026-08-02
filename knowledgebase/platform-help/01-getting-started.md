# Getting started (CEO)

## What Flolah is

Flolah is your AI agent company: you (the CEO) chat with agents, run standups, track work on Kanban, store Master Data, build visual workflows, connect MCP servers and SaaS **Connectors**, and publish or consume A2A agents (Public or Secured with OAuth client credentials).

## Register and log in

1. Open the Flolah site → **Register** (new CEO) or **Log in**.
2. Registration provisions your tenant: standard agents (COO, specialists, Workflow Builder, Platform Help, …), org docs, starter **departments** Master Data table, and Platform Help documents for RAG.
3. After login you land on the **Dashboard** (org chart).

Admin accounts manage platform users; CEOs get the full product nav.

### MFA (multi-factor)

Your org may **require** MFA or leave it optional (**inherit** platform default).

1. On first login (when required), choose **EMAIL** (OTP to your address) or **TOTP** (authenticator app) as offered.
2. Complete the code challenge; use **resend** if the email OTP is delayed.
3. Later: **Profile** → MFA settings (enable/disable when policy allows).

## First five minutes

1. Click **COO** on the Dashboard → Chat — introduce yourself and ask what agents you have.
2. Open the **bell** (top bar) — empty until agents notify you or standups produce updates.
3. Open **Profile** (avatar menu) — set name and MFA prefs. For OpenAI/OpenRouter BYOK, open **Management → API Keys**, edit the seeded **`Platform_BYOK`** slot, then on Profile choose **provider + chat model** (do not paste keys on Profile).
4. Open **Master Data** — confirm **departments** and Platform Help documents exist. Optionally open **Content Explorer** to browse uploads and generated media.
5. Open **Workflows** or ask **Platform Help**: “How do I build a workflow?”
6. Optional — avatar menu → **Onboarding**, or chat **Onboarding Helper**, to propose departments/agents (selective Review + Apply). Prompt recipes: [27-onboarding-helper.md](./27-onboarding-helper.md).

## Profile and AI model (BYOK)

Path: avatar → **Profile** (`/profile`).

- Update display name, email, region, mobile, password, MFA.
- **Model preference:**
  - **Platform default** — uses the admin-selected platform LLM (no personal key). Ops `.env` covers Brave Search and Replicate video.
  - **Ollama free / DeepSeek (local)** — no LLM key. Optionally pick an Ollama chat model at Register/Profile. The platform seeds vault slots (`Platform_BYOK`, `Replicate_BYOK`, `BRAVE_SEARCH_BYOK`, `elevenlabs-key`) as **unset** — Edit under **API Keys** when you need those features.
  - **OpenAI / OpenRouter** — fill vault key **`Platform_BYOK`** under **API Keys** first, then on Profile select the **provider** and a **chat model** from the curated list (or a custom model id). Saving syncs that pair into OpenClaw for your tenant agents. Endpoints come from the platform catalog (`GET /api/auth/llm-catalog`) — you do not paste base URLs.
- **Workflow Brain:** for DeepSeek or OpenRouter nodes you can set **Thinking mode** (and effort) in the node attributes — see [07-workflow-nodes-reference](./07-workflow-nodes-reference.md).

Full vault guide: [15-api-keys-vault.md](./15-api-keys-vault.md). Browse uploads/generated media: [26-content-explorer.md](./26-content-explorer.md).

Agents still run through OpenClaw; your BYOK preference affects how the platform selects models for eligible paths.

## Multi-tenant isolation

Your standups, Kanban tasks, Master Data, workflows, API Keys, Connectors, and MCP registrations belong to **you**. Other CEOs cannot see them. Resync and agent workspaces are scoped to your tenant OpenClaw agents (`t-{you}--{agentId}`).
