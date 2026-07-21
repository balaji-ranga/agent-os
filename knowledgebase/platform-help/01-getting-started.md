# Getting started (CEO)

## What Flowlah is

Flowlah is your AI agent company: you (the CEO) chat with agents, run standups, track work on Kanban, store Master Data, build visual workflows, connect MCP servers, and publish or consume A2A agents.

## Register and log in

1. Open the Flowlah site → **Register** (new CEO) or **Log in**.
2. Registration provisions your tenant: standard agents (COO, specialists, Workflow Builder, Platform Help, …), org docs, starter **departments** Master Data table, and Platform Help documents for RAG.
3. After login you land on the **Dashboard** (org chart).

Admin accounts manage platform users; CEOs get the full product nav.

## First five minutes

1. Click **COO** (BalServe) on the Dashboard → Chat — introduce yourself and ask what agents you have.
2. Open the **bell** (top bar) — empty until agents notify you or standups produce updates.
3. Open **Profile** (avatar menu) — set name, MFA prefs, and AI model source if you use your own API key (BYOK).
4. Open **Master Data** — confirm **departments** and Platform Help documents exist.
5. Open **Workflows** or ask **Platform Help**: “How do I build a workflow?”

## Profile and AI model (BYOK)

Path: avatar → **Profile** (`/profile`).

- Update display name, email, region, mobile, password.
- **Model preference:** platform default, or your own OpenAI / OpenRouter (and similar) API key when offered.
- MFA settings as required by your org.

Agents still run through OpenClaw; your BYOK preference affects how the platform selects models for eligible paths.

## Multi-tenant isolation

Your standups, Kanban tasks, Master Data, workflows, and MCP registrations belong to **you**. Other CEOs cannot see them. Resync and agent workspaces are scoped to your tenant OpenClaw agents (`t-{you}--{agentId}`).
