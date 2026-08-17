---
title: Connectors and MCP
---

# Connectors and MCP

Two related ways to attach outside systems to your AI company.

## Connectors (Open Connector catalog)

Path: **Connectors** (`/connectors`).

Flolah uses **[Open Connector](https://openconnector.dev/#connectors)** as the SaaS integration layer. Through that catalog you can search and connect **about 1,300 apps** (GitHub, Slack, Gmail, Google Drive, Notion, Linear, HubSpot, Salesforce, Jira, Stripe, and many more), then call them from workflow **Connector** nodes and connector tools.

**Credit:** Connector coverage is provided by [Open Connector](https://openconnector.dev/#connectors) (open-source AI integration platform). Browse the live list of supported apps on that page. Flolah does not re-host their catalog copy — we search and connect it from **Connectors**.

Typical families in the catalog:

- **Code and work** — GitHub, GitLab, Jira, Linear, Asana, Figma
- **Communication** — Slack, Discord, Gmail, Intercom, Zendesk
- **Files** — Google Drive, Dropbox, Notion, Airtable
- **CRM and commerce** — HubSpot, Salesforce, Shopify, Stripe
- **Social** — LinkedIn, Facebook, X, YouTube, Reddit

Managed OAuth is available where Open Connector and your Flolah admin have configured it. Other apps use **your** API key or a no-auth public action.

### Connect an app

1. Open **Connectors**.
2. Provision the runtime token if the page asks (so workflows can call apps as you).
3. Search the catalog or pick a starter (for example GitHub, Gmail, Google Drive).
4. Complete **OAuth** in the browser, or paste an **API key** when the provider requires it.
5. Confirm the app under **Your connections**.

You can use the **platform** OAuth app, or optionally supply **your own** app id and secret for a provider (BYOA). Admin-managed provider apps may already exist; you still connect **your** account.

Disconnect from the same page when you no longer want workflows to use that app.

### Use in a workflow

1. Edit a workflow → add a **Connector** node.
2. Choose the **app** and **action**.
3. Bind inputs from prior steps.
4. Map outputs: `text` (readable) and `result` (JSON).

The CEO who **runs** the workflow must have that app connected.

IBKR and **Browser Session** packages also appear as connector-style downloads when those features are enabled. See [Browser Session](./browser-session.md) and [Optional packs](../operate/optional-packs.md).

## MCP

Path: **MCP** (and **Connectors → MCPs** for OAuth-style MCP servers such as Facebook / Meta).

MCP is a separate path from the Open Connector SaaS catalog: you register an MCP **server**, then call its tools from workflow **MCP** / Brain nodes.

1. Register or pick a server.
2. **Test**.
3. Use it from a workflow **MCP** / Brain node, or grant related tools to employees.

Platform CRM/ERP servers are provisioned when you enable Business Core — they are already scoped to **your** company.

Facebook Page OAuth for content ops is under **Connectors → MCPs**. After connect, publish and community workflows can run; ops rollups use the **bell**, not email.

Do not paste client secrets into chat. Rotate keys in Connectors or API Keys.

## Related

- Full Open Connector app list: [openconnector.dev/#connectors](https://openconnector.dev/#connectors)
- [Workflows](./workflows.md)
- [API keys](../setup/api-keys.md)
