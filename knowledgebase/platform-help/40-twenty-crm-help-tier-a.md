# Twenty CRM SME (Flolah — Platform Help + Maker/Checker)

**Audience:** CEOs (how-to) and **CRM Maker / CRM Checker** AI employees (domain decisions).  
**Live pipeline data** still belongs to COO / CRM Maker / CRM Checker — this file is the **product + SME playbook**, not a live report.  
Setup and isolation: [32-business-core-crm-erp.md](./32-business-core-crm-erp.md). Coordination: [38-maker-checker-coordination.md](./38-maker-checker-coordination.md). ERP books: [39-erpnext-help-tier-a.md](./39-erpnext-help-tier-a.md).

**Vendor docs (concepts):** [Twenty user guide — data model](https://docs.twenty.com/user-guide/data-model/overview), [objects](https://docs.twenty.com/user-guide/data-model/capabilities/objects), [sales pipeline](https://docs.twenty.com/user-guide/views-pipelines/how-tos/set-up-a-sales-pipeline), [glossary](https://docs.twenty.com/user-guide/getting-started/capabilities/glossary). Flolah agents use **`crm_*` tools** (and MCP `mcp-flolah-crm`) against the **company Twenty workspace**, not the public Twenty UI APIs directly.

---

## What Twenty holds on Flolah

Each CEO company maps to **one Twenty workspace**. **CRM** nav SSO opens that workspace only. Standard objects (Twenty + Flolah tools):

| Object | Meaning | Flolah tools |
|--------|---------|--------------|
| **People** | Contacts — individuals (prospects, buyers, partners) | `crm_list_people`, `crm_create_person` |
| **Companies** | Accounts — organizations | `crm_list_companies`, `crm_create_company` |
| **Opportunities** | Deals / pipeline (amount, stage, close date, company, contact) | `crm_list_opportunities`, `crm_create_opportunity`, `crm_update_opportunity` |
| **Leads** | *Not a separate Twenty object* — early-stage opportunities | `crm_list_leads`, `crm_create_lead` (stage **NEW**) |
| **Deals** | Alias of opportunities | `crm_list_deals`, `crm_create_deal` (default stage **PROPOSAL**) |
| **Notes** | Activity notes | `crm_list_notes` |
| **Tasks** | Follow-ups | `crm_list_tasks` |

Also: `crm_status` (bind / workspace health), optional `crm_sync_org` (Flolah roster → CRM people — **skip** for customer pipeline work).

MCP: `mcp-flolah-crm` with header `X-Ceo-User-Id` in workflows.

---

## Data model (SME)

Twenty **objects** are the categories of records. Prefer **People + Companies + Opportunities** for sales (email/calendar sync and Flolah tools only cover these). Do **not** invent custom objects via tools — Flolah `crm_*` is the standard set.

**Relations (do this in order):**

1. **Company** (account) — `name` required; optional `domain_url` / website, `employees`.
2. **Person** — `name` required; optional email, phone, `company_id` linking to the Company.
3. **Opportunity** — `name` required; optional `amount`, `stage`, `company_id`, `close_date`, point of contact.

**Best practices (Twenty + Flolah):**

- One Company per real business. Match on **name + locality / domain / place_id** before create.
- People belong to Companies when the buyer is an organization. Consumer sales may be Person-only.
- One **open** Opportunity per live deal. Do not spawn a second opp for the same enquiry unless it is a distinct SKU/contract.
- Categories (prospect vs partner) are **fields**, not new objects. Use views/filters, not duplicate Companies.
- Amounts: Flolah stores Twenty money as **amountMicros** internally; pass a normal number to `crm_create_opportunity` / `crm_update_opportunity` (e.g. `95` not micros).

---

## Pipeline stages (Flolah)

Twenty pipelines are a **Kanban of Opportunities**; columns come from the Opportunity **Stage** field. Flolah tools send stages in **UPPERCASE**.

| Stage | Use |
|-------|-----|
| **NEW** | Fresh enquiry / Business Discovery handoff / `crm_create_lead` |
| **SCREENING** | Qualifying fit (need, budget, authority) |
| **MEETING** | Conversation scheduled or held |
| **PROPOSAL** | Quote/offer sent (`crm_create_deal` default) |
| **QUALIFIED** | Confirmed good-fit, still open |
| **WON** / **CLOSED_WON** | Closed won — **high-risk** if amount is material |
| **LOST** / **CLOSED_LOST** | Closed lost — record a reason in notes when possible |

`crm_list_leads` returns opportunities in **NEW / SCREENING / MEETING / PROPOSAL / QUALIFIED** (and missing stage). Won/Lost are **not** leads.

**5–7 stages is enough.** Do not invent extra stages unless the CEO’s workspace already has them (`crm_list_opportunities` to see live values). If a stage patch fails, list first and reuse an existing stage string.

---

## Prefab AI employees

When Profile **CRM = Twenty** (or ERPNext sales CRM):

| Role | Does | Does not |
|------|------|----------|
| **CRM Maker A** | Capture accounts/contacts/pipeline; quotations path; execute low-risk updates; **propose** duplicate deletes on Kanban | Treat large Won / merge-delete / bulk / ERP handoff as done without Checker; call `crm_delete_*` |
| **CRM Maker B** | Enrichment, research, follow-ups, notes/tasks | Same high-risk gate |
| **CRM Checker** | Review high-risk proposals on Kanban; list/get for audit; **execute** `crm_delete_person` / `crm_delete_company` | Mutate pipeline as the default path; invent live numbers |

When **CRM = ERPNext**, same Maker/Checker protocol uses Sales-side `erp_*` instead of `crm_*`. Desk: ERPNext `/app/crm`.

**COO** has **read-only** list tools to report and **delegate**. **Platform Help** answers from this doc + **32** + **38**; never calls live `crm_*`.

---

## Intake playbook (Maker)

On a real enquiry (website, chat, Business Discovery Act, CEO ask):

1. Call **`learnings_summary`** (`topic`: CRM / customer / discount as relevant).
2. Call **`master_data_rag`** with keywords from this file (`Twenty CRM people companies opportunities stages`) when the decision is non-trivial (duplicates, stage, discount, ERP handoff).
3. **Dedup before create:**
   - `crm_list_companies` / `crm_list_people` / `crm_list_leads` (name, email, domain, locality).
   - Knowledge table **`discovered_opportunities`** when the card came from Business Discovery — skip `previously_identified` or `handed_to_crm`.
4. Create **Company** (if B2B) → **Person** (with `company_id`) → **Opportunity** at **NEW** (or **PROPOSAL** if a priced offer is already going out).
5. If pricing is known, create/update the opportunity **amount** from **company price list / Master Data** — never invent catalog prices.
6. Reply with ids + next step (follow-up task, quotation, Checker Kanban).

Do **not** invent customers “to populate the pipeline.”

---

## High-risk CRM (Checker process gate)

**Option 1:** Makers may use write tools; **high-risk work is not done** until Checker Kanban (or workflow CEO Approval for policy discounts).

Treat as high-risk:

- Stage to **Won** on a **large** opportunity (material amount vs typical deal / CEO policy)
- Merge / delete company or person (**Maker proposes keep/drop ids on `[CRM] Review delete …`**; **Checker** runs `crm_delete_person` / `crm_delete_company` with `confirm=true`)
- **Bulk** stage or ownership changes
- Handoff that **creates ERP financial documents** (Customer + Quotation / Sales Order / Invoice)
- Discount **> policy** (BrightBox / company: often ≤3% autonomous; >3% needs CEO sales gate; >10% director — follow **ORG.md** / learnings)

**Low-risk (Maker may finish):** notes, tasks, early stages (NEW→SCREENING→MEETING), single contact/company create after dedup, small amount updates.

**Kanban title:** `[CRM] Review high-risk …` assigned to **CRM Checker**. Description: opportunity id, amount, proposed stage, risks, evidence.

Checker: `crm_list_*` / `crm_status` to verify. **Deletes:** `crm_delete_person` / `crm_delete_company` (`confirm=true`), then complete Kanban. Other high-risk: approve Maker to apply, or comment `FINDING: …` and reassign Maker. Max ~3 reject cycles → `notify_ceo` / COO.

**CEO discount HITL:** only via Maker/Checker **workflow CEO Approval** (`needs_ceo` JSON). Free-form “Approved” on invented Kanban does not resume runs. See **38**.

---

## CRM → ERP handoff (order-to-cash)

Twenty is **pipeline SoR**. ERPNext is **books SoR**.

When a deal is ready to quote/bill:

1. Do **not** invent GL lines or invoices in CRM.
2. High-risk: Checker Kanban, then COO/goal plan **`run erp maker checker`** with CRM ids (company name, person, amount, SKU).
3. ERP Maker creates **Customer / Quotation / Sales Order** as **drafts**; **ERP Checker** submits.

Never mark CRM “Won + invoiced” unless ERP documents exist (or CEO explicitly wants CRM-only close).

---

## Org sync (optional)

`crm_sync_org` copies Flolah **departments + AI employee names** into CRM people. It does **not** import customers. **Usually skip.**

---

## CEO how-to (Platform Help)

1. Profile or Company setup → CRM **Twenty** → Save / Apply (prefab Makers/Checker appear).
2. Open **CRM** (`/work` embed) — passwordless SSO into **your** workspace.
3. People / Companies / Opportunities in the desk, or chat **CRM Maker A**.
4. High-risk / Won / ERP billing → **CRM Checker** then ERP Maker/Checker (**38**, **39**).

---

## Tips for Platform Help answers

1. **Answer first** from this doc + **32** + **38** (numbered steps, real labels).
2. Soft-tip **CRM Maker / Checker / COO** only after the how-to if the CEO needs live data or execution.
3. “What deals are open?” → live data: open **CRM** or ask **COO** / Maker — after explaining list tools.
4. “How do I submit an invoice?” → **ERP**, not Twenty — **39** + ERP Checker.

## Tips for CRM Maker / Checker

1. You are a **CRM SME**. Prefer this doc + **DOMAIN.md** + `master_data_rag` over guessing Twenty semantics. `master_data_rag` already includes this Flolah Help file (`corpus=platform-help`) — do not say you lack Twenty CRM help docs.
2. List before create. Dedup. Link Person→Company→Opportunity.
3. Stages UPPERCASE; leads = early opportunities.
4. High-risk → Checker Kanban. Discounts → company policy / `needs_ceo`.
5. Never spoof `ceo_user_id`. Tools are session-scoped to this CEO’s workspace.
