---
title: Performance Reviews
---

# Performance Reviews

**Reviews** turns execution evidence and CEO feedback into controlled improvements for your AI company. It evaluates the COO and every contributing specialist—not only the agent that originated a goal.

## Review journey

1. **Review outcomes** collects successful, failed, retried, blocked, and delegated work for the selected weekly or monthly period.
2. **Feedback & analysis** lets the CEO select evidence, add feedback, and request the COO's independent assessment. A disagreement must refer to something the CEO actually said; it is never inferred from an operational failure alone.
3. **Improvement plan** shows the proposed behaviour change, its target agent, expected effect, and rollback point. The CEO makes the final decision.
4. **Agent learnings** shows historical feedback, the latest compact learning summary, and active playbook rules for each AI employee.
5. **Finish review** closes the period. The primary action returns to **Initiate review** for the next eligible period.

## How improvements reach an agent

Approved changes are stored for your company and target AI employee. The platform supplies the current compact learning summary and applicable active playbook rules when that agent starts relevant work. Full historical feedback remains available for review but is not repeatedly inserted into every prompt.

You can override or remove an active rule, regenerate the summary, or roll back to a prior version. A rollback changes which version is active, so the withdrawn rule is no longer supplied to future agent sessions. The audit history remains visible.

## Scope and cost

Review data, feedback, playbooks, summaries, and APIs are owner-scoped. One CEO cannot read or modify another company's reviews. When Efficiency mode is enabled, suitable summarisation work can use the configured local Ollama model; execution-critical decisions and policy enforcement remain deterministic or use the configured platform model as appropriate.

