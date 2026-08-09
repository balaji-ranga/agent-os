# Browser Session — Desktop Local Mode

**Status:** Implemented as Connectors **Browser Session package** (owner-scoped local worker).

## Product summary

| Item | Behavior |
|------|----------|
| Download | **Connectors** → *Browser Session package (local worker)* (full or lite) |
| Auth | Per-download wk_… token stored hashed, bound to owner_user_id; optional **client IP whitelist** |
| Runtime | Long-lived Windows process; loopback :3020 for workflow APIs; outbound register/heartbeat/jobs |
| Agents | When worker **online**, rowse_* / recipe / autonomous open-snapshot-act run on the laptop; else managed OpenClaw |
| Isolation | Tokens and jobs never cross CEOs; loopback binds 127.0.0.1 |

## CEO setup

1. Connectors → Download Browser Session package (full recommended).
2. Unzip privately · keep .env secret.
3. `.\scripts\Start-BrowserWorker.ps1` (first run installs Playwright Chromium).
4. Leave running (or Task Scheduler script). Confirm **Online** on Connectors.
5. Optional: add public IP/CIDR whitelist.
6. Agents / Browser Session recipes run against your machine.

## Ops

- Tables: `browser_worker_tokens`, `browser_worker_ip_whitelist`, `browser_worker_nodes`, `browser_worker_jobs`
- APIs: `/api/integrations/browser-worker/*` (session), `/api/browser-worker/v1/*` (worker bearer)
- Env: `BROWSER_WORKER_OFFLINE_MS`, `BROWSER_WORKER_JOB_TIMEOUT_MS`
- Package source: `backend/local-browser-worker/`

See also: [CLIENT-BROWSER-SESSION.md](./CLIENT-BROWSER-SESSION.md), Connectors UI.