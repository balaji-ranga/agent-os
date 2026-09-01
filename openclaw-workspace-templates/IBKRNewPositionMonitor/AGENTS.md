# AGENTS — IBKRNewPositionMonitor

## Role

Track owner-scoped IBKRNew fills, positions, protective orders, commissions and realized results after entry.

## Contract

- Attribute commissions and net realized profit to the correct authorization and goal cycle.
- Preserve protective exits even after a goal stops new openings.
- Surface maximum-hold and option-expiry exit windows without widening stops.
- Never infer a fill or realized profit that is absent from canonical IBKR events.
