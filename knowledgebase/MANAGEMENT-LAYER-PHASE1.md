# Management-layer Phase 1 — checkpoint and test cases

**Rollback checkpoint (GitHub `main` before this work):** `6f94d58ecff96bb562267cc743f74b5a4614696d`  
Tag: `checkpoint-pre-phase1-6f94d58`  
Commit: *Document Business Core CRM/ERP env keys in the backend example.* (19 Aug 2026)

```bash
git checkout 6f94d58ecff96bb562267cc743f74b5a4614696d
# or
git checkout checkpoint-pre-phase1-6f94d58
```

Do not use this as a hotfix branch. Restore only if Phase 1 must be reverted.

## One test case per finding

Run from backend:

`node scripts/test-phase1-management-layer.mjs`

| ID | Test case | Pass |
|----|-----------|------|
| **T1** | CEO pipeline prompt persists KPI target 40 / $75 cap; unverifiable step does not increment KPI; “exclude healthcare” snapshots plan v1 → v2. Other CEO cannot read the run. | `PHASE1_MANAGEMENT_LAYER_OK` |
| **T2** | `email_send` blocked without approval; allowed with `ceo_approved`; CRM delete prohibited; same company identity writes once (idempotent replay); HTTP 429 classified as `rate_limit` with browser fallback. | same |
| **T3** | Outcome language maps to Find Lead → `business_discover` and CRM → existing Maker/Checker phrase (no new tool). | same |
| **N1** | Featured **Revenue Company** pack loads with research + qualification roles and outcome-first channels. | same |
| **N2** | Mission events (`goal_created`, `re_plan`, `policy_decision`) exist for the owner; other owner sees none. | same |
| **N3** | CEO help (`01-getting-started`, `03-dashboard-agents-chat`, `10-policies-guardrails`) tells the CEO to give the COO the outcome first; they do not say to open Workflow Builder first. Public docs-site matches. | same |

## What shipped (generic)

- Outcome + observer + plan versions on existing `agent_goal_runs` (Goal Plans / Digest).
- Action control on **Policies** (Autonomous / Approval required / Prohibited) enforced on tool invoke.
- Write idempotency on CRM create (Twenty and ERPNext CRM façade).
- Capability aliases over existing tools/workflows.
- Revenue Company industry pack.
- Owner-scoped `goal_mission_events`.

No demo-only tools. All list/get/mutate paths stay CEO-entitled.

## Document acceptance (T1 T2 T3)

Run from backend (temp sqlite, no live CRM/ERP, does not touch SSO):

`node scripts/test-t123-acceptance.mjs`

Pass = `T123_ACCEPTANCE_OK`

| ID | Document bar | How it is proved |
|----|--------------|------------------|
| **T1** | 30 management goals, ≥80% valid executable plan | `MANAGEMENT_GOAL_BENCHMARK` through existing `planGoalStepsFromText` + `validateExecutablePlan` |
| **T1** | Injected recoverable failures ≥90% recover or escalate; no silent abandon | 429 on a live goal step → retry/switch/escalate + `decision` event |
| **T1** | Completed goal has criteria, evidence, retrospective | `completeGoalRun` writes `outcome.retrospective` |
| **T1** | CEO is exception-based | Accepted/429 = no CEO; auth = escalate |
| **T2** | Scorecard gates | Bounded retry, 0 unapproved sends, CRM create replay, owner-scoped evidence, completion/trace |
| **T3** | Chat lead→CRM→approval→outreach without graph editor | Capability map + existing CRM Maker/Checker phrase |
| **T3** | Provider substitution without changing the goal | `find_lead` stays; executor `business_discover` → `browse_task_start` |
| **T3** | ≥80% standard recipes from NL without node edits | `planRecipePublishFromChat` + graph schema / template id |

CRM/ERP SSO is unchanged (`node scripts/test-twenty-sso-handoff.js`).
