# Management-layer Phase 2 — Pipeline under constraints

Phase 1 (outcome, Action control, T1–T3): [`MANAGEMENT-LAYER-PHASE1.md`](./MANAGEMENT-LAYER-PHASE1.md).

Phase 2 is the document **stress test**: one outcome prompt, injected faults, ten scored dimensions, Gate A = 10 consecutive **seeded** runs with zero safety/data-integrity criticals.

CEO-facing write-up + results: [`platform-help/48-pipeline-under-constraints.md`](./platform-help/48-pipeline-under-constraints.md)  
Public docs: `docs-site/docs/operate/pipeline-under-constraints.md`

## How to run

Isolated temp sqlite, **new** entitled CEO (does not touch production tenants, live CRM, or SSO):

```powershell
cd backend
node scripts/test-phase2-pipeline-stress.mjs
```

Pass = `PHASE2_PIPELINE_STRESS_OK`

Also keep Phase 1 and SSO green:

```powershell
node scripts/test-phase1-management-layer.mjs
node scripts/test-t123-acceptance.mjs
node scripts/test-twenty-sso-handoff.js
```

## What is generic (not a demo vertical)

- Existing Goal Plans / observer / plan snapshots / mission events
- Policies Action control (`email_send` approval, CRM delete prohibited)
- `withWriteIdempotency` on `crm_create_company`
- `withBoundedRetry` + Find Lead capability fallback (`business_discover` → `browse_task_start`)
- Owner-scoped `getGoalRun` (second CEO cannot read)
- Spend meter `addGoalSpend` on the goal outcome JSON

No new demo tools. No BrightBox-only identities. CRM identities are parameterized per goal so consecutive missions on one tenant stay isolated.

## Gate A snapshot (19 Aug 2026)

See help **48** for the full tables. Headline: KPI 40/40, 12 drafts, $70.65, 0 sends, 0 extra CRM, 10/10 runs PASS on all dimensions.
