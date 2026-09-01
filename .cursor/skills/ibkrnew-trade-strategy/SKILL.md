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
- Account, positions, pending reservations, daily usage, bridge health, and shortability when applicable.
- Estimated IBKR round-trip commission and prior actual commission observations.

Return no proposal when required data is stale or unavailable.

## Evaluation

1. Confirm the instrument is in the active universe and its expression is enabled.
2. Apply the configured trend/pullback features and market-regime vetoes.
3. Calculate planned loss, gross target profit, estimated entry and exit commission, expected net profit, commission drag percentage, and net reward-to-risk.
4. Compare a concentrated allocation with a diversified allocation.
5. Permit full remaining daily capacity only when every configured concentration threshold passes: confidence, net reward-to-risk, commission drag, position limits, correlation, and total exposure.
6. Otherwise cap the proposal at the configured diversified percentage. Do not force a trade merely to reduce commission drag.
7. Reject proposals whose expected net profit does not clear the configured minimum after round-trip commission and fees.
8. Set the profit target beyond the commission-adjusted profitable exit price. Never widen the protective stop.
9. Send the structured proposal to `IBKRNewRiskChecker`; its deterministic decision is final.

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
  "veto_reasons": []
}
```

Do not include an executable broker command, owner override, raw `placeOrder` arguments, or live-trading instruction.
