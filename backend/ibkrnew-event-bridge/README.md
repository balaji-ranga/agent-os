# IBKRNew Event Bridge

This is the dedicated, outbound-only Windows desktop runtime for **IBKRNew Event Trader**. It has its own bridge ID, token, spool, API namespace, and IBKR client ID. It does not call or share credentials with the legacy monthly bridge.

The runtime is fail-closed unless either `IBKRNEW_MOCK=1`, or `IBKRNEW_PAPER_EXECUTION_ENABLED=1` with a paper account whose ID starts with `DU`. It streams Gateway callbacks, spools outbound events, verifies command signatures and expiry, revalidates commands, and submits a parent limit order with a broker-hosted protective stop. Live trading is unavailable.

1. Copy `.env.example` to `.env` and paste the one-time credentials from the IBKRNew UI.
2. Run `npm install` and `npm test`.
3. Start with `IBKRNEW_MOCK=1 npm start`.

No inbound server or public port is opened. Events are written to `IBKRNew-events.jsonl` before transmission and removed only after server acknowledgement.
