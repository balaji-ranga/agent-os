# Download for Windows (desktop workflow package)

Run a **published** Flolah workflow from a Windows laptop or desktop. Graph orchestration runs **locally**; run/step state and most node work stay on Flolah. Use this when you need **local** loopback APIs (e.g. IBKR gateway on `127.0.0.1`) or **local filesystem** paths, while Brain / Connectors / remote APIs still execute on the service.

## What you get

From the workflow editor (workflow must be **Published**):

1. Click **Download for Windows**.
2. Choose package type:
   - **Without Node runtime (lite)** — small zip (~tens of KB). Requires Node.js 18+ already on PATH.
   - **With Node 18 runtime (recommended)** — ~27 MB zip including portable `runtime\node.exe`. No system Node install.
3. Click **Review & download…**, read the contents list, then **Confirm & download**.

Each confirmed download **mints a new desktop token** and writes it into `workflow.params.json` inside the zip (secret is not shown again in the UI).

### Zip contents (typical)

| Path | Role |
|------|------|
| `Run-Workflow.ps1` | Launcher (prefers bundled Node) |
| `workflow.params.json` | Graph, `base_url` / `desktop_api_base`, `desktop_token`, `token_id` |
| `runner/` | Local orchestrator (no npm dependencies) |
| `runtime/node.exe` | Only if you chose **with runtime** |
| `README-DESKTOP.txt` | Short run notes |
| `logs/` | Created on first run (secrets redacted) |

## How to run on the laptop

1. Unzip the package to a folder you control (keep it private — it contains a Bearer token).
2. Open PowerShell in that folder:

```powershell
.\Run-Workflow.ps1
.\Run-Workflow.ps1 -InputText "optional trigger text"
.\Run-Workflow.ps1 -InputJson '{"key":"value"}'
```

3. Watch console output and `logs\run-*.log`. Runs also appear under **Workflows → runs** on Flolah (`trigger: desktop`).

Calls go to HTTPS Flolah (`/api/agent-workflows/desktop/v1/...`) via nginx, same as the UI — auth is the desktop token, not your browser session.

## What runs where

| On the Windows machine | On Flolah (service) |
|------------------------|---------------------|
| Graph walk (IF / While / Parallel / Merge / End) | Run + step **state** persistence |
| **API** node when URL is `localhost` / `127.*` | **API** node for remote URLs |
| **Filesystem** node (local paths) | Brain, Tool, Email, Connector, MCP, custom script, masterdata, external agent, … |
| | (Agent / CEO Approval / SSE listen / sub-workflow: not supported in desktop packages yet) |

**Triggers on desktop:** manual (you run the PS1) or **your** Windows Task Scheduler. Flolah schedule / chat / webhook triggers still use the **server** runner.

## Security

### Desktop token (`desktop_token` vs `token_id`)

| Field in `workflow.params.json` | Meaning |
|----------------------------------|---------|
| **`desktop_token`** | Secret `dsk_…` — sent as `Authorization: Bearer …`. This is what authenticates the package. |
| **`token_id`** | UUID of the token row — for matching the UI **Revoke** list. Not used as the Bearer secret. |

UI **Desktop tokens** list shows a **prefix** only + **Revoke**. Full secret lives only in the zip.

- Many downloads ⇒ many tokens (many PCs can run the same workflow).
- **Revoke** a row to cut that package’s access immediately.
- To re-issue: download again (new token) and revoke the old one if needed.

### IP whitelist

Optional extra lock in the same modal (and under **Settings → IP Whitelists**):

| Setting | Effect |
|---------|--------|
| **No entries** for desktop | Any client IP allowed (token still required) |
| Default add | Rule applies to **this workflow** only |
| Check **All my workflows** | Rule applies **owner-wide** |

All IP rules are stored in one owner-scoped table (`owner_ip_whitelists`). Federated UIs and **Settings → IP Whitelists** read/write the same store — pick the **Workflow download** target on the central page.

Flolah reads the caller IP from the connection (`X-Forwarded-For` / socket) — the PS1 does **not** send IP in the body.

## vs Export JSON / Publish A2A / Run

| Feature | Purpose |
|---------|---------|
| **Export JSON** | Share/backup definition only — does not run on Windows |
| **Run** (editor) | Full server-side orchestration |
| **Publish A2A** | Expose workflow on AgentExchange for other agents |
| **Download for Windows** | Local orchestrator package + remote state / remote nodes |

## Related

- Building workflows: [06-workflows-building.md](./06-workflows-building.md)
- Nodes: [07-workflow-nodes-reference.md](./07-workflow-nodes-reference.md)
- A2A: [09-a2a-agent-exchange.md](./09-a2a-agent-exchange.md)
- Connectors + **IBKR bridge zip**: [16-connectors-openconnector.md](./16-connectors-openconnector.md)
- **IBKR Monthly trading (W2 on laptop)**: [20-ibkr-monthly-trading.md](./20-ibkr-monthly-trading.md)
- Troubleshooting: [12-troubleshooting.md](./12-troubleshooting.md)


## Related packages

- **Browser Session** local worker (multi-user Client Chrome): [22-browser-session-and-recipes.md](./22-browser-session-and-recipes.md)
- Central IP + tokens: [33-ip-whitelists.md](./33-ip-whitelists.md), [34-tokens-management.md](./34-tokens-management.md)
