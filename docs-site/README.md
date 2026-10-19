# Flolah public user guide (Docusaurus)

Open-access help for CEOs, published at **https://flolah.cloud/docs/** (also `/docs/` on the login host). No sign-in required.

Public **blog + forum** (same Docusaurus package, second build): **https://flolah.cloud/blog/** and **https://flolah.cloud/blog/forum/**. Posts live in `blog/` (dated markdown). The forum hub is `blog-pages/forum.md` and sends discussion to [GitHub Discussions](https://github.com/balaji-ranga/agent-os/discussions).

To publish a post: add `docs-site/blog/YYYY-MM-DD-slug.md` with `title`, `authors: [flolah]`, `tags`, and a `<!-- truncate -->` after the teaser, then deploy.

This corpus is written for the public website. It does **not** include operator runbooks, internal hostnames, secrets, or vendor runtime names.

## Source vs in-app help

| Surface | Location | Audience |
|---------|----------|----------|
| **Public docs** (this folder) | Built into `deploy/static/flolah-home/docs/` | Anyone on the marketing / login sites |
| **In-app Platform Help** | Curated `knowledgebase/platform-help/` plus every sensitivity-scanned page in `docs-site/docs/` (one platform RAG index) | Logged-in CEOs chatting with Platform Help |

Keep public pages sequenced: access → register → setup → run → operate.

**Org, departments, and people:** [Org and departments](./docs/setup/org-and-departments.md) · [People](./docs/setup/people.md) — Chart / Design / People, CEO Delegate vs Member.

**Architecture (CEO):** [How the company runs](./docs/start/how-the-company-runs.mdx) — operating model (You → COO → specialists) and capability layers. Same diagrams sit above the Home dashboard and at the top of My Org.

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
npm run build:blog
```

Output: `docs-site/build/` copied to `deploy/static/flolah-home/docs/`, and `docs-site/build-blog/` copied to `deploy/static/flolah-home/blog/`.

## Copilot guides and publication

The public guide now includes [Platform Help](./docs/run/platform-help-copilot.md), [Digital Adoption websites](./docs/systems/digital-adoption.md) and [website copilot workflow connectors](./docs/systems/copilot-workflows.md). The workflow guide distinguishes a saved target-group ID, one-use link-code expiry, group lifetime, optional peer pairing, Action Policies and native Save verification. Curated in-app counterparts are `61`–`65` under `knowledgebase/platform-help/`.

Validate the help catalog with `node backend/scripts/check-platform-help-corpus.mjs`, scan public content with `node backend/scripts/scan-public-docs-sensitive.js`, then build this site. Both the public guide sources and curated corpus must ship in the backend image and be reindexed for Platform Help to retrieve the changes. Generated public output remains ignored; source and lockfiles are authoritative. Use the documentation-only release procedure in `deploy/README.md` when no application-code rollout is needed.
