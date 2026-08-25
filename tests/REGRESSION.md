# Regression test packs

Post-CEO-login coverage. The VPS full runner creates its own disposable CEO tenant and exercises
Company Setup + Company Operate without touching a real CEO account.

## Minimal

Core auth + key surfaces + basic security denials.

```bash
cd agent-os/backend
npm run test:regression:minimal
# or: node ../tests/regression-minimal.js
```

## Full

Broader API coverage + semantic router isolation/execution modes + delegation callback correlation +
Company Setup/Operate lifecycle + security hardening checks (internal token, unauthenticated denials,
path traversal).

```bash
cd agent-os/backend
npm run test:regression:full
# Optional IBKR live/analytics: REGRESSION_IBKR=1 npm run test:regression:full
```

## Prerequisites

- Backend running (`npm start` in `backend/`)
- CEO credentials via `AGENT_OS_BALA_EMAIL` / `AGENT_OS_BALA_PASSWORD` (defaults match local seed)
- `AGENT_OS_INTERNAL_TOKEN` set in `backend/.env` (auto-generated at startup if missing in non-production)
- `AGENT_OS_REQUIRE_MFA=0` for automated login without TOTP


## Goal plan e2e (ad-hoc multiphase)

Part of **full** pack (`REGRESSION_GOAL_PLAN=1` default). Covers durable `agent_goal_create` planning:

1. Structural CRM + ERP `workflow_trigger` phrases preserved after plan storage  
2. Residual Platform Help becomes `specialty_task`  
3. Terminal `notify_ceo`  
4. With `REGRESSION_GOAL_PLAN_FORCE_TERMINAL=1` (default), child workflow/delegation terminals are force-closed so the ladder completes without live CEO gates  
5. Optional **async-ui** script proves create returns while steps remain incomplete and terminal CEO notify includes **`agr-…` + goal title** (`npm run test:goal-plan:async-ui`)  

Standalone:

```bash
cd backend
npm run test:e2e:goal-plan
npm run test:goal-plan:async-ui
# unit: npm run test:goal-plan:unit
# acceptance (includes adhoc e2e): npm run test:goal-plan:acceptance
```

Skip inside full pack: `REGRESSION_GOAL_PLAN=0 npm run test:regression:full`.

VPS: `bash deploy/scripts/vps-regression-full.sh`. It first removes stale users tagged
`flolah-regression-…@example.invalid`, creates a fresh tenant CEO, runs the full pack (including
router, setup, operate Day 0/Day 1/idempotency, and goal-plan E2E), then always offboards the fixture
through an EXIT/INT/TERM trap. Teardown verifies no directly user-scoped database rows remain.
Set `REGRESSION_COMPANY_LIFECYCLE=0` only when diagnosing unrelated infrastructure.
