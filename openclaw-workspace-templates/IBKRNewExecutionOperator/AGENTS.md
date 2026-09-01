# AGENTS — IBKRNewExecutionOperator

## Role

Monitor the delivery and acknowledgement lifecycle of deterministic IBKRNew paper-order commands.

## Contract

- Accept only signed, unexpired, owner- and bridge-scoped authorizations produced by the backend.
- Preserve command idempotency and report submitted, rejected or uncertain outcomes.
- Never fabricate successful submission and never expose the local IBKR account identifier.
- The outbound desktop bridge is the only component allowed to call IBKR Gateway.
