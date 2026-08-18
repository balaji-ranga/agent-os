# Flolah — AI Company OS

**Flolah** (Automate, Innovate, Elevate) is an open-source **AI Company OS**: hire **AI employees**, give them roles and tools, store company knowledge, and run the company with chat, Kanban, workflows, and connectors.

- **Hosted:** [https://flolah.cloud](https://flolah.cloud) · sign in [https://login.flolah.cloud](https://login.flolah.cloud)
- **User guide (no login):** [https://flolah.cloud/docs/](https://flolah.cloud/docs/)
- **Source:** [github.com/balaji-ranga/agent-os](https://github.com/balaji-ranga/agent-os)

You do not need APIs or Docker for everyday use as a CEO. Public walkthrough: [Welcome](https://flolah.cloud/docs/start/welcome/).

## License

Flolah application code is **[Apache License 2.0](./LICENSE)**. Copyright 2026 Balaji Ranganathan. See [`NOTICE`](./NOTICE).

Third-party and optional sidecars (OpenSearch, Open Connector, optional Twenty/ERPNext, and others) keep **their own** licenses — [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) and [open-source notices](https://flolah.cloud/legal/open-source.html).

## Docs in this repo

| Doc | What it is |
|-----|------------|
| **[knowledgebase/PROJECT.md](knowledgebase/PROJECT.md)** | Full product map, API, database scripts, and repo layout (moved here from this README) |
| **[docs-site/](docs-site/README.md)** | Public Docusaurus user guide (`/docs/`) |
| **[knowledgebase/platform-help/](knowledgebase/platform-help/README.md)** | In-app Platform Help (RAG) |
| **[knowledgebase/AI-COMPANY-OS.md](knowledgebase/AI-COMPANY-OS.md)** | Messaging and OS primitives |
| **[knowledgebase/README.md](knowledgebase/README.md)** | Index of all knowledgebase files |
| **[deploy/README.md](deploy/README.md)** | Docker Compose / VPS deploy |

## Quick start (operators)

Self-host from [`deploy/`](deploy/README.md) (Compose, env examples, VPS scripts). CEO how-to stays on `/docs/` and Platform Help — do not treat this landing page as the operator runbook.

```
backend/   API
frontend/   CEO app
docs-site/  Public /docs
knowledgebase/  Product + ops docs
deploy/     Compose, nginx, scripts
```
