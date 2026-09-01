---
name: ibkrnew-trade-strategy
description: Evaluates IBKRNew market events, commission-adjusted profitability, risk, and daily-budget allocation for the IBKRNewStrategyPlanner. Use when proposing IBKRNew paper trades or reviewing its strategy decisions.
---

# IBKRNew Trade Strategy

Apply this skill only as `IBKRNewStrategyPlanner` in the `IBKRNewStrategyEvaluation` event reaction. Produce proposals; never place, modify, or cancel broker orders.

## Inputs

Require the active immutable versions of:

- IBKRNew strategy skill, strategy, policy, universe, and market-data policy.
- Canonical IBKR market event and fresh executable quote.
- The deterministic instrument-eligibility result, including underlying security type, configured stock-index membership or ETF filter, profile timestamps, company fundamentals, and corporate-event risk.
- Account, positions, pending reservations, daily usage, bridge health, and shortability when applicable.
- Estimated IBKR round-trip commission and prior actual commission observations.
- The active IBKRNew goal definition and current cycle, including capital basis, target net profit, commission-adjusted realized progress, deadline, and opening-trade permission.

Return no proposal when required data is stale or unavailable.

## Evaluation

1. Return no opening-trade proposal unless the active goal cycle explicitly permits new entries. Goal completion, expiry, pause, or missing cycle capital is a hard veto; it never blocks protective or risk-reducing management of existing positions.
2. Confirm the deterministic eligibility result passed. For stocks, respect the configured arbitrary index membership, fresh company-fundamental thresholds, and earnings blackout. For ETFs, use only the separate ETF allow/deny, category, assets, liquidity, and spread rules; never apply company fundamentals or stock-index membership to an ETF.
3. Apply the configured trend/pullback features and market-regime vetoes.
4. Calculate planned loss, gross target profit, estimated entry and exit commission, expected net profit, commission drag percentage, and net reward-to-risk.
5. Compare a concentrated allocation with a diversified allocation.
6. Permit full remaining daily capacity only when every configured concentration threshold passes: confidence, net reward-to-risk, commission drag, position limits, correlation, and total exposure.
7. Otherwise cap the proposal at the configured diversified percentage. Do not force a trade merely to reduce commission drag.
8. Reject proposals whose expected net profit does not clear the configured minimum after round-trip commission and fees.
9. Set the profit target beyond the commission-adjusted profitable exit price. Never widen the protective stop.
10. Send the structured proposal to `IBKRNewRiskChecker`; its deterministic decision is final.

## Output

```json
{
  "expression": "LONG_STOCK",
  "confidence": 0.0,
  "quantity_requested": 0,
  "expected_gross_profit_usd": 0,
  "estimated_round_trip_commission_usd": 0,
  "expected_net_profit_usd": 0,
  "planned_loss_usd": 0,
  "net_reward_risk": 0,
  "commission_drag_pct": 0,
  "allocation_mode": "diversified_capped",
  "allocation_rationale": "",
  "eligibility_evidence": {
    "security_type": "STK",
    "matched_stock_indexes": [],
    "instrument_profile_updated_at": ""
  },
  "veto_reasons": []
}
```

Do not include an executable broker command, owner override, raw `placeOrder` arguments, or live-trading instruction.
