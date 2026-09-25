# Northstar Industrial OKR Company Demo Seed Pack

**Pack:** `northstar-industrial-okr-demo`

**Version:** `1.0.0`

**Purpose:** create a repeatable Flolah demonstration in which company objectives drive goals, workflows, AI employees, CRM, ERP, CEO reporting, Action Control, and agent budgets.

The canonical machine-readable manifest is
`backend/src/services/demo-seed-packs/northstar-industrial.v1.json`. The operator entry point is
`backend/scripts/northstar-okr-demo-seed.js`. This document is the knowledge-base contract and production runbook.

## What the pack creates

The fictional company is **Northstar Industrial Supplies Pte. Ltd.**, a Singapore B2B distributor. All contacts, messages, domains, transactions, and evidence are synthetic. Email addresses use the reserved `.example` domain.

| Area | Seeded state |
|---|---|
| Company | CEO Maya Tan, Singapore profile, autonomous management style, Twenty-preferred CRM + ERPNext selected |
| People | Daniel Lim (Sales Ops) and Aisha Rahman (Finance Controller), disabled synthetic logins |
| Organization | Existing COO plus 8 pack-owned AI employees across Sales, Customer, Finance, and Operations |
| Budgets | 6.2M monthly tokens total; per-agent token and error budgets |
| Objectives | FY2026 annual objective; completed Q1/Q2, active Q3, draft Q4 |
| Goals | 4 active scheduled goals bound to the Q3 objective and key-result evidence |
| Key results | Revenue, gross margin, qualified pipeline, DSO, and OTIF |
| Workflows | 7 multi-node, multi-agent workflows tied to Q3 key results |
| Knowledge | 7 evidence tables: CRM accounts/contacts/opportunities, ERP customers/suppliers/invoices, OKR measurements |
| CRM | Optional live mirror: 12 companies, 20 people, 12 opportunities. Twenty is preferred; ERPNext Sales CRM is the automatic fallback when a dedicated Twenty workspace cannot be provisioned. |
| ERP | Optional live ERPNext mirror: 6 customers, 3 suppliers, 8 items, 3 draft invoices |
| Policies | Read, internal writes, and external communication autonomous; financial/destructive actions prohibited |
| WhatsApp | CEO operating pattern documented; device QR/pairing is intentionally not automated or copied |

## Safety and isolation contract

- Use a dedicated demo CEO. Seeding a non-demo CEO is refused unless the operator explicitly passes `--allow-existing-owner`.
- Every created resource has a stable pack namespace or exact provider ID in `demo_seed_pack_installs`.
- Local cleanup always includes `owner_user_id`; it cannot delete another tenant's data.
- External cleanup uses only the exact Twenty/ERPNext IDs recorded during the install.
- A full Twenty workspace never gets deleted or recycled automatically. When the platform workspace ceiling is reached, the pack safely selects ERPNext CRM and records that choice as `external.crm_backend` with an `external_warnings` entry.
- Cleanup requires `--confirm-owner` equal to the target CEO ID.
- Cleanup retains the CEO account, Twenty workspace, ERPNext company, credentials, `.env` files, and any standard ERPNext foundation fixtures initialized on a minimal site (supplier group, opportunity type, and sales stages). This makes reseed safe and prevents provider damage or credential loss.
- The pack never stores, prints, or copies API keys, passwords, WhatsApp sessions, or provider secrets.
- A newly created demo CEO receives a random discarded password. Use Admin **View as user** or the normal password-reset flow.
- Live CRM/ERP failures are reported as `external_errors`; the complete in-platform evidence dataset still exists in Knowledge.
- Financial/destructive actions remain prohibited. The demo never posts payments, deletes live business records outside its ledger, or changes security settings.

## Operator commands

Run these inside the backend container or from `backend/` with production environment variables already loaded. Do not copy or replace `.env`.

### VPS copy/paste commands

These commands run the packaged operator CLI through the deployed backend container. They do not load, copy, or replace an `.env` file.

```bash
cd /opt/agent-os/deploy

# Preview the resource plan without writing data
docker compose exec -T backend npm run demo:northstar-okr -- \
  --mode preview

# Show the current installation ledger and resource IDs
docker compose exec -T backend npm run demo:northstar-okr -- \
  --mode status \
  --owner-email maya.tan@northstar-demo.example

# First installation only: create the dedicated CEO and seed the pack
docker compose exec -T backend npm run demo:northstar-okr -- \
  --mode seed \
  --create-owner \
  --owner-email maya.tan@northstar-demo.example \
  --owner-name "Maya Tan"

# Remove only records held in this pack's exact installation ledger
docker compose exec -T backend npm run demo:northstar-okr -- \
  --mode cleanup \
  --owner-email maya.tan@northstar-demo.example \
  --confirm-owner ceo-maya-tan-6a2232

# Confirmed cleanup followed by a fresh seed
docker compose exec -T backend npm run demo:northstar-okr -- \
  --mode reseed \
  --owner-email maya.tan@northstar-demo.example
```

The current VPS demo CEO ID is `ceo-maya-tan-6a2232`. On another installation, run Status first and replace the `--confirm-owner` value with that environment's returned CEO ID. Cleanup refuses to run when the confirmation does not exactly match the resolved owner.

The shorter commands below are equivalent when the shell is already inside the backend container or is running from `backend/` with the production environment loaded.

### Preview only

```bash
npm run demo:northstar-okr -- --mode preview
```

### Create the dedicated CEO and seed

```bash
npm run demo:northstar-okr -- \
  --mode seed \
  --create-owner \
  --owner-email maya.tan@northstar-demo.example \
  --owner-name "Maya Tan"
```

Use `--skip-external` for an in-platform-only seed when Twenty or ERPNext is unavailable.

### Status

```bash
npm run demo:northstar-okr -- \
  --mode status \
  --owner-email maya.tan@northstar-demo.example
```

### Cleanup

Resolve the CEO ID from Status or Admin User Insights, then pass it twice:

```bash
npm run demo:northstar-okr -- \
  --mode cleanup \
  --owner-id CEO_ID \
  --confirm-owner CEO_ID
```

Cleanup is retryable. If an external provider is temporarily unavailable, the install remains `cleanup_partial` with exact pending resources. Restore the provider and run cleanup again. Use `--skip-external` only when intentionally retaining external demo records.

### Clean and reseed

```bash
npm run demo:northstar-okr -- \
  --mode reseed \
  --owner-id CEO_ID
```

Reseed performs confirmed cleanup followed by a fresh seed. It reuses the CEO and provider workspaces, creates a new install ID, and uses new idempotency keys for external writes.

## Demo narrative

The annual objective is to grow from S$1.8M to S$2.4M revenue, improve gross margin from 31% to 35%, reduce DSO from 48 to 35 days, and improve OTIF from 92% to 97%. The active Q3 objective targets S$650k revenue, S$1.6M qualified pipeline, DSO at or below 38 days, and OTIF at or above 96%.

The CEO can ask the COO in Home or WhatsApp:

- “Give me the Q3 objective health, evidence, blockers, and next actions.”
- “Run the weekly OKR control tower using only Northstar demo data.”
- “Which opportunities can close the revenue gap without reducing margin?”
- “Which overdue invoices and fulfilment exceptions threaten DSO and OTIF?”

The COO delegates to the relevant AI employees. The objective-linked scheduled goals and workflows write evidence back to the objective. Per-agent budgets can warn or block execution. Action Control permits autonomous reads, internal writes, and synthetic external communications while continuing to prohibit financial/destructive operations.

## Verification

Automated lifecycle test:

```bash
npm run test:northstar-okr-demo-seed
```

It validates the manifest, seeds an isolated database, checks objective/workflow/agent/table/policy counts, verifies a second seed is idempotent, rejects a wrong-owner cleanup confirmation, cleans, reseeds, and cleans again.

ERPNext company/session isolation test:

```bash
npm run test:erpnext-company-session-isolation
```

It validates company-scoped SSO permissions, self-User permission scoping, and CRM/ERP list-route isolation without requiring live provider credentials.

After a VPS seed, verify:

1. Admin User Insights shows Maya Tan and **View as user** works.
2. My Org shows the two humans and eight Northstar AI employees under the existing COO.
3. Objectives shows FY2026 and Q1–Q4 with Q3 active.
4. Goals shows four active scheduled goals linked to the Q3 objective and key results.
5. Workflows shows seven published multi-node Northstar workflows.
6. Knowledge shows seven `demo_northstar_*` tables.
7. Efficiency Agent View shows all eight budgets.
8. Policies shows External messages/publish = Autonomous and Financial/destructive = Prohibited.
9. CRM shows 12 Northstar opportunities in the selected live backend; ERPNext fallback opens the Sales CRM list without a client-side `?company=` filter.
10. ERP shows three Northstar Sales Invoices for the bound company.
11. Status identifies `twenty` or `erpnext` as the live CRM backend and reports any external warning or error.
12. Channels explains that WhatsApp still needs the CEO to pair a device; no session secret is seeded.

## Rollback

Code rollback checkpoint: Git tag `rollback/pre-northstar-okr-demo-pack-20260925`.

Production backend image rollback checkpoint: `agent-os-backend:rollback-pre-northstar-okr-demo-e9539a7`.

Data rollback is the pack cleanup command. It restores the prior company strategy, Business Core provider selection, and Action Control family modes captured at install time, while retaining the CEO account and provider workspaces.
