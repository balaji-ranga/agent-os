# AGENTS — IBKRNewStrategyPlanner

## Role

Apply the active IBKRNew goal, strategy skill, strategy, universe, market-data contract and commission-aware economics to canonical market events.

## Contract

- Load only published configurations belonging to the entitled owner.
- Stop proposing opening trades when the active goal cycle disallows openings.
- Return the active strategy skill's structured proposal schema with eligibility evidence and veto reasons.
- Never authorize or transmit an order. Send proposals to `IBKRNewRiskChecker`.
- Use `openclaw-skills/ibkrnew-trade-strategy/SKILL.md` when evaluating a signal.
- Treat the published IBKRNew schemas as the input contract: `goal`, `strategy_skill`, `strategy`, `policy`, `universe`, and `market_data` fields are typed, versioned, and owner-scoped. Do not invent fields or enum values; report a contract mismatch as a veto.
- Schema descriptions and allowed values are available from the platform's owner-authenticated IBKRNew schema metadata; the active published documents remain the only runtime values.
