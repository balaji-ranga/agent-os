---
title: Connectors and MCP
---

# Connectors and MCP

Two related ways to attach outside systems.

## Connectors

Path: **Connectors**.

Link SaaS apps (OAuth, API key, or no-auth) for **Connector** nodes in workflows. You can use the platform app, or optionally supply **your own** app id and secret for a provider.

Admin-managed provider apps may already exist; CEOs still connect **their** account.

IBKR and **Browser Session** packages also appear as connector-style downloads when those features are enabled. See [Browser Session](./browser-session.md) and [Optional packs](../operate/optional-packs.md).

## MCP

Path: **MCP** (and **Connectors → MCPs** for OAuth-style MCP servers such as Facebook / Meta).

1. Register or pick a server.
2. **Test**.
3. Use it from a workflow **MCP** / Brain node, or grant related tools to employees.

Platform CRM/ERP servers are provisioned when you enable Business Core — they are already scoped to **your** company.

Facebook Page OAuth for content ops is under **Connectors → MCPs**. After connect, publish and community workflows can run; ops rollups use the **bell**, not email.

Do not paste client secrets into chat. Rotate keys in Connectors or API Keys.
