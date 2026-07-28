# Local IBKR Bridge

Slim Node (ESM) HTTP service on the **laptop** that talks to IB Gateway / TWS and exposes a loopback JSON API for desktop workflow W2. Fill / equity / EOD events are pushed to a VPS workflow webhook.

Related: [IBKR-MONTHLY-TRADING-PLAN.md](../knowledgebase/IBKR-MONTHLY-TRADING-PLAN.md) (Phase 2), [IBKR-LOCAL-BRIDGE.md](../knowledgebase/IBKR-LOCAL-BRIDGE.md).

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
| POST | `/account-snapshot` | yes | `fetchAccountSnapshot` |
| POST | `/place-bracket` | yes | body `{ trades: [...] }` — dry-run when `IBKR_TRADING_ENABLED` off |
| POST | `/sell-to-close` | yes | SELL_TO_CLOSE via place path |
| POST | `/modify-stop` | yes | Best-effort cancel+replace STP (IB has no reliable in-place amend) |
| POST | `/cancel` | yes | `{ order_id }` / `{ symbol }` / `{ all: true }` |
| GET | `/open-orders` | yes | Open orders from snapshot |
| POST | `/push-equity-mark` | yes | Snapshot → webhook `equity_mark` |
| POST | `/push-eod-snapshot` | yes | Snapshot → webhook `eod_snapshot` (W1 trigger later) |

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
  "event": "fill|reject|stop_out|equity_mark|eod_snapshot|order_status",
  "ts": "ISO-8601",
  "source": "local-ibkr-bridge",
  "payload": {}
}
```

Failed deliveries go to an in-memory queue and optional `data/webhook-retry.json` with exponential backoff. Logs are redacted (no secrets).

## Windows Task Scheduler

```powershell
# Run PowerShell as the user who will trade (IB Gateway session):
.\scripts\register-task-scheduler.ps1
```

Registers **AgentOsIbkrBridge** at logon. Keep IB Gateway running (paper **4002**). Equity marks use `EQUITY_MARK_INTERVAL_SEC` (default 300; `0` disables). Trigger EOD via `POST /push-eod-snapshot` from W2 or a separate daily task after US close.

## How W2 calls the bridge

Desktop workflow API nodes should target loopback only, for example:

- `http://127.0.0.1:3010/place-bracket`
- `http://127.0.0.1:3010/modify-stop`
- `http://127.0.0.1:3010/sell-to-close`
- `http://127.0.0.1:3010/push-eod-snapshot`

Header: `Authorization: Bearer <LOCAL_BRIDGE_TOKEN>` (store token in desktop package secrets / local env — not in git).

Paper first: `IBKR_IS_PAPER=true`, `IBKR_TRADING_ENABLED=0` until dry-run validated.
