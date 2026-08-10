# CRM & ERP Maker/Checker coordination (Option 1)

## Purpose

Keep **risk control** without hard CRM tool locks (v1). ERP already has a **hard submit gate** (only ERP Checker may `erp_submit_doc` / `erp_cancel_doc`). CRM high-risk work uses **Kanban as the case file**; optional workflows **automate** the runbook.

**Org sync** (`crm_sync_org` / `erp_sync_org`) is **optional** directory bootstrap (Flolah departments + AI employees → CRM people / ERP departments). Skip unless you need that roster in the desk.

## Roles

| Role | ERP | CRM (Twenty or ERPNext Sales) |
|------|-----|-------------------------------|
| **Maker A/B** | Draft create/update (quotes, invoices, stock, …). **Never submit/cancel.** | Day-to-day pipeline create/update. For **high-risk** changes open Checker Kanban before treating work as done. |
| **Checker** | Review drafts; **only role with submit/cancel**. Kanban approve or reject with findings. | Review high-risk CRM proposals; reject with findings or approve Maker to apply / confirm quality. |
| **COO** | List/get/report (read-only entitled tools). Create/route Kanban; trigger optional workflows. No submit. | Same |
| **CEO** | Policy, exceptions, desk SSO when preferred | Same |
| **Platform Help** | Product how-to from RAG only — never live books | Same → ask COO/CRM/ERP agents for data |

## Kanban protocol (control plane)

One **card per business object** (e.g. doctype + name, or CRM opportunity id).

1. **Maker** drafts (ERP tools / CRM tools).  
2. Ready for gate → **`kanban_create_task`** assigned to **Checker**  
   - Title: `[ERP] Submit SI-…` or `[CRM] Review high-risk …`  
   - Description: object id, summary, risks, draft evidence.  
3. **Checker** reviews with list/get tools.  
   - **Approve ERP:** `erp_submit_doc` / cancel as needed; move card completed.  
   - **Reject:** comment `FINDING: …`; reassign or create card for **Maker**.  
4. **Maker** fixes → reassign Checker.  
5. **Max ~3** reject cycles → `notify_ceo` / reassign COO.

High-risk CRM examples (process gate): stage **Won** over a large amount; merge/delete company; bulk stage change; “create ERP customer + quotation from this opp”.

Low-risk CRM: notes, early-stage updates — Maker may finish without Checker.

## Optional workflow templates

Published per company after Business Core prefab agents exist:

| Workflow | Chat phrase (example) | What it does |
|----------|----------------------|--------------|
| **ERP: draft → check → post** | `run erp maker checker` | Maker agent drafts/prepares; Checker agent reviews (JSON decision); on reject Maker revises (1 retry); on approve Checker posts when applicable. Writes Kanban along the way. |
| **CRM: high-risk → check** | `run crm maker checker` | Same shape for high-risk CRM proposals (no ERP submit). |

Workflows **complement** Kanban: schedule, batch, max loops, audit trail. They do **not** replace the board as source of truth for “who owns SI-42.”

Max reject rounds in-graph: **1 fix cycle** then escalate CEO (keep cost bounded). Hand-driven Kanban still allows longer back-and-forth.

## COO readonly

COO may call company-scoped **list/get/report** CRM and ERP tools (and optional org sync). COO **must not** create invoices/submit books. Use Kanban or workflows to hand off to Maker/Checker.

## What Option 2 would add later

Hard-deny high-risk CRM write tools on Makers (Checker-only apply). Ship only if Option 1 is skipped in practice.

## Related

- Business Core setup: [32-business-core-crm-erp.md](./32-business-core-crm-erp.md)  
- Workflow certify analogy: [13-workflow-autonomous-certify.md](./13-workflow-autonomous-certify.md)  
- Tier A product help excerpts: [39-erpnext-help-tier-a.md](./39-erpnext-help-tier-a.md), [40-twenty-crm-help-tier-a.md](./40-twenty-crm-help-tier-a.md)