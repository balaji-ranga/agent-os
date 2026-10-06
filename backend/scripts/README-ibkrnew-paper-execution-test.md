# Isolated Paper execution rehearsal

This is an explicitly confirmed human execution test, not a strategy signal.
It never enables Live or changes published settings. It uses the current
attested Paper bridge, an accepted real-time IBKR quote, original profile gates,
normal HMAC command delivery and submission-time checks. It requires the
existing automatic entry process and goal to permit entries; it does not
override a halted, expired or achieved goal, closed session or breaker.

Authenticated full tenant access is required. The owner is resolved from the
authenticated user, not from the body. This endpoint is not an agent tool.

- `POST /api/ibkrnew-paper-execution-tests`: body must contain
  `environment: "paper"`, `confirm_paper_execution_test: true`, a unique
  `request_id` (8–100 alphanumeric/underscore/hyphen characters), and `symbol`
  equal to `EEM` or `TLT`. One test per owner per New York trading day.
- `GET /api/ibkrnew-paper-execution-tests/:testId`: scoped test results.
- `POST /api/ibkrnew-paper-execution-tests/:testId/close`: body must contain
  `confirm_paper_test_close: true`. A filled test is closed by repricing only its
  own existing OCA target through the bridge; its protective stop is retained.

The test is exactly one long ETF share, at most $100 entry notional, at most
$1 planned price loss, at most $3 estimated round-trip commission, and at most
$103 budget reservation. Estimated commissions may exceed the target profit:
this is an execution rehearsal, not a profitability claim. Daily/gross usage
and actual account loss still include the test. No `goal_trade_link` is created,
so its realized P&L cannot inflate goal performance. SME history labels its
purpose `paper_execution_test` separately from goal-attributed strategy trades.

The same request ID is idempotent. Never retry an uncertain submission with a
new ID. After rejection/expiry, inspect the reason rather than forcing another
order. A filled entry is not proof of a protective child being accepted; verify
the actual child statuses. A requested exit is not proof of its fill. Preserve
protection if owned target/stop reconciliation cannot support a managed exit.

Offline validation: `node scripts/test-ibkrnew-paper-execution-test.mjs`.
Fixtures exercise scope, Live rejection, fresh data, goal/cash gates,
one-per-day/idempotency, protection, signed command delivery, commissions and
goal-profit exclusion without contacting a broker.
