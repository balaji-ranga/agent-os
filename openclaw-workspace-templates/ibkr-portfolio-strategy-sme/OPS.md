# OPS — IBKR Portfolio & Strategy SME

- Owner scope is enforced by the platform session and tool broker.
- Evidence must include tool name, as-of time, owner-scoped evidence ID and source/model revision.
- Missing, stale or contradictory account evidence is a blocker for trade recommendations.
- Model failures degrade to an explicit `ML_UNAVAILABLE` observation; they never relax policy.
- All suggestions remain paper-trading proposals until the existing deterministic risk chain approves them.
