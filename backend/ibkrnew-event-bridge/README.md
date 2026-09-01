# IBKRNew Event Bridge

This is the dedicated, outbound-only Windows desktop runtime for **IBKRNew Event Trader**. It has its own bridge ID, token, spool, API namespace, and IBKR client ID. It does not call or share credentials with the legacy monthly bridge.

The runtime is fail-closed unless either `IBKRNEW_MOCK=1`, or `IBKRNEW_PAPER_EXECUTION_ENABLED=1` with a paper account whose ID starts with `DU`. It streams Gateway callbacks, spools outbound events, verifies command signatures and expiry, revalidates commands, and submits a parent limit order with a broker-hosted protective stop. Live trading is unavailable.

1. Download the full `IBKRNewBridge` package from **Connectors**. It includes a one-time bridge identity, production dependencies, and portable Node. The lite package requires Node 18+ and `npm ci`.
2. In the downloaded `.env`, set the real paper account only in local `IBKRNEW_ACCOUNT_ID`, then explicitly set `IBKRNEW_PAPER_EXECUTION_ENABLED=1` when ready. Flolah never asks for or receives that account identifier.
3. Run `scripts\Test-IBKRNewBridge.ps1`, then `scripts\Start-IBKRNewBridge.ps1`. For an offline mock, set `IBKRNEW_MOCK=1` and leave paper execution disabled.

No inbound server or public port is opened. Events are written to `IBKRNew-events.jsonl` before transmission and removed only after server acknowledgement.

The real IBKR account identifier is desktop-only. It is never entered in the Flolah browser UI, included in bridge health/events/errors, or stored on the VPS. Flolah generates an opaque, bridge-scoped `IBKRNewAccount_*` reference for server-side joins and reports. Do not add the local account identifier to custom profile or event payloads; the server also strips account-number fields and redacts recognizable IBKR account values as defense in depth.

Bridge protocol version 2 rechecks the current opaque account reference immediately before every broker submission. Upgrading from the former real-account registration contract revokes the old bridge credentials and cancels its pending commands; create fresh credentials in Live Operations and replace only `IBKRNEW_BRIDGE_ID` and `IBKRNEW_BRIDGE_TOKEN`. Stop the old desktop runtime and allow its short-lived authorizations to expire before starting the upgraded bridge.

## Instrument profile refresh

The price stream remains separate from slow-moving eligibility data. Configure `IBKRNEW_INSTRUMENT_PROFILES_FILE` with a local JSON array produced by the chosen licensed data adapter. Before market subscriptions begin, the bridge applies the published stock-index and ETF filters, emits an owner-scoped `instrument.profile_refreshed` event for each match, and then subscribes only to the selected symbols.

Stock profiles can contain `index_memberships`, `average_daily_volume`, `fundamentals`, and `corporate_events`. ETF profiles can contain `etf_categories`, `assets_under_management_usd`, and liquidity fields. Index identifiers are not hardcoded: the profile adapter reports identifiers such as `SPX`, `NDX`, or a configured custom index. The server independently revalidates membership, freshness, fundamentals, earnings blackout, ETF category, assets, liquidity, and spread before every authorization.

The profile file is an adapter boundary, not a source of executable prices. Executable quotes, account state, orders, fills, and commissions continue to come only from the local IBKR Gateway. Missing or stale required profile data fails closed.
