# IBKR Monthly Trading — Phase 4 Runbook

Certify, paper E2E, laptop Task Scheduler, and multi-week paper validation before live.

Related: [IBKR-MONTHLY-TRADING-PLAN.md](IBKR-MONTHLY-TRADING-PLAN.md), [IBKR-LOCAL-BRIDGE.md](IBKR-LOCAL-BRIDGE.md), [IBKR-MONTHLY-EXECUTION-MODEL.md](IBKR-MONTHLY-EXECUTION-MODEL.md).

## Certify env (VPS + local)

Recommended BYOK models:

| Env | Value |
|-----|--------|
| `WORKFLOW_CERTIFY_MAKER_MODEL` | Claude Opus (e.g. `claude-opus-4-20250514`) |
| `WORKFLOW_CERTIFY_CHECKER_MODEL` | `deepseek-v4-flash` |

Comments are in `backend/.env.example`, `deploy/.env.example`, and `deploy/scripts/ensure-workflow-certify-env.sh` (appends commented lines if missing; never overwrites existing keys).

```bash
# Plan only
node backend/scripts/certify-monthly-trading-workflows.js --dry-run

# Seed + start certify jobs for W1, W3, W5
node backend/scripts/certify-monthly-trading-workflows.js --seed

# Poll until terminal / timeout
node backend/scripts/certify-monthly-trading-workflows.js --poll --timeout-ms 300000

# Fail if Anthropic/DeepSeek keys missing for recommended models
node backend/scripts/certify-monthly-trading-workflows.js --strict --dry-run
```

### Why W2 is not certified here

`monthly-trading-w2-execute` is the **laptop desktop package** (Task Scheduler at US open). It has no Brain / CEO approval nodes and calls `127.0.0.1` bridge URLs. Cloud/VPS `agent_workflow_certify_start` is the wrong environment — validate W2 with the paper E2E + local bridge mock + Task Scheduler dry runs instead.

## Paper E2E (no live Opus / Gateway)

```bash
cd backend
# Prefer trading off + bridge mock (script defaults these if unset)
set IBKR_TRADING_ENABLED=0
set BRIDGE_MOCK_IBKR=1
set DESKTOP_PACKAGE_SKIP_NODE_RUNTIME=1
node scripts/test-monthly-trading-paper-e2e.js
```

Pipeline covered without live Claude Opus:

1. Seed W1–W5  
2. Regime (+ screener when FMP key/cache available)  
3. Equity mark → monthly guardrail  
4. Hard gates (pass, CEO discretionary loss-sell branch, average-down reject)  
5. Plan save → approve → fetch → execution report  
6. Ledger dry-run place (`IBKR_TRADING_ENABLED=0`)  
7. Local bridge mock `/place-bracket`  
8. W3 event parse + optional webhook fill smoke  
9. Journal + weekly digest compose (+ email node presence on W1/W5)

By default the E2E verifies W3 hook secret handling (`verifyHookSecret`) without starting a live workflow run. Set `POST_WEBHOOK=1` to also POST a fill to the hook (may time out while W3 tools run — soft-passed). Optional skips: `SKIP_BRIDGE_MOCK=1`.

## Laptop Task Scheduler

See [IBKR-LOCAL-BRIDGE.md](IBKR-LOCAL-BRIDGE.md) and `backend/local-ibkr-bridge/scripts/`:

- `run-bridge.ps1` — start bridge (use `-Mock` for paper without Gateway)  
- `register-task-scheduler.ps1` — register **AgentOsIbkrBridge** at logon  

W2 desktop package is a **separate** scheduled task (market open). Keep paper Gateway port **4002** until promotion.

## Multi-week paper validation (CEO) — not fully automated

Automated Phase 4 covers scripts + env docs. Before flipping live:

- [ ] Paper account only (`IBKR_IS_PAPER=true`, port 4002)  
- [ ] Bridge + W2 Task Scheduler stable for several sessions  
- [ ] W1 digest emails arrive; W3 fills/equity marks update guardrail  
- [ ] Discretionary loss sells hit Kanban; buys/profitable sells stay automatic  
- [ ] Monthly drawdown guardrail observed at least once in simulation or real drawdown  
- [ ] Only then consider `IBKR_TRADING_ENABLED=1` / live ports (`IBKR_ALLOW_LIVE` stays off until explicitly approved)

## Deploy checklist

1. Sync backend to local + VPS  
2. Run `bash deploy/scripts/ensure-workflow-certify-env.sh` on VPS (comments only if missing)  
3. Seed: `node scripts/seed-monthly-trading-workflows.js`  
4. Paper E2E locally  
5. Certify W1/W3/W5 when Anthropic + DeepSeek keys are present  
6. Multi-week paper validation (CEO checklist above)
