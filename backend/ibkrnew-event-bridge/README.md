# IBKRNew Event Bridge

This is the dedicated, outbound-only Windows desktop runtime for **IBKRNew Event Trader**. It has its own bridge ID, token, spool, API namespace, and IBKR client ID. It does not call or share credentials with the legacy monthly bridge.

The runtime is fail-closed unless either `IBKRNEW_MOCK=1`, or `IBKRNEW_PAPER_EXECUTION_ENABLED=1` with a paper account whose ID starts with `DU`. It streams Gateway callbacks, spools outbound events, verifies command signatures and expiry, revalidates commands, and submits a parent limit order with a broker-hosted protective stop. Live trading is unavailable.

1. Copy `.env.example` to `.env` and paste the one-time credentials from the IBKRNew UI.
2. Run `npm install` and `npm test`.
3. Start with `IBKRNEW_MOCK=1 npm start`.

No inbound server or public port is opened. Events are written to `IBKRNew-events.jsonl` before transmission and removed only after server acknowledgement.

## Instrument profile refresh

The price stream remains separate from slow-moving eligibility data. Configure `IBKRNEW_INSTRUMENT_PROFILES_FILE` with a local JSON array produced by the chosen licensed data adapter. Before market subscriptions begin, the bridge applies the published stock-index and ETF filters, emits an owner-scoped `instrument.profile_refreshed` event for each match, and then subscribes only to the selected symbols.

Stock profiles can contain `index_memberships`, `average_daily_volume`, `fundamentals`, and `corporate_events`. ETF profiles can contain `etf_categories`, `assets_under_management_usd`, and liquidity fields. Index identifiers are not hardcoded: the profile adapter reports identifiers such as `SPX`, `NDX`, or a configured custom index. The server independently revalidates membership, freshness, fundamentals, earnings blackout, ETF category, assets, liquidity, and spread before every authorization.

The profile file is an adapter boundary, not a source of executable prices. Executable quotes, account state, orders, fills, and commissions continue to come only from the local IBKR Gateway. Missing or stale required profile data fails closed.

## Instrument profile refresh

The price stream remains separate from slow-moving eligibility data. Before emitting a tradable signal, refresh each stock or ETF with `core.emitInstrumentProfile(...)`. Stock profiles can contain `index_memberships`, `fundamentals`, and `corporate_events`. ETF profiles can contain `etf_categories`, `assets_under_management_usd`, and liquidity fields. Flolah caches these owner-scoped profiles and fails closed when a required profile is missing or stale.

Index identifiers are configuration-defined rather than hardcoded. The desktop data adapter is responsible for resolving the requested index constituents and reporting those identifiers in each stock profile. ETF eligibility is evaluated independently and does not use stock index membership or company-fundamental rules.
