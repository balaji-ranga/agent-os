# Local IBKR Bridge

Slim Node (ESM) HTTP service on the **laptop** that talks to IB Gateway / TWS and exposes a loopback JSON API for desktop workflow W2. Fill / equity / account / EOD events are pushed to a VPS workflow webhook.

Related: [IBKR-MONTHLY-TRADING-PLAN.md](../../knowledgebase/IBKR-MONTHLY-TRADING-PLAN.md), [IBKR-LOCAL-BRIDGE.md](../../knowledgebase/IBKR-LOCAL-BRIDGE.md), CEO help: [platform-help/20-ibkr-monthly-trading.md](../../knowledgebase/platform-help/20-ibkr-monthly-trading.md).

## Who owns the data?

Snapshots and events you push land under the **CEO owner of the W3 webhook workflow** (your Flolah login). They are **not merged with other users**. Cloud tables (`trading_day_plans`, `ibkr_account_snapshot_cache`, fills, equity marks, …) all key by `owner_user_id` for that CEO.

## Workflows that use this bridge

| | Goal | Outcome |
|---|------|---------|
| **W1** Post-Close Review & Plan | Plan next session using latest book + learnings | Day plan for W2 |
| **W2** Execute | At open, run approved plan through **this bridge** | Orders at Gateway + execution report |
| **W3** IBKR Events | Ingest webhooks from **this bridge** | Cache, fills, EOD → W1 |
| **W4** | Not used | — |
| **W5** Weekly Review | Journal / email only (no bridge orders) | Weekly digest |

CEO definitions + diagrams: [platform-help/20-ibkr-monthly-trading.md](../../knowledgebase/platform-help/20-ibkr-monthly-trading.md). Ops: [IBKR-MONTHLY-WORKFLOWS.md](../../knowledgebase/IBKR-MONTHLY-WORKFLOWS.md).

**IBKR Summary (cloud UI):** after pushes land on VPS, open `/ibkr-summary` for portfolio + plan vs executed. **Clear data…** removes transactional rows for that CEO only (not Variables).

## Install

From this folder (requires Node 18+). Parent `backend/npm install` must have been run so `@stoqey/ib` resolves for live Gateway calls:

```bash
cd backend
npm install
cd local-ibkr-bridge
npm install
```

## Configure

1. Copy `.env.example` → `.env`.
2. Set `LOCAL_BRIDGE_TOKEN` to a long random secret.
3. Prefer keeping `IBKR_*` in `backend/.env` (this package loads `../.env` then `./.env`).
4. Set `WEBHOOK_URL` + `WEBHOOK_SECRET` to the VPS W3 workflow hook when ready.

**Security**

- Binds **127.0.0.1** only by default (`BRIDGE_HOST`).
- All routes except `GET /health` require `Authorization: Bearer <LOCAL_BRIDGE_TOKEN>`.
- `NODE_ENV=production` requires a non-empty token. For smoke only: `BRIDGE_ALLOW_EPHEMERAL_TOKEN=1`.
- Never commit `.env` or `data/`.

## Run

```powershell
.\scripts\run-bridge.ps1
# or mock (no Gateway):
.\scripts\run-bridge.ps1 -Mock
# or:
npm start
```

Default URL: `http://127.0.0.1:3010`

### Offline test (no IBKR, no live orders)

```bash
npm run test:offline
# or
node scripts/test-bridge-offline.js
```

## Endpoints

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| GET | `/health` | no | `{ ok, paper, host, port, mock }` without IB connect |
| GET | `/ping` | yes | Gateway ping (or mock) |
| POST | `/account-snapshot` | yes | `fetchAccountSnapshot` + queue `account_snapshot` webhook |
| POST | `/place-bracket` | yes | body `{ trades: [...] }` — dry-run when `IBKR_TRADING_ENABLED` off |
| POST | `/map-day-plan` | yes | Map Maker day-plan / open-plans JSON → `{ trades, modify_stops, sells, skipped }` (no Gateway) |
| POST | `/execute-day-plan` | yes | Map + place-bracket + modify-stop + sell-to-close; **always** re-snapshot after session and push `account_snapshot` (orders may fail) |
| POST | `/sell-to-close` | yes | SELL_TO_CLOSE via place path |
| POST | `/modify-stop` | yes | Best-effort cancel+replace STP (IB has no reliable in-place amend) |
| POST | `/cancel` | yes | `{ order_id }` / `{ symbol }` / `{ all: true }` |
| GET | `/open-orders` | yes | Open orders from snapshot |
| POST | `/push-equity-mark` | yes | Snapshot → webhook `account_snapshot` + `equity_mark` |
| POST | `/push-eod-snapshot` | yes | Snapshot → webhook `account_snapshot` + `eod_snapshot` (W1 trigger) |
| POST | `/push-account-snapshot` | yes | Snapshot → webhook `account_snapshot` only |

Example:

```bash
curl -s http://127.0.0.1:3010/health
curl -s -H "Authorization: Bearer $LOCAL_BRIDGE_TOKEN" http://127.0.0.1:3010/ping
curl -s -X POST -H "Authorization: Bearer $LOCAL_BRIDGE_TOKEN" -H "Content-Type: application/json" \
  -d "{}" http://127.0.0.1:3010/account-snapshot
```

## Webhook events

POST to `WEBHOOK_URL` with header `x-workflow-hook-secret: WEBHOOK_SECRET`:

```json
{
  "event": "fill|reject|stop_out|equity_mark|eod_snapshot|account_snapshot|order_status",
  "ts": "ISO-8601",
  "source": "local-ibkr-bridge",
  "payload": {}
}
```

**Session book for VPS (W1):** After any successful Gateway snapshot (equity timer, EOD, local `/account-snapshot`, or end of `/execute-day-plan` regardless of order success), the bridge emits **`account_snapshot`**. W3 ingests into VPS cache; W1 reads `GET /api/ibkr-trading/account-snapshot/latest`.

Failed deliveries go to an in-memory queue and optional `data/webhook-retry.json` with exponential backoff. Logs are redacted (no secrets).

## Windows Task Scheduler

```powershell
# Run PowerShell as the user who will trade (IB Gateway session):
.\scripts\register-task-scheduler.ps1
```

Registers **AgentOsIbkrBridge** at logon. Keep IB Gateway running (paper **4002**). Equity marks use `EQUITY_MARK_INTERVAL_SEC` (default 300; `0` disables) and each mark also refreshes the VPS book cache via `account_snapshot`. Trigger EOD via `POST /push-eod-snapshot` from W2 or a separate daily task after US close.

## How W2 calls the bridge

Desktop workflow API nodes should target loopback only, for example:

- `http://127.0.0.1:3010/place-bracket`
- `http://127.0.0.1:3010/modify-stop`
- `http://127.0.0.1:3010/sell-to-close`
- `http://127.0.0.1:3010/push-eod-snapshot`
- `http://127.0.0.1:3010/push-account-snapshot` (force book push after a successful Gateway session)

Header: `Authorization: Bearer <LOCAL_BRIDGE_TOKEN>` (store token in desktop package secrets / local env — not in git).

Paper first: `IBKR_IS_PAPER=true`, `IBKR_TRADING_ENABLED=0` until dry-run validated.
