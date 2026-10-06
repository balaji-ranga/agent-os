# IBKRNew Paper profile providers

The Goal, strategy & universe page independently selects fundamentals and earnings providers for Paper. Quotes, volume, executable-price freshness and orders remain IBKR. Live selections remain IBKR; this FMP adapter is not validated or activated for Live.

`universe.profile_data.paper` contains `fundamentals_provider` and `earnings_provider` (`IBKR` or `FMP`). Legacy configs default to IBKR. Publishing provider choices does not create/reset a goal or change risk thresholds. Switching providers makes mismatched cached families ineligible; there is no silent fallback.

FMP uses the existing backend `MARKET_DATA_API_KEY`. It is never downloaded to the desktop or displayed in the UI. Requests use the fixed stable FMP host, bounded timeouts, sanitized error codes and roughly 28 calls/minute. Valid results refresh at most every six hours (or sooner for tighter configured freshness). Failures retry after one hour; authorization/rate-limit failures pause requests for one hour. Refresh requires a currently attested Paper bridge and active Paper goal/cycle.

Fundamentals require matching symbols, USD market cap, numeric debt/equity and four consecutive USD fiscal quarters of revenue. The latest financial period must be no more than 200 days old. Cash flow is requested/validated only when the strategy requires it. Negative equity/debt ratios cannot pass the debt filter. Retrieval time and financial period end are separate.

Earnings uses each stock's symbol-specific endpoint, requiring historical and upcoming dates plus recently updated future coverage. Empty/malformed responses never imply absence of earnings risk. Date-only events use inclusive New York calendar-day blackouts. ETFs do not require these stock data families.

IBKR remains an explicit option for validated desktop profile feeds. Selecting it does not purchase or activate data permissions. Fundamental reports returning 10358 require an IBKR support/entitlement determination. WSH earnings requires Wall Street Horizon Corporate Event Data and a validated Paper/API feed. Until that feed supplies required fields, the IBKR selection fails closed.

`GET /profiles/status` and `POST /profiles/refresh` are authenticated owner-scoped IBKRNew routes. Refresh queues eligibility data only; it cannot issue broker commands. The normal server worker resumes after backend restart. UI readiness counters refer to profile refresh, not trading signals or quote permissions.

Tests: `node backend/scripts/test-ibkrnew-profile-data.mjs`, the existing event-trader and volume projection regressions, bridge offline tests and frontend build.
