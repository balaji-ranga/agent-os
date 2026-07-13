# Regression test packs

Post-CEO-login coverage (excludes admin login and user onboarding/register).

## Minimal

Core auth + key surfaces + basic security denials.

```bash
cd agent-os/backend
npm run test:regression:minimal
# or: node ../tests/regression-minimal.js
```

## Full

Broader API coverage + security hardening checks (internal token, unauthenticated denials, path traversal).

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
