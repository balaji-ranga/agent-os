# Twenty CRM SME (Flolah — Platform Help + Maker/Checker)

**Audience:** CEOs (how-to) and **CRM Maker / CRM Checker** AI employees (domain decisions).  
**Live pipeline data** still belongs to COO / CRM Maker / CRM Checker — this file is the **product + SME playbook**, not a live report.  
Setup and isolation: [32-business-core-crm-erp.md](./32-business-core-crm-erp.md). Coordination: [38-maker-checker-coordination.md](./38-maker-checker-coordination.md). ERP books: [39-erpnext-help-tier-a.md](./39-erpnext-help-tier-a.md).

**Vendor docs (concepts):** [Twenty user guide — data model](https://docs.twenty.com/user-guide/data-model/overview), [objects](https://docs.twenty.com/user-guide/data-model/capabilities/objects), [sales pipeline](https://docs.twenty.com/user-guide/views-pipelines/how-tos/set-up-a-sales-pipeline), [glossary](https://docs.twenty.com/user-guide/getting-started/capabilities/glossary). Flolah agents use **`crm_*` tools** (and MCP `mcp-flolah-crm`) against the **company Twenty workspace**, not the public Twenty UI APIs directly.

You are a **domain SME** for this company’s sales process. Operate **Lead → Prospect → Qualified opportunity → Proposal → Won → Order (ERP)**. Do not invent a second CRM, extra stages, or invoices inside Twenty.

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

## Business language → Twenty (Lead to Order)

CEOs and sales talk in **lead / prospect / customer / quote / order**. Map them; do not create extra objects.

| Business term | On Flolah Twenty | Next commercial step |
|---------------|------------------|----------------------|
| **Lead** (unqualified enquiry) | Opportunity stage **NEW** via `crm_create_lead` + Person (+ Company if B2B) | Screen fit |
| **Prospect** (being qualified) | Same opportunity at **SCREENING** or **MEETING** | Prove need, budget, authority, timing |
| **Qualified opportunity / deal** | **QUALIFIED** or **PROPOSAL** (`crm_create_deal` starts at PROPOSAL) | Priced offer |
| **Quote / proposal** | Opportunity **amount** + stage **PROPOSAL**; note the offer | Legal quote lives in **ERPNext Quotation** when books exist |
| **Customer (relationship)** | **Company** + **Person** (`company_id`) | Still pipeline until Won |
| **Customer (books)** | **ERPNext Customer** — not a Twenty object | Created on CRM→ERP handoff |
| **Order** | **Not in Twenty.** ERPNext **Sales Order** (then Delivery / Invoice / Payment) | After Checker + `run erp maker checker` |
| **Won customer** | Opportunity **WON** / **CLOSED_WON** | Handoff to ERP if billing/fulfilment is needed |
| **Lost** | **LOST** / **CLOSED_LOST** + note with reason | Do not delete the Company/Person |

**One live deal = one open Opportunity.** A new SKU/contract for the same account can be a second Opportunity. A second “lead” for the same enquiry is a duplicate — skip or merge via Checker delete protocol.

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
- Log work in **notes** and **tasks** (next call, send quote, wait for CEO gate). Pipeline without activity is stale.

---

## Pipeline stages (Flolah)

Twenty pipelines are a **Kanban of Opportunities**; columns come from the Opportunity **Stage** field. Flolah tools send stages in **UPPERCASE**.

| Stage | Business meaning | Maker does | Advance when |
|-------|------------------|------------|--------------|
| **NEW** | Fresh enquiry / BD handoff / `crm_create_lead` | Dedup; capture Company+Person; first note | You know who they are and there is a real ask |
| **SCREENING** | Qualify (need, budget, authority, timing) | Ask/record BANT-style facts in notes | Fit is yes, no, or needs a meeting |
| **MEETING** | Conversation scheduled or held | Task for the meeting; note outcomes | Ready to price or disqualify |
| **PROPOSAL** | Quote/offer sent (`crm_create_deal` default) | Amount from **ORG.md / Master Data price list** — never invent catalog | Customer is reviewing a real number |
| **QUALIFIED** | Confirmed good-fit, still open | Keep amount honest; follow-up tasks | Commercial next step (proposal or Won path) |
| **WON** / **CLOSED_WON** | Closed won | **High-risk** if amount is material → CRM Checker, then ERP order path | Customer committed; books/fulfilment if needed |
| **LOST** / **CLOSED_LOST** | Closed lost | Note reason (price, timing, competitor, no fit) | Do not reopen as a new lead without a new enquiry |

`crm_list_leads` returns opportunities in **NEW / SCREENING / MEETING / PROPOSAL / QUALIFIED** (and missing stage). Won/Lost are **not** leads.

**5–7 stages is enough.** Do not invent extra stages unless the CEO’s workspace already has them (`crm_list_opportunities` to see live values). If a stage patch fails, list first and reuse an existing stage string.

**Do not skip NEW → WON** on a first contact unless the CEO already has a signed deal and asks to capture it. Screening exists so you do not pollute Won or ERP.

---

## End-to-end process (Lead → Prospect → Order)

Operate this cycle. Tools in parentheses.

### 1. Capture (Lead)

Real enquiry only (website, chat, WhatsApp, Business Discovery Act, CEO ask). **Never invent customers to fill the pipeline.**

1. `learnings_summary` (`topic`: CRM / customer / discount).
2. `master_data_rag` query `Twenty CRM lead prospect opportunity order process stages` when the decision is non-trivial.
3. **Dedup:** `crm_list_companies` / `crm_list_people` / `crm_list_leads` (name, email, domain, locality). Knowledge **`discovered_opportunities`**: skip `previously_identified` or `handed_to_crm`.
4. Create **Company** (B2B) → **Person** (`company_id`) → **Opportunity** at **NEW** (`crm_create_lead`). Consumer: Person + Opportunity.
5. Note source and ask. Task for first follow-up if you are not quoting now.

### 2. Qualify (Prospect)

Move **NEW → SCREENING** (and **MEETING** when a call/visit is real).

Record in notes (as known — do not invent):

- **Need** — what they want vs catalog
- **Budget** — band vs list price (ORG.md / Master Data)
- **Authority** — who signs
- **Timing** — when they need it

**No fit / no budget / no authority:** **LOST** with reason, or leave at SCREENING with a future task. Do not create ERP Customer yet.

### 3. Propose (Deal)

Move to **PROPOSAL** (`crm_create_deal` or `crm_update_opportunity`). Set **amount** from company price list.

- Discount **within** policy (often ≤3%): Maker may continue.
- Discount **above** policy: `needs_ceo` on **run crm maker checker** (workflow CEO Approval) — not a free-form “Approved” Kanban.

Twenty amount is a **pipeline number**. A customer-facing / auditable quotation is **ERPNext Quotation** after Checker when ERP is on.

### 4. Commit (Won)

Material **WON**: CRM Checker Kanban `[CRM] Review high-risk …` (opportunity id, amount, evidence). Low-value / CEO-explicit small close: Maker may stage Won after listing the record.

Won in CRM **is not an order**.

### 5. Order and cash (ERP)

Twenty = **pipeline SoR**. ERPNext = **books SoR**.

When the deal is ready to quote/bill/fulfil:

1. Do **not** invent GL, invoices, or stock in CRM.
2. Checker Kanban if high-risk, then COO/goal plan **`run erp maker checker`** with CRM ids (company name, person, amount, SKU).
3. ERP Maker drafts **Customer → Quotation → Sales Order** (then Delivery / Invoice / Payment per **39**). **ERP Checker** submits.

Never mark CRM “Won + invoiced” unless ERP documents exist (or CEO explicitly wants CRM-only close).

### 6. After-sale

- Expansion: **new Opportunity** on the same Company, not a fake new lead.
- Lost-and-return: new enquiry → new Opportunity; reuse Company/Person.
- Bad duplicates: Maker proposes delete; **Checker** runs `crm_delete_*`.

---

## Prefab AI employees

When Profile **CRM = Twenty** (or ERPNext sales CRM):

| Role | Does | Does not |
|------|------|----------|
| **CRM Maker A** | Capture accounts/contacts/pipeline; Lead→Prospect→Proposal; execute low-risk updates; **propose** duplicate deletes on Kanban | Treat large Won / merge-delete / bulk / ERP handoff as done without Checker; call `crm_delete_*` |
| **CRM Maker B** | Enrichment, research, follow-ups, notes/tasks; keep stages honest | Same high-risk gate |
| **CRM Checker** | Review high-risk proposals on Kanban; list/get for audit; **execute** `crm_delete_person` / `crm_delete_company` | Mutate pipeline as the default path; invent live numbers |

When **CRM = ERPNext**, same Maker/Checker protocol uses Sales-side `erp_*` (or `crm_*` facade): **Lead → Opportunity → Customer → Quotation → Sales Order**. Desk: ERPNext `/app/crm`. Object map: people=Contact, companies=Customer, opportunities=Opportunity, leads=Lead. Stages on the facade may be ERPNext **sales_stage** strings (e.g. Prospecting / Proposal) — **list first**, then reuse live values. Billing still needs ERP Checker submit (**39**).

**COO** has **read-only** list tools to report and **delegate**. **Platform Help** answers from this doc + **32** + **38**; never calls live `crm_*`.

---

## Intake playbook (Maker)

On a real enquiry (website, chat, Business Discovery Act, CEO ask):

1. Call **`learnings_summary`** (`topic`: CRM / customer / discount as relevant).
2. Call **`master_data_rag`** with keywords from this file (`Twenty CRM lead prospect opportunity order process stages`) when the decision is non-trivial (duplicates, stage, discount, ERP handoff).
3. **Dedup before create:**
   - `crm_list_companies` / `crm_list_people` / `crm_list_leads` (name, email, domain, locality).
   - Knowledge table **`discovered_opportunities`** when the card came from Business Discovery — skip `previously_identified` or `handed_to_crm`.
4. Create **Company** (if B2B) → **Person** (with `company_id`) → **Opportunity** at **NEW** (or **PROPOSAL** if a priced offer is already going out).
5. If pricing is known, create/update the opportunity **amount** from **company price list / Master Data** — never invent catalog prices.
6. Reply with ids + next step (follow-up task, qualification, quotation, Checker Kanban, ERP order).

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
3. ERP Maker creates **Customer / Quotation / Sales Order** as **drafts**; **ERP Checker** submits. Fulfilment: Delivery Note (goods) → Sales Invoice → Payment Entry (**39**).

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
4. “How do I submit an invoice / raise an order?” → **ERP**, not Twenty — **39** + ERP Checker.

## Tips for CRM Maker / Checker

1. You are a **CRM SME**. Own **Lead → Prospect → Proposal → Won → ERP Order**. Prefer this doc + **DOMAIN.md** + `master_data_rag` over guessing Twenty semantics. `master_data_rag` already includes this Flolah Help file (`corpus=platform-help`) — do not say you lack Twenty CRM help docs.
2. List before create. Dedup. Link Person→Company→Opportunity. One open opp per live deal.
3. Stages UPPERCASE; leads = early opportunities. Qualify before Won.
4. High-risk → Checker Kanban. Discounts → company policy / `needs_ceo`. Orders → ERP, not CRM invoices.
5. Never spoof `ceo_user_id`. Tools are session-scoped to this CEO’s workspace.
