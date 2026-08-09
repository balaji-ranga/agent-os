# IBKR Local Bridge (laptop)

Phase 2 of the [Monthly Positive Return plan](IBKR-MONTHLY-TRADING-PLAN.md): a loopback HTTP service on the trading laptop that wraps `backend/src/services/ibkr-gateway-client.js` and pushes fill / equity / **account snapshot** events to the VPS.

**CEO end-user guide (prerequisites, setup, run/monitor, VPS deploy, privacy):** [platform-help/20-ibkr-monthly-trading.md](platform-help/20-ibkr-monthly-trading.md).
**Summary UI** reads execution order ids from flat `order_ids` or nested/stringified W2 `execute` / `place_bracket.results` so day-row ORDERS match laptop brackets.

**Data isolation:** webhook events update **only the CEO** who owns the W3 workflow (session / workflow owner). IBKR cloud tables are keyed by `owner_user_id` — not shared across users.

**Workflow roles (W1–W5):** W1 plans (cloud) · W2 executes (laptop → this bridge) · W3 ingests events · **W4 unused** · W5 weekly email. Full names/goals/outcomes: [platform-help/20-ibkr-monthly-trading.md](platform-help/20-ibkr-monthly-trading.md), [IBKR-MONTHLY-WORKFLOWS.md](IBKR-MONTHLY-WORKFLOWS.md).

**Cloud UI:** [IBKR Summary](platform-help/20-ibkr-monthly-trading.md#ibkr-summary-page-ibkr-summary) (`/ibkr-summary`) shows plan vs executed and can **clear transactional** data without wiping budget Variables.

**Download (recommended):** CEO or admin → **Connectors** → **Local IBKR bridge** → **Download local IBKR bridge** (Windows zip with optional portable Node; mints `LOCAL_BRIDGE_TOKEN` into `.env`). Lite download omits Node. Paste the same token into W2 variable `local_bridge_token`.

**API:** `GET /api/integrations/ibkr-bridge/package?include_runtime=0|1` (CEO/admin session).

**Package source:** `backend/local-ibkr-bridge/` — see that folder’s [README](../backend/local-ibkr-bridge/README.md) for install, env, Task Scheduler, and W2 URL examples.

## Role in the architecture

| Component | Where | Role |
|-----------|--------|------|
| IB Gateway / TWS | Laptop | Socket API (paper 4002) |
| **local-ibkr-bridge** | Laptop `127.0.0.1:3010` | Auth’d JSON API + webhook pusher |
| W2 Execution | Laptop desktop package | Calls bridge at market open |
| W3 Event Handler | VPS webhook | Receives `account_snapshot` / `fill` / `equity_mark` / `eod_snapshot` into that CEO’s private tables |

## Simple end-to-end (ops)

```mermaid
flowchart LR
  GW[IB Gateway] --> Bridge[Local bridge]
  Bridge -->|WEBHOOK account_snapshot fill eod| W3[W3 owner-scoped]
  W3 --> Cache[That CEO cache + learnings]
  Cache --> W1[W1 plan]
  W1 --> Plan[That CEO day plan]
  Plan --> W2[W2 laptop]
  W2 --> Bridge
```

## Auth and bind

- Bind: `BRIDGE_HOST=127.0.0.1` (non-loopback blocked unless `BRIDGE_ALLOW_NON_LOOPBACK=1`).
- Bearer: `LOCAL_BRIDGE_TOKEN` on every route except `GET /health`.
- Reuses `IBKR_*` from `backend/.env`.

### Cloud IP whitelist (optional)

When the bridge POSTs to Flolah (`WEBHOOK_URL` → `/api/ibkr-trading/local-bridge-webhook`), the VPS may enforce an **owner IP whitelist** in addition to `WEBHOOK_SECRET`:

| Setting | Effect |
|---------|--------|
| **No IBKR-bridge rules** | Any client IP accepted (secret still required) |
| One or more rules | Client IP (or IPv4 CIDR) must match |

Manage under **Settings → IP Whitelists** (enable **IBKR bridge**), or the same central API. Requires correct reverse-proxy client IP (see `deploy/docker-compose.vps-client-ip.yml`).

## modify-stop limitation

Interactive Brokers does not reliably support in-place amendment of child STP `auxPrice` for all order states. The bridge **cancels matching STP sells** for the symbol (or a given `order_id`) and **places a new STP**. Take-profit LMT orders are left alone when possible. Callers should pass `qty` and `stop_price`.

## Phase 4 — Task Scheduler (paper validation)

Before live promotion, register the bridge at logon and keep paper Gateway **4002**:

```powershell
cd backend\local-ibkr-bridge
.\scripts\register-task-scheduler.ps1
# Paper without Gateway: .\scripts\run-bridge.ps1 -Mock
```

W2 market-open execution is a **separate** desktop-package scheduled task. Full certify/E2E checklist: [IBKR-MONTHLY-PHASE4.md](IBKR-MONTHLY-PHASE4.md).

## Offline test

```bash
cd backend/local-ibkr-bridge
npm install
npm run test:offline
```

Uses `BRIDGE_MOCK_IBKR=1` — never places live orders.
