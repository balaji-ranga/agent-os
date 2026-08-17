# Flolah public user guide (Docusaurus)

Open-access help for CEOs, published at **https://flolah.cloud/docs/** (also `/docs/` on the login host). No sign-in required.

This corpus is written for the public website. It does **not** include operator runbooks, internal hostnames, secrets, or vendor runtime names.

## Source vs in-app help

| Surface | Location | Audience |
|---------|----------|----------|
| **Public docs** (this folder) | Built into `deploy/static/flolah-home/docs/` | Anyone on the marketing / login sites |
| **In-app Platform Help** | `knowledgebase/platform-help/` (RAG) | Logged-in CEOs chatting with Platform Help |

Keep public pages sequenced: access → register → setup → run → operate.

**Connectors:** public [Connectors and MCP](./docs/systems/connectors-and-mcp.md) documents the **~1,300** SaaS apps available through [Open Connector](https://openconnector.dev/#connectors) (credit and live catalog on that site). In-app copy: `knowledgebase/platform-help/16-connectors-openconnector.md`.

## Build

From the repo root:

```bash
bash deploy/scripts/build-public-docs.sh
```

Or locally:

```bash
cd docs-site
npm ci
npm run build
```

Output: `docs-site/build/` copied to `deploy/static/flolah-home/docs/`.
