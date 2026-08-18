# Flolah public user guide (Docusaurus)

Open-access help for CEOs, published at **https://flolah.cloud/docs/** (also `/docs/` on the login host). No sign-in required.

This corpus is written for the public website. It does **not** include operator runbooks, internal hostnames, secrets, or vendor runtime names.

## Source vs in-app help

| Surface | Location | Audience |
|---------|----------|----------|
| **Public docs** (this folder) | Built into `deploy/static/flolah-home/docs/` | Anyone on the marketing / login sites |
| **In-app Platform Help** | `knowledgebase/platform-help/` (RAG) | Logged-in CEOs chatting with Platform Help |

Keep public pages sequenced: access → register → setup → run → operate.

**Org, departments, and people:** [Org and departments](./docs/setup/org-and-departments.md) · [People](./docs/setup/people.md) — Chart / Design / People, CEO Delegate vs Member.

**Connectors catalog:** the public [Connectors and MCP](./docs/systems/connectors-and-mcp.md) page credits **[Open Connector](https://github.com/oomol-lab/open-connector)** (~1,300 connectors; Apache-2.0; live list at [openconnector.dev/#connectors](https://openconnector.dev/#connectors)). Full stack attribution: repo [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) and [flolah.cloud/legal/open-source.html](https://flolah.cloud/legal/open-source.html).

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
