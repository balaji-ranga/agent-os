# Flolah IBKR Event Trader

## Implementation-ready functional specification

**Status:** Implemented paper baseline
**Version:** 1.2
**Date:** 2026-09-01
**Delivery mode:** Net-new, paper-first, fully event-driven
**Product:** Flolah (source repository: `agent-os`)

**Implementation namespace:** `IBKRNew*` for every reaction agent, executable command, authorization, event, reservation, bridge, and desktop event identifier.

The implemented paper baseline is mapped to:

- API: `/api/ibkrnew-event-trader`.
- Cloud service: `backend/src/services/ibkrnew-event-trader.js`.
- Dedicated desktop runtime: `backend/ibkrnew-event-bridge`.
- UI: `Prebuilt Workflows -> IBKRNew0 -> Strategy | Summary | Live Operations` (`/ibkrnew0/*`). The former `/ibkrnew-event-trader` route redirects to Live Operations.
- Automated certification: `npm run test:ibkrnew-event-trader` in `backend` and `npm test` in `backend/ibkrnew-event-bridge`.

Real broker execution remains structurally paper-only. The desktop adapter requires both a `DU` paper account and `IBKRNEW_PAPER_EXECUTION_ENABLED=1`; there is no live override.

---

## 1. Executive decision record

Flolah will add a new product capability named **IBKR Event Trader**. It will be isolated from all existing IBKR monthly, maker/checker, poller, day-plan, webhook, ledger, and summary workflows.

The system will trade US markets through Interactive Brokers using a dedicated local desktop bridge connected to IB Gateway or TWS. The VPS will never connect directly to IBKR. The desktop bridge will receive streaming market and broker callbacks, calculate configured market features, emit durable events to Flolah, claim signed execution commands from Flolah, revalidate them locally, and submit them to IBKR.

The first certified release will support:

- Long US stocks.
- Short US stocks, independently disableable.
- Long calls.
- Long puts.
- Intraday and explicitly authorized overnight positions.
- Paper execution only.
- Configurable advisory, approval-required, and automatic execution modes.
- A configurable liquid-stock trend/pullback reference strategy.
- Total budget default of USD 10,000.
- Daily opening-exposure budget default of USD 1,000.

It will not support short options, naked options, multi-leg options, futures, forex, crypto, automatic exercise, holding options through expiry, or high-frequency/scalping strategies in the first release.

All policies, strategies, universes, market-data requirements, holding rules, order permissions, profit rules, and feature switches are owner-configurable and versioned. Configuration can tighten behavior immediately; it cannot bypass platform safety floors or broker restrictions.

---

## 2. Goals

1. Provide a genuinely event-driven trading system driven by IBKR callbacks and meaningful market events rather than scheduled day plans or polling workflows.
2. Preserve Flolah CEO/company ownership and tenant isolation across every event, policy, command, position, order, bridge, token, and projection.
3. Enforce budgets and risk deterministically outside LLM prompts.
4. Keep latency-sensitive market feature calculation and safety checks on the desktop beside IB Gateway.
5. Keep protective exits at IBKR whenever possible so loss protection does not depend on the VPS or internet connection.
6. Make the trading product configurable without hardcoded tickers, strategies, budgets, or model names.
7. Make event replay safe and prevent duplicate broker execution.
8. Produce an auditable causal chain from market observation through signal, authorization, command, broker order, fill, position, and exit.
9. Provide an explicit paper-certification path before any future live-trading work.

## 3. Non-goals

- Modifying or replacing existing IBKR workflows.
- Migrating existing monthly-trading or maker/checker data.
- Server-side direct access to IB Gateway.
- Millisecond execution, co-location, latency arbitrage, or high-frequency trading.
- Allowing an LLM to call an unrestricted raw `placeOrder` tool.
- Guaranteeing profitability or representing the reference strategy as financial advice.
- Funding the IBKR account.
- Treating broker buying power or short-sale proceeds as extra Flolah budget.

---

## 4. Legacy isolation contract

The new capability uses the namespace `ibkr_event_trader` and separate identifiers, tables, routes, tools, workflow templates, webhook/channel credentials, tokens, bridge packages, bridge IDs, IBKR client IDs, and UI routes.

The implementation must not:

- Invoke `monthly-trading-w1-post-close`, W2, W3, W4, or W5.
- Invoke `ibkr-maker-checker-paper` or `ibkr-position-poller-paper`.
- read existing workflow variables as Event Trader policy.
- Write to existing day-plan, monthly guardrail, legacy reservation, or legacy workflow tables.
- Reuse existing local-bridge webhook secrets.
- Cause a legacy IBKR webhook to dispatch an Event Trader reaction.
- Cause an Event Trader event to dispatch a legacy workflow.
- Change the behavior or default values of existing IBKR tools.

Shared utilities may be used only where they are already generic, including authenticated-owner resolution, secret redaction, retention plumbing, desktop runtime packaging, and pure IBKR contract helpers. Shared changes must be additive and have legacy regression coverage.

Removal or disabling of Event Trader must leave legacy IBKR behavior and data intact.

---

## 5. System topology

### 5.1 Desktop edge

The **Flolah IBKR Event Bridge** is a separate Windows desktop package/process. It connects to IB Gateway/TWS on a local socket using its own configured IBKR client ID.

It contains:

- Gateway connection manager.
- Subscription manager.
- Contract resolver.
- Tick normalizer.
- Bar builder.
- Deterministic feature engine.
- Local market clock.
- Local state cache.
- Durable event spool.
- Secure cloud-channel client.
- Command claimant and verifier.
- IBKR order adapter.
- Broker callback normalizer.
- Reconciliation engine.
- Local emergency safety controller.

The bridge binds no public port. It initiates an outbound TLS connection to Flolah.

### 5.2 Flolah VPS

Flolah contains:

- Authenticated bridge-channel gateway.
- Event inbox and durable event store.
- Event schema validator and deduplicator.
- Aggregate state projections.
- Event subscription dispatcher.
- Short-lived workflow reactions.
- Policy and strategy registry.
- Deterministic risk evaluator.
- Exposure reservation ledger.
- Trade authorization service.
- Durable command outbox.
- Command acknowledgement handler.
- Operations and configuration APIs.
- Event Trader UI and audit timeline.

### 5.3 Direction of communication

Desktop to Flolah:

- Market feature events.
- Market session events.
- Bridge health and heartbeat.
- Account and restriction changes.
- Order acknowledgements and statuses.
- Executions, fills, and commissions.
- Positions and P&L changes.
- Command claim and execution acknowledgements.
- Reconciliation snapshots.

Flolah to desktop:

- Published policy and strategy versions.
- Universe/subscription assignments.
- Signed, immutable, expiring commands.
- Cancel commands.
- Reconciliation requests.
- Halt and resume state.

### 5.4 Event-driven boundary

There are no scheduled trading workflows, position poller workflows, or long-running workflow loops. Waiting state is stored durably.

Time-dependent behavior is initiated by canonical events such as `trading_day.started`, `market.opened`, `position.maximum_hold_reached`, and `option.expiry_exit_window_started`. The local market clock emits these events using a US exchange calendar.

Heartbeats and reconnect timers are operational event sources, not trading-decision pollers.

---

## 6. Availability and fail-safe behavior

### 6.1 Flolah unavailable

- Block all new entries.
- Preserve broker-native protective orders.
- Continue local event capture into the durable spool.
- Permit already authorized risk-reducing actions that have not expired.
- Permit configured local emergency cancellation/flatten behavior.
- Replay unacknowledged events after reconnection.

### 6.2 IBKR Gateway unavailable

- Block all new and unsubmitted commands.
- Mark quotes, account state, positions, and shortability stale.
- Emit `bridge.gateway_disconnected` when cloud connectivity remains available.
- Do not assume an uncertain order failed.
- On reconnect, request open orders, executions, positions, account values, and subscription state before accepting new entries.
- Resolve uncertain commands through broker reconciliation; never blindly resubmit.

### 6.3 Desktop unavailable

- Display bridge offline in Flolah.
- Expire unclaimed entry commands.
- Do not queue new entries for later surprise execution.
- Preserve existing IBKR-hosted orders.
- Notify the CEO of unprotected positions if reconciliation indicates missing protection.

### 6.4 Stale data

New entry authorization requires fresh quote, feature, account, policy, strategy, universe, and bridge state. Staleness thresholds are configurable by data type, within platform safety maximums.

Closing orders may proceed with degraded information when they reduce risk, but must use bounded prices and explicit degraded-mode audit reasons.

---

## 7. Identity, ownership, and trust

Every persisted or transmitted object includes:

- `owner_user_id`
- `account_id`
- `bridge_id`
- `environment` (`paper`; `live` reserved for future use)

The server derives the owner from the authenticated bridge token or user session. It never accepts owner identity from an untrusted body as authority.

Bridge tokens are owner- and bridge-specific, hashed at rest on the server, revocable, rate-limited, and never reusable against legacy bridge endpoints.

Commands are signed or MAC-protected over their canonical contents. The desktop verifies signature, bridge, owner, account, environment, policy version, strategy version, expiry, and nonce before execution.

Cross-owner reads, events, acknowledgements, policy references, universe references, and commands are rejected and audited.

---

## 8. Configuration model

### 8.1 Precedence

Configuration resolves in this order:

1. Platform safety floor.
2. CEO/company trading policy.
3. Trading account policy.
4. Strategy policy.
5. Run/session override.

A lower layer may tighten but may not loosen an upper-layer restriction. The resolved configuration is immutable for each authorization.

### 8.2 Lifecycle

Configurations have `draft`, `published`, `retired`, and `revoked` states.

Publishing creates an immutable version. Editing creates a new draft/version. Historical events continue to reference the version used at decision time.

Publishing a risk-loosening change requires explicit CEO confirmation. Tightening can take effect immediately and triggers pending-command reconciliation.

### 8.3 TradingPolicy schema

Required logical fields:

```json
{
  "id": "policy-id",
  "version": 1,
  "name": "Conservative-Moderate Paper",
  "status": "published",
  "environment": "paper",
  "base_currency": "USD",
  "feature_switches": {
    "trading_enabled": true,
    "paper_execution_enabled": true,
    "live_execution_enabled": false,
    "long_stock_enabled": true,
    "short_stock_enabled": true,
    "long_call_enabled": true,
    "long_put_enabled": true,
    "intraday_enabled": true,
    "overnight_enabled": true,
    "extended_hours_enabled": false,
    "automatic_entry_enabled": true,
    "automatic_exit_enabled": true,
    "ceo_approval_required": false,
    "emergency_flatten_enabled": true
  },
  "budgets": {
    "total_gross_exposure_usd": 10000,
    "daily_opening_exposure_usd": 1000,
    "max_stock_position_usd": 750,
    "max_option_premium_position_usd": 250,
    "max_total_option_premium_usd": 1000,
    "max_short_position_usd": 500,
    "max_total_short_notional_usd": 2000,
    "short_stress_buffer_pct": 30,
    "minimum_cash_reserve_usd": 0,
    "max_open_positions": 6,
    "max_open_option_positions": 3
  },
  "loss_limits": {
    "max_planned_loss_per_trade_usd": 50,
    "daily_loss_limit_usd": 150,
    "weekly_loss_limit_usd": 400,
    "max_drawdown_usd": 1000,
    "max_consecutive_losses": 3
  },
  "order_permissions": {
    "entry_order_types": ["LIMIT"],
    "protective_order_types": ["STOP", "STOP_LIMIT", "LIMIT"],
    "allow_fractional_shares": false,
    "allow_unprotected_entry": false,
    "allow_hard_to_borrow": false
  },
  "session_rules": {
    "timezone": "America/New_York",
    "new_entry_cutoff_minutes_before_close": 60,
    "intraday_exit_start_minutes_before_close": 30,
    "intraday_exit_escalation_minutes_before_close": 15
  },
  "option_rules": {
    "minimum_dte": 14,
    "maximum_dte": 60,
    "exit_sessions_before_expiry": 3,
    "minimum_open_interest": 500,
    "minimum_daily_volume": 50,
    "maximum_spread_usd": 0.15,
    "maximum_spread_midpoint_pct": 10,
    "minimum_delta_abs": 0.55,
    "maximum_delta_abs": 0.70,
    "allow_automatic_exercise": false,
    "allow_hold_through_expiry": false
  },
  "freshness": {
    "quote_max_age_ms": 5000,
    "feature_max_age_ms": 15000,
    "account_max_age_ms": 30000,
    "shortability_max_age_ms": 15000,
    "authorization_ttl_ms": 15000
  }
}
```

All numeric limits have explicit minimum/maximum platform validation. `live_execution_enabled` is unavailable in the first release, not merely defaulted off.

### 8.4 UniverseSpec schema

```json
{
  "id": "universe-id",
  "version": 1,
  "name": "US Liquid Stocks",
  "sources": [
    { "type": "IBKR_SCANNER", "scan_code": "MOST_ACTIVE", "max_results": 50 },
    { "type": "ALLOWLIST", "symbols": [] }
  ],
  "filters": {
    "country": ["US"],
    "security_types": ["STK", "ETF"],
    "exchanges": ["SMART"],
    "minimum_price_usd": 10,
    "maximum_price_usd": 300,
    "minimum_market_cap_usd": 2000000000,
    "minimum_average_daily_volume": 2000000,
    "minimum_relative_volume": 1.25,
    "maximum_spread_pct": 0.20,
    "require_shortable_for_short": true,
    "exclude_halted": true,
    "exclude_earnings_window": false,
    "earnings_exclusion_sessions_before": 0,
    "earnings_exclusion_sessions_after": 0
  },
  "allowlist": [],
  "denylist": [],
  "sectors_included": [],
  "sectors_excluded": [],
  "maximum_active_subscriptions": 40
}
```

The resolved universe records source provenance, scanner rank, filter results, exact contracts, resolution timestamp, and expiry. An agent cannot trade outside the active resolved universe.

### 8.5 StrategySpec schema

```json
{
  "id": "strategy-id",
  "version": 1,
  "name": "US Liquid Trend Pullback",
  "enabled": true,
  "execution_mode": "automatic",
  "environment": "paper",
  "universe_id": "universe-id",
  "universe_version": 1,
  "allowed_expressions": ["LONG_STOCK", "SHORT_STOCK", "LONG_CALL", "LONG_PUT"],
  "holding_modes": ["INTRADAY", "OVERNIGHT"],
  "subscriptions": [
    "market.bar_closed",
    "market.session_changed",
    "instrument.shortability_changed",
    "order.filled",
    "position.changed",
    "position.maximum_hold_reached",
    "option.expiry_exit_window_started"
  ],
  "features": {
    "bar_intervals": ["1m", "5m", "15m", "1d"],
    "ema_fast": 9,
    "ema_slow": 21,
    "atr_period": 14,
    "use_vwap": true,
    "relative_volume_lookback_sessions": 20,
    "opening_range_minutes": 15
  },
  "market_regime": {
    "benchmarks": ["SPY", "QQQ"],
    "block_when_risk_off": true,
    "allow_mixed_regime": false
  },
  "entry": {
    "long_requires_price_above_vwap": true,
    "short_requires_price_below_vwap": true,
    "require_ema_alignment": true,
    "require_15m_confirmation": true,
    "minimum_relative_volume": 1.25,
    "allowed_setups": ["BREAKOUT_CONFIRMATION", "PULLBACK_CONFIRMATION"],
    "maximum_atr_extension": 1.0
  },
  "exits": {
    "initial_stop_method": "SETUP_INVALIDATION_BOUNDED_BY_ATR",
    "first_target_r": 1.0,
    "final_target_r": 2.0,
    "single_lot_target_r": 1.5,
    "partial_exit_pct": 50,
    "trail_after_r": 1.0,
    "trail_method": "ATR_OR_SWING",
    "never_widen_stop": true,
    "maximum_holding_sessions": 5
  },
  "options": {
    "derive_direction_from_underlying_signal": true,
    "stock_and_option_same_signal_allowed": false,
    "target_delta_abs": 0.60
  }
}
```

### 8.6 MarketDataPolicy

This specifies required entitlements, source precedence, subscription ceilings, permitted delayed data, freshness, bar construction, session type, and behavior when a field is absent.

Executable price, contract, account, position, and order truth must come from IBKR. External providers may add read-only candidate or veto signals in later versions but cannot authorize execution.

### 8.7 TradeAuthorization

An authorization is immutable and single-purpose:

```json
{
  "authorization_id": "uuid",
  "owner_user_id": "derived-owner",
  "account_id": "account",
  "bridge_id": "bridge",
  "environment": "paper",
  "strategy": { "id": "strategy-id", "version": 1 },
  "policy": { "id": "policy-id", "version": 1 },
  "universe": { "id": "universe-id", "version": 1 },
  "signal_event_id": "uuid",
  "action": "OPEN",
  "expression": "LONG_STOCK",
  "contract": {
    "con_id": 0,
    "symbol": "AAPL",
    "security_type": "STK",
    "exchange": "SMART",
    "currency": "USD"
  },
  "side": "BUY",
  "quantity": 1,
  "entry": { "order_type": "LIMIT", "limit_price": 0 },
  "protection": {
    "stop_price": 0,
    "targets": [{ "limit_price": 0, "quantity": 1 }],
    "oca_required": true
  },
  "budget": {
    "daily_opening_reserved_usd": 0,
    "total_exposure_reserved_usd": 0,
    "planned_loss_usd": 0,
    "reservation_id": "uuid"
  },
  "observed": {
    "bid": 0,
    "ask": 0,
    "last": 0,
    "quote_at": "ISO-8601",
    "feature_event_id": "uuid",
    "account_snapshot_id": "uuid"
  },
  "issued_at": "ISO-8601",
  "expires_at": "ISO-8601",
  "idempotency_key": "opaque",
  "nonce": "opaque",
  "signature": "opaque"
}
```

The bridge may reject an authorization but may not change contract, direction, quantity, price bounds, protection, or risk reservation. A materially changed order requires a new authorization.

---

## 9. Budget and risk semantics

### 9.1 Daily opening exposure

Daily usage is charged to all opening exposure, including long stock, short stock, long calls, and long puts.

- Long stock: quantity × protected maximum entry price.
- Short stock: quantity × protected entry price.
- Long option: contracts × protected premium × multiplier.
- Estimated commissions and fees are included.
- Closing exposure contributes zero daily opening usage.

Capacity is reserved at authorization to prevent concurrent oversubscription.

- Fully unfilled cancellation or broker rejection releases the unused reservation.
- A partial fill permanently consumes filled exposure for that trading day; the unfilled portion remains reserved until cancellation/expiry.
- Closing a filled position does not restore daily capacity.
- Capacity resets on the next official US trading day.
- Retries retain the same logical reservation and cannot double-count or double-spend it.

### 9.2 Total gross exposure

Projected gross exposure equals:

```text
absolute long-stock market value
+ absolute short-stock market value with configured stress buffer
+ long-option premium exposure
+ pending opening-order reservations
+ estimated fees
```

The effective ceiling is the minimum of configured total budget, broker-confirmed eligible capital, Flolah policy capacity, and broker-permitted capacity.

Short-sale proceeds and broker buying power never increase Flolah capacity. Profits never automatically raise the configured ceiling.

### 9.3 Loss controls

Default reference profile:

- Planned loss per trade: USD 50.
- Daily loss circuit breaker: USD 150.
- Weekly loss circuit breaker: USD 400.
- High-water-mark drawdown breaker: USD 1,000.
- Consecutive-loss breaker: three.

Loss calculations include realized P&L, unrealized P&L, commissions, and fees according to configured mark/fill rules.

When a breaker fires:

- Cancel pending opening commands and orders.
- Preserve or repair protective exits.
- Permit risk-reducing closes.
- Emit an auditable circuit-breaker event.
- Require configured automatic reset or CEO resume; no agent override.

### 9.4 Short stock

Short entry requires:

- Feature switch enabled.
- Exact stock contract.
- Fresh IBKR shortability and availability.
- Hard-to-borrow permission if applicable; default denied.
- Fresh account and margin preview.
- Protected entry limit.
- Mandatory buy-to-cover stop.
- Position and aggregate short caps.
- Stress-buffer reservation.

Loss-increasing averaging into a short after stop invalidation is prohibited by the platform floor.

### 9.5 Long options

Only `BUY_TO_OPEN` and `SELL_TO_CLOSE` semantics are permitted. Exact contract identity requires `conId` plus underlying, expiry, strike, right, multiplier, exchange, currency, and trading class when applicable.

No automatic exercise or hold-through-expiry is permitted. Positions enter forced-exit state at the configured number of sessions before expiry.

---

## 10. Reference strategy behavior

### 10.1 Purpose

The default strategy is a configurable liquid-US-stock trend/pullback strategy. It is a certification baseline, not a guaranteed-profit strategy. Additional strategies use the same generic contracts.

### 10.2 Market regime

The local feature engine evaluates SPY and QQQ using session VWAP, 5-minute EMA alignment, 15-minute confirmation, spread/volatility conditions, and data health.

Regimes are `BULLISH`, `BEARISH`, `MIXED`, `RISK_OFF`, and `DATA_UNAVAILABLE`.

- Long stock/calls require a permitted bullish regime.
- Short stock/puts require a permitted bearish regime.
- `RISK_OFF` and `DATA_UNAVAILABLE` block entries.

### 10.3 Long signal

An eligible instrument must be above VWAP, have fast EMA above slow EMA, pass relative-volume/liquidity/freshness rules, receive 15-minute confirmation, and produce either a configured breakout confirmation or pullback recovery without excessive ATR extension.

### 10.4 Short signal

The inverse conditions apply, plus fresh shortability, borrow permission, and margin checks.

### 10.5 Options expression

A long stock signal may be expressed as a long call. A short stock signal may be expressed as a long put. The policy/strategy selects one expression; the first release does not open stock and option exposure from the same signal unless explicitly enabled.

The option selector filters by DTE, delta, premium, open interest, volume, spread, permissions, and exact contract resolution.

### 10.6 Position sizing

Stock quantity is the minimum of risk-based quantity, exposure-based quantity, universe/strategy cap, and broker-permitted quantity.

```text
risk quantity = floor(max planned loss / abs(entry - stop))
exposure quantity = floor(max position exposure / protected entry)
```

Option contracts must pass both planned-loss and premium-exposure limits. If one contract is too large, the candidate is rejected.

### 10.7 Profit and loss booking

Protective and target orders are broker-native bracket/OCA orders whenever supported.

Default stock behavior:

- Initial stop at setup invalidation bounded by configured ATR/risk.
- First target at 1R.
- Final target at 2R.
- If size is divisible, close configured partial quantity at 1R and trail the remainder.
- For indivisible/small size, use a single target at 1.5R.
- Never widen a stop.
- Apply configured time stop when the setup fails to progress.

Default long-option behavior:

- Exit on underlying invalidation or premium-loss boundary, whichever is first.
- Target 1.5R for a single contract.
- Apply configured time and expiry exits.
- Use bounded limit exits and escalation for wide spreads.

Intraday positions start exit processing 30 minutes before regular close and escalation 15 minutes before close by default. They never silently convert to overnight.

Overnight positions require explicit authorization and re-evaluation events, remain within total exposure, and default to a five-session maximum hold.

---

## 11. Market data and IBKR integration contract

### 11.1 Required TWS API capabilities

Market discovery and data:

- Streaming market data subscription.
- Optional tick-by-tick subscription for a bounded active set.
- Real-time bars or local tick aggregation.
- Historical data for warm-up and rolling features.
- Market scanner subscriptions.
- Contract details.
- Option security-definition parameters.

Account and risk:

- Account summary updates.
- Position updates.
- P&L and per-position P&L.
- Open orders.
- Executions and commission reports.
- Available funds and excess liquidity.
- Initial/maintenance margin.
- What-if/order preview where supported.
- Shortability/availability data and broker errors.

Execution:

- Place order.
- Cancel order.
- Bracket/OCA construction.
- Order status.
- Execution details.
- Error/rejection callbacks.

### 11.2 Subscription policy

The bridge subscribes only to the active resolved universe up to the owner-configured and broker-entitled ceiling. Benchmark and held-position subscriptions take priority over candidate subscriptions.

Options quotes are requested only after an underlying signal enters option-selection state, then released when no longer needed.

Scanner output is candidate discovery, not executable price truth.

### 11.3 Required stock observations

- Contract ID and metadata.
- Bid, ask, midpoint, last.
- Quote timestamp and market-data type.
- Spread and spread percentage.
- OHLCV bars.
- VWAP.
- Configured EMAs.
- ATR.
- Relative volume.
- Opening range and recent swing levels.
- Halt/trading status.
- Shortability/availability.
- Position and pending-order state.

### 11.4 Required option observations

- Exact option and underlying contract IDs.
- Expiry, strike, right, multiplier, exchange, currency, trading class.
- Bid, ask, midpoint, last.
- Volume and open interest.
- Delta and implied volatility when entitled.
- Quote timestamp and underlying price.
- Position and pending-order state.

### 11.5 Indicator calculation

Indicators are deterministic and versioned. Each feature event records source bar IDs, formula/version, input interval, timestamp, and data completeness. The LLM does not calculate authoritative indicators.

---

## 12. Canonical event model

### 12.1 Envelope

```json
{
  "event_id": "uuid",
  "event_type": "market.bar_closed",
  "schema_version": 1,
  "occurred_at": "ISO-8601",
  "received_at": "ISO-8601",
  "owner_user_id": "derived-owner",
  "account_id": "account",
  "bridge_id": "bridge",
  "environment": "paper",
  "source": "IBKR_EVENT_BRIDGE",
  "correlation_id": "uuid",
  "causation_id": "uuid-or-null",
  "aggregate_type": "INSTRUMENT",
  "aggregate_id": "conid",
  "sequence": 1,
  "idempotency_key": "opaque",
  "policy_version": 1,
  "strategy_version": 1,
  "payload": {}
}
```

Owner identity is replaced/verified from authentication. Unknown schemas are quarantined, not dispatched.

### 12.2 Event families

Bridge:

- `bridge.connected`
- `bridge.heartbeat`
- `bridge.disconnected`
- `bridge.gateway_connected`
- `bridge.gateway_disconnected`
- `bridge.reconciliation_started`
- `bridge.reconciliation_completed`

Market and session:

- `trading_day.started`
- `trading_day.ended`
- `market.pre_open`
- `market.opened`
- `market.entry_cutoff_reached`
- `market.exit_window_started`
- `market.closed`
- `market.bar_closed`
- `market.vwap_crossed`
- `market.breakout_confirmed`
- `market.pullback_confirmed`
- `market.spread_limit_breached`
- `market.data_stale`
- `market.data_recovered`

Instrument and option:

- `instrument.eligible`
- `instrument.ineligible`
- `instrument.shortability_changed`
- `option.contract_resolved`
- `option.contract_resolution_failed`
- `option.expiry_exit_window_started`

Account and risk:

- `account.snapshot_changed`
- `account.restriction_changed`
- `account.margin_changed`
- `risk.authorization_granted`
- `risk.authorization_denied`
- `risk.reservation_created`
- `risk.reservation_adjusted`
- `risk.reservation_released`
- `risk.limit_reached`
- `risk.circuit_breaker_activated`
- `risk.circuit_breaker_cleared`

Strategy:

- `strategy.signal_created`
- `strategy.signal_updated`
- `strategy.signal_expired`
- `strategy.signal_withdrawn`
- `strategy.entry_condition_met`
- `strategy.exit_condition_met`

Command and broker:

- `command.created`
- `command.claimed`
- `command.rejected_by_bridge`
- `command.submitted`
- `command.expired`
- `order.acknowledged`
- `order.partially_filled`
- `order.filled`
- `order.cancel_requested`
- `order.cancelled`
- `order.rejected`
- `execution.commission_reported`

Position:

- `position.opened`
- `position.increased`
- `position.reduced`
- `position.closed`
- `position.protection_confirmed`
- `position.protection_missing`
- `position.maximum_hold_reached`

### 12.3 Delivery semantics

Transport is at-least-once; processing and broker effects are logically exactly-once through unique IDs, idempotency keys, reservation uniqueness, command nonces, and broker reconciliation.

Duplicate events return their prior acknowledgement. Aggregate projections reject stale sequence updates that would reverse terminal state. Events remain append-only; corrections are new events.

---

## 13. Command protocol

### 13.1 Command types

- `SUBMIT_AUTHORIZED_ENTRY`
- `SUBMIT_PROTECTIVE_EXIT`
- `CANCEL_ORDER`
- `REDUCE_POSITION`
- `CLOSE_POSITION`
- `CANCEL_ALL_OPENING_ORDERS`
- `EMERGENCY_FLATTEN`
- `RECONCILE_STATE`
- `UPDATE_SUBSCRIPTIONS`

The first six require policy authorization; emergency actions require an enabled, bounded emergency policy.

### 13.2 Claim and execution

1. Server creates a durable command with expiry and unique idempotency key.
2. The connected bridge receives or claims it over the authenticated outbound channel.
3. Server atomically leases the command to that bridge.
4. Bridge verifies signature and immutable authorization.
5. Bridge revalidates current quote, spread, account, permission, shortability, policy status, environment, and connectivity.
6. Bridge rejects stale/unsafe commands with typed reasons.
7. Bridge persists intent locally before calling IBKR.
8. Bridge submits once.
9. Bridge emits command and broker events.
10. Server reconciles reservation and projections.

Lease expiry does not imply broker failure. An uncertain command enters reconciliation and cannot be reissued automatically.

### 13.3 Price movement tolerance

Authorization contains bounded price/slippage rules. If the current executable quote is outside bounds, the bridge rejects the command and emits a fresh market event. It never changes the price to chase the market.

---

## 14. State machines

### 14.1 Opening trade

```text
CANDIDATE
→ CONTRACT_RESOLVED
→ POLICY_EVALUATED
→ RESERVED
→ AUTHORIZED
→ COMMAND_QUEUED
→ BRIDGE_CLAIMED
→ SUBMITTED
→ ACKNOWLEDGED
→ PARTIALLY_FILLED
→ FILLED
```

Terminal/alternate states:

```text
DENIED | EXPIRED | CANCELLED | REJECTED | FAILED | UNCERTAIN
```

`UNCERTAIN` may transition only through reconciliation.

### 14.2 Position protection

```text
ENTRY_FILLED
→ PROTECTION_PENDING
→ PROTECTED
→ EXIT_PARTIALLY_FILLED
→ CLOSED
```

Failure path:

```text
PROTECTION_PENDING
→ PROTECTION_MISSING
→ EMERGENCY_REPAIR_OR_CLOSE
```

### 14.3 Intraday position

At exit-window event, an open intraday position transitions to `EXIT_REQUIRED`. At escalation it transitions to `EXIT_URGENT`. It may not transition to overnight without a new explicit authorization created before the cutoff.

### 14.4 Option position

At expiry-exit-window event, the position transitions to `EXIT_REQUIRED`. Exercise is not an allowed terminal action in the first release.

---

## 15. Short-lived Flolah reactions

Workflows react to one persisted event and finish. Reference reactions:

- Universe refresh after `trading_day.started` or configuration publication.
- Regime update after benchmark `market.bar_closed`.
- Candidate evaluation after eligible-instrument feature events.
- Contract resolution after option-expression selection.
- Risk authorization after `strategy.entry_condition_met`.
- Reservation adjustment after partial fills/cancels/rejections.
- Protection verification after entry fill.
- Exit authorization after stop/target/time/expiry events.
- Circuit-breaker response after loss/account/bridge risk events.
- Reconciliation after bridge/Gateway reconnect.

No workflow sleeps waiting for a fill. Fill events start the next reaction.

Agent/Brain steps may summarize evidence or choose among strategy-permitted expressions, but cannot override eligibility, budgets, sizing, freshness, permissions, or order bounds.

---

## 16. Agent roles and skill specifications

### 16.1 Market Observer

Read-only. Interprets normalized features and regime evidence. It cannot reserve or trade.

### 16.2 Strategy Planner

Produces schema-valid candidates only within the active strategy and universe. Output includes thesis, expression preference, holding mode, setup identity, entry condition, invalidation, and evidence event IDs.

### 16.3 Options Contract Resolver

Uses read-only chain/contract tools to propose exact option contracts. Deterministic validators enforce identity, liquidity, DTE, premium, and entitlement requirements.

### 16.4 Risk Checker

Requests deterministic evaluation and explains typed results. It cannot modify limits or approve a denial.

### 16.5 Execution Operator

Receives only immutable authorization/command status tools. It cannot directly form or alter broker orders.

### 16.6 Position Monitor

Interprets position events and may propose strategy-permitted exits. Broker-native and deterministic exit rules remain authoritative.

### 16.7 Trading Supervisor

Summarizes health, exceptions, loss/budget status, and unresolved reconciliation. It may halt but cannot loosen policy.

Every skill definition must specify input/output JSON schema, allowed tools, prohibited actions, data freshness, evidence requirements, owner scope, retry/idempotency behavior, policy/strategy version, and escalation behavior.

---

## 17. Server API surface

All routes are authenticated and owner-scoped. Proposed namespace:

Configuration:

- `GET/POST /api/ibkr-event-trader/policies`
- `GET/PUT /api/ibkr-event-trader/policies/:id/draft`
- `POST /api/ibkr-event-trader/policies/:id/publish`
- `GET/POST /api/ibkr-event-trader/strategies`
- `GET/PUT /api/ibkr-event-trader/strategies/:id/draft`
- `POST /api/ibkr-event-trader/strategies/:id/publish`
- `GET/POST /api/ibkr-event-trader/universes`
- `GET/PUT /api/ibkr-event-trader/universes/:id/draft`
- `POST /api/ibkr-event-trader/universes/:id/publish`

Operations:

- `GET /api/ibkr-event-trader/status`
- `GET /api/ibkr-event-trader/budgets/current`
- `GET /api/ibkr-event-trader/signals`
- `GET /api/ibkr-event-trader/orders`
- `GET /api/ibkr-event-trader/positions`
- `GET /api/ibkr-event-trader/events`
- `GET /api/ibkr-event-trader/authorizations`
- `POST /api/ibkr-event-trader/halt`
- `POST /api/ibkr-event-trader/resume`
- `POST /api/ibkr-event-trader/commands/:id/cancel`
- `POST /api/ibkr-event-trader/positions/:id/close`

Bridge:

- `POST /api/ibkr-event-trader/bridges/package`
- `POST /api/ibkr-event-trader/bridges/:id/revoke`
- `GET /api/ibkr-event-trader/bridges`
- `GET /api/ibkr-event-trader/bridge-channel` upgraded to WebSocket or an equivalent authenticated outbound channel.

Event ingestion and command acknowledgement are carried on the channel, with HTTP fallback endpoints only if they preserve identical authentication/idempotency semantics.

All list APIs are paginated and retention-aware. No public unauthenticated trading endpoint exists.

---

## 18. Persistence model

New tables use an `ibkr_event_trader_` prefix and mandatory `owner_user_id` indexes.

Required logical stores:

- Policies and immutable policy versions.
- Strategies and immutable strategy versions.
- Universes, universe versions, and resolved universe snapshots.
- Bridges and token metadata.
- Append-only event inbox/store.
- Event quarantine.
- Aggregate sequences and projections.
- Signals.
- Risk decisions.
- Exposure reservations.
- Daily/weekly budget periods.
- Trade authorizations.
- Command outbox and leases.
- Broker order mappings.
- Fills and commissions.
- Positions and protection state.
- Circuit-breaker state.
- Reconciliation runs and discrepancies.

Uniqueness requirements include owner plus event ID, owner plus idempotency key, owner/account plus broker execution identity, owner plus authorization nonce, and owner plus logical reservation identity.

Transactional truth remains in SQLite/tenant database. OpenSearch may index redacted events for search but is never authoritative.

All new stores participate in owner retention and offboarding. Deletion must not touch legacy IBKR tables.

---

## 19. UI journeys

### 19.1 Setup

1. CEO opens IBKR Event Trader.
2. Selects or creates an IBKR paper account connection.
3. Downloads the separate Event Bridge package.
4. Starts IB Gateway/TWS and the Event Bridge.
5. Flolah confirms bridge, Gateway, paper account, market data, permissions, and clock health.
6. CEO creates/publishes a policy, universe, and strategy.
7. CEO selects advisory, approval-required, or automatic paper mode.
8. Certification checklist unlocks paper execution.

### 19.2 Operations

The dashboard shows:

- Bridge/Gateway health and last heartbeat.
- Paper/live environment badge.
- Active policy, strategy, and universe versions.
- Total and daily budget consumed, reserved, and available.
- Loss limits and circuit-breaker status.
- Current regime.
- Active signals with evidence.
- Pending authorizations and commands.
- Orders, fills, positions, and protection status.
- Causal event timeline.
- Halt control.

### 19.3 Configuration

Editors expose every configurable switch and limit, validate conflicts, preview impact on pending orders/positions, and distinguish unavailable capabilities from disabled capabilities.

Disabling an opening capability blocks new exposure and cancels pending unfilled entries while preserving monitoring and risk-reducing closes.

### 19.4 User-visible async behavior

Every publish, halt/resume, close, cancel, package generation, and approval action shows processing state, prevents double submission, and returns an actionable result.

Responsive and light/dark theme requirements match the existing platform.

---

## 20. Security and safety requirements

- No IBKR, bridge, or workflow secrets in Git or event payloads.
- Local Gateway remains localhost-only.
- Bridge channel uses TLS and owner/bridge-scoped authentication.
- Rotate/revoke tokens without affecting legacy bridges.
- Rate-limit event ingestion and commands.
- Bound event sizes and reject unknown fields where security-relevant.
- Redact account IDs and broker errors in non-owner logs as appropriate.
- Validate all numeric fields for finiteness, sign, precision, and range.
- Use server time plus measured bridge clock skew; reject unsafe skew.
- Commands require expiry and replay protection.
- No LLM-generated executable order bypass.
- Closing/risk-reducing permissions remain available under entry halts.
- Live trading is structurally unavailable in release 1.
- Record every configuration change, approval, halt, authorization, denial, command, and reconciliation discrepancy.

---

## 21. Observability

Metrics and alerts:

- Bridge and Gateway connectivity.
- Heartbeat age and clock skew.
- Event ingest rate, validation failures, duplicates, quarantine, lag, and replay depth.
- Command creation, claim latency, expiry, rejection, uncertainty, and reconciliation time.
- Subscription counts and pacing errors.
- Quote/feature/account freshness.
- Reservation totals versus projections.
- Missing protection.
- Broker rejection categories.
- Cross-owner rejection attempts.
- Circuit-breaker activations.
- Legacy workflow regression health.

Every authorization must be traceable from UI through `signal_event_id`, policy/strategy/universe versions, risk decision, reservation, command, broker order IDs, executions, and exit.

---

## 22. Test and certification plan

### 22.1 Unit and schema tests

- Configuration precedence and cannot-loosen rules.
- Every feature switch.
- Budget calculations for long stock, short stock with stress buffer, and options multipliers.
- Partial-fill reservation arithmetic.
- Daily US-market-calendar reset.
- Profit not increasing configured capacity.
- Stock and option sizing.
- Shortability and margin gates.
- Options identity and expiry gates.
- Event schema/version validation.
- Aggregate transition legality.
- Command signature, expiry, nonce, and price bounds.

### 22.2 Concurrency and idempotency

- Simultaneous signals cannot exceed daily or total budget.
- Duplicate events do not duplicate reactions.
- Duplicate commands do not place duplicate orders.
- Out-of-order fill/order events do not reverse terminal state.
- Retry uses the original logical reservation.
- Multi-bridge claim races select one authorized bridge.

### 22.3 Disconnect and recovery

- Flolah unavailable with local event spooling.
- WebSocket reconnect and cursor replay.
- Gateway disconnect before and after submission.
- Uncertain submission reconciles without resubmission.
- Desktop restart restores local intent journal.
- Stale quotes/account/shortability reject entries.
- Protective broker orders survive cloud disconnect.

### 22.4 Trading scenarios

- Long stock entry, partial fill, bracket, profit target, close.
- Short stock entry, shortability loss before submit, rejection.
- Short fill and buy-to-cover stop.
- Long call selection, exact contract resolution, target exit.
- Long put selection and expiry-window exit.
- One option contract exceeding risk limit is rejected.
- Intraday forced exit.
- Explicit overnight hold and maximum-hold exit.
- Daily, weekly, drawdown, and consecutive-loss breakers.
- Disabled short/options/automatic-entry modes.
- Tightened policy cancelling pending entries but permitting closes.

### 22.5 Owner isolation

- Cross-owner policy, universe, strategy, event, bridge, authorization, command, position, and event-timeline access is rejected.
- A bridge token cannot nominate another owner/account.
- One owner cannot acknowledge or claim another owner’s command.
- Offboarding removes only that owner’s Event Trader data.

### 22.6 Legacy non-interference

- Existing IBKR workflow definitions remain unchanged.
- Existing IBKR variables and routes behave identically.
- New bridge token fails on legacy endpoints and vice versa.
- New events cannot dispatch legacy workflows.
- Legacy events cannot dispatch Event Trader reactions.
- Event Trader creates no writes in legacy trading tables.
- Disabling/removing Event Trader leaves legacy workflows operational.

### 22.7 Paper certification gates

Stage A: replay/simulation with no Gateway orders.
Stage B: paper long stock only.
Stage C: paper short stock.
Stage D: paper long calls and puts.
Stage E: combined paper operation and prolonged disconnect/recovery exercises.

Promotion between stages requires zero unexplained duplicate orders, zero budget breaches, zero cross-owner failures, full protective-order verification, and reviewed reconciliation evidence.

Live trading is a separate future feature decision and specification.

---

## 23. Implementation phases

### Phase 0 — Legacy baseline and rollback

- Record local, GitHub, and VPS commits and running images.
- Create a new rollback checkpoint.
- Capture legacy IBKR regression behavior and table-write baselines.

### Phase 1 — Contracts and persistence

- Add schemas, validators, versioned configuration, event store, quarantine, projections, reservations, authorizations, and command outbox under the new namespace.

### Phase 2 — Event Bridge foundation

- Build the separate package, token lifecycle, local state/spool, outbound channel, heartbeat, clock skew, and reconciliation without trading.

### Phase 3 — Market data and signals

- Add subscription management, bar/features, scanner/universe resolution, market/session events, and the reference strategy in advisory mode.

### Phase 4 — Deterministic risk and simulated execution

- Add budgets, breakers, sizing, authorization, command leasing, and broker simulator/replay certification.

### Phase 5 — Paper stock execution

- Add IBKR stock contract/order mapping, broker-native protection, fills, positions, intraday/overnight state, and long-stock certification; then short-stock certification.

### Phase 6 — Paper long options

- Add option chain resolution, quote selection, identity, multiplier-aware risk, option orders, and expiry exits.

### Phase 7 — UI, documentation, and operational certification

- Complete setup/configuration/operations UI, help documentation, observability, retention/offboarding, and combined paper certification.

Each phase is independently deployable behind owner-scoped feature flags and must not enable execution before its certification gate.

---

## 24. Acceptance criteria

The feature is implementation-complete when:

1. A CEO can configure, publish, disable, and version policy, strategy, universe, and execution mode.
2. The separate desktop bridge can connect to IB Gateway and Flolah without exposing an inbound port.
3. Streaming IBKR data produces deterministic, durable, deduplicated market events.
4. Short-lived event reactions produce explainable signals and deterministic risk decisions.
5. Concurrent authorizations cannot exceed USD 1,000 daily opening exposure or USD 10,000 total configured exposure under the default profile.
6. Disabling short stocks prevents new shorts while permitting buy-to-cover.
7. Long calls/puts use exact contracts and multiplier-aware exposure.
8. Duplicate/replayed events and commands never duplicate broker orders.
9. Broker-native protective orders remain active through Flolah/network loss.
10. Disconnect/reconnect reconciliation resolves uncertain state without blind resubmission.
11. Every decision is owner-scoped and causally auditable.
12. Cross-owner negative tests pass.
13. Existing IBKR workflows and data remain behaviorally unchanged.
14. Paper certification stages pass with no unexplained budget breach, duplicate execution, or missing protection.
15. Live execution remains unavailable.

---

## 25. Implementation guardrails

- Repository-first; no VPS hotfixes.
- Preserve dirty work and use a clean worktree from current `origin/main`.
- No secrets in source or logs.
- Additive generic infrastructure; IBKR-specific behavior stays in the adapter.
- No hardcoded ticker, user, strategy, model, or prompt special case.
- Owner scoping on every table, query, event, job, and channel.
- Transactional truth remains in tenant database, not OpenSearch.
- Update owner retention/offboarding and public/platform help.
- Add positive, negative, cross-owner, retry, replay, idempotency, concurrency, and legacy-regression tests.
- Validate backend tests, relevant regression scripts, frontend production build, Docker/Compose/Nginx when affected, and staged diff/secrets before commit.
- Create production rollback assets before deployment and provide evidence-based deployment/rollback reporting.

---

## 26. Commission economics, strategy skill, and live operations

### 26.1 Commission-aware authorization and exits

Every proposed trade records estimated round-trip commission, expected gross profit, expected net profit, commission drag percentage, net reward/risk, and the minimum exit price required to cover actual entry commissions, estimated exit commission, and the configured minimum net profit. Actual IBKR commission reports are correlated by execution and authorization and supersede estimates as they arrive.

The daily opening-exposure reservation includes estimated fees. A trade is blocked when expected net profit is below the configured floor, commission drag exceeds its ceiling, or commission-adjusted reward/risk is invalid. Profit booking uses net—not gross—economics.

Allocation can use the full remaining daily limit only when enabled and the proposal clears configurable concentrated-trade confidence, net reward/risk, and commission-drag thresholds. Otherwise a configurable percentage cap promotes diversification. Quantity is reduced to available capacity using whole units; unused capacity is not forced into a low-quality trade.

### 26.2 Strategy skill boundary

`IBKRNewStrategyPlanner` applies the versioned `ibkrnew-trade-strategy` skill to market events and returns structured proposals and evidence. The default skill is stored at `.cursor/skills/ibkrnew-trade-strategy/SKILL.md`, and its agent name, instructions, schema, and version are owner-configurable through immutable `strategy_skill` versions.

The skill may rank, abstain, and propose an expression, quantity, protection, confidence, and rationale. It cannot submit orders or override deterministic checks. Commission estimation, budgets, exposure, freshness, universe eligibility, broker constraints, protection, authorization, and command signing remain enforced by the service.

### 26.3 IBKRNew0 information architecture and operations

The Prebuilt Workflows navigation contains a parent `IBKRNew0` item with:

- **Strategy:** versioned strategy skill, strategy, policy, universe, and market-data configuration.
- **Summary:** trade history, estimated and actual commissions, gross/net P&L, required profitable exit, and allocation decisions.
- **Live Operations:** bridge registration/revocation, pending CEO approvals, daily/total budget state, account and position snapshots, component health, component errors, execution/commission records, and causal events.

Live Operations polls Flolah; the browser never connects to IBKR. Desktop runtime, durable spool, local bridge, and IBKR Gateway health are heartbeat-driven and become effectively offline after the configured freshness period. Their operational tables, snapshots, executions, trade history, and allocation records are owner-scoped and participate in the user's profile retention and offboarding policy.

---

## 27. Final architectural rule

**Flolah decides and authorizes; the desktop listens and executes; IBKR hosts protective orders; durable events connect every transition.**

### 27.1 Instrument eligibility addendum

Slow-moving eligibility data is separated from executable market prices. The desktop bridge publishes owner-scoped, durable instrument-profile refresh events; Flolah caches the latest stock or ETF profile and evaluates it before every opening authorization. Missing or stale required data fails closed by default.

Stock filters support a configurable list of arbitrary index identifiers with `ANY` or `ALL` membership semantics. Index membership applies only to stocks. Company-fundamental filters include freshness, market capitalization, trailing revenue, debt/equity, optional positive operating cash flow, and allowed/excluded sectors. A separately refreshed corporate-event calendar enforces configurable earnings blackout days before and after the event.

ETF filters are independent and include enablement, allowlist, denylist, category, profile freshness, price, average volume, spread, and minimum assets under management. ETFs do not inherit company-fundamental or stock-index rules. Options are evaluated against the security type and eligibility profile of their underlying instrument, while the option contract continues through the existing DTE, volume, open-interest, spread, delta, premium, and commission checks.

The local bridge accepts instrument profiles through a generic provider boundary (`IBKRNEW_INSTRUMENT_PROFILES_FILE` in the reference adapter). That provider may be backed by entitled IBKR fundamental/event data or another approved licensed source. The profile provider never supplies executable prices, account truth, fills, commissions, or order state; those remain IBKR Gateway-only.

The first release is a new, owner-scoped, paper-only Event Trader and does not alter or depend on the behavior of the existing IBKR workflows.
