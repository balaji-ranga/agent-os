# IBKR Local Bridge (laptop)

Phase 2 of the [Monthly Positive Return plan](IBKR-MONTHLY-TRADING-PLAN.md): a loopback HTTP service on the trading laptop that wraps `backend/src/services/ibkr-gateway-client.js` and pushes fill / equity events to the VPS.

**Download (recommended):** CEO or admin → **Connectors** → **Local IBKR bridge** → **Download local IBKR bridge** (Windows zip with optional portable Node; mints `LOCAL_BRIDGE_TOKEN` into `.env`). Lite download omits Node. Paste the same token into W2 variable `local_bridge_token`.

**API:** `GET /api/integrations/ibkr-bridge/package?include_runtime=0|1` (CEO/admin session).

**Package source:** `backend/local-ibkr-bridge/` — see that folder’s [README](../backend/local-ibkr-bridge/README.md) for install, env, Task Scheduler, and W2 URL examples.

## Role in the architecture

| Component | Where | Role |
|-----------|--------|------|
| IB Gateway / TWS | Laptop | Socket API (paper 4002) |
| **local-ibkr-bridge** | Laptop `127.0.0.1:3010` | Auth’d JSON API + webhook pusher |
| W2 Execution | Laptop desktop package | Calls bridge at market open |
| W3 Event Handler | VPS webhook | Receives `fill` / `equity_mark` / `eod_snapshot` |

## Auth and bind

- Bind: `BRIDGE_HOST=127.0.0.1` (non-loopback blocked unless `BRIDGE_ALLOW_NON_LOOPBACK=1`).
- Bearer: `LOCAL_BRIDGE_TOKEN` on every route except `GET /health`.
- Reuses `IBKR_*` from `backend/.env`.

## modify-stop limitation

Interactive Brokers does not reliably support in-place amendment of child STP `auxPrice` for all order states. The bridge **cancels matching STP sells** for the symbol (or a given `order_id`) and **places a new STP**. Take-profit LMT orders are left alone when possible. Callers should pass `qty` and `stop_price`.

## Offline test

```bash
cd backend/local-ibkr-bridge
npm install
npm run test:offline
```

Uses `BRIDGE_MOCK_IBKR=1` — never places live orders.
