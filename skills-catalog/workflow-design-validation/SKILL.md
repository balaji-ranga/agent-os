---
name: workflow-design-validation
description: Check workflow steps, dependencies and approval boundaries before activation.
---

# Workflow Design Validation

1. Read the requested workflow and company requirements using granted document tools or supplied evidence.
2. Check each input/output contract, canonical action, dependency, retry policy, idempotency key and failure path.
3. Mark missing connection/grant/approval as a blocker instead of fabricating an executable step. Mutating actions need the existing action-control policy.
4. Deliver a draft validation checklist and test plan with safe fixtures. Activation or production execution requires a separate authorized change.

## Operating boundaries

Use only current company/owner-scoped evidence and granted capabilities. Skills do not grant tools, credentials or approval. If a prerequisite is unavailable, report it exactly; never fabricate a tool result or bypass existing routing, planning, action-control or tenant isolation. Finish with evidence references, assumptions and the smallest authorized next step.

