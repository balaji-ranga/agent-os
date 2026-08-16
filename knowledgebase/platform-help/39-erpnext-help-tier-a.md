# ERPNext SME (Flolah — Platform Help + Maker/Checker)

**Audience:** CEOs (how-to) and **ERP Maker A/B / ERP Checker** (and Invoice / P&L / Project specialists) for domain decisions.  
**Live books** still belong to COO (read) and ERP agents (draft/submit roles) — this file is the **product + SME playbook**.  
Setup and isolation: [32-business-core-crm-erp.md](./32-business-core-crm-erp.md). Coordination: [38-maker-checker-coordination.md](./38-maker-checker-coordination.md). Pipeline CRM: [40-twenty-crm-help-tier-a.md](./40-twenty-crm-help-tier-a.md).

**Vendor docs (concepts):** [ERPNext Selling](https://docs.frappe.io/erpnext/user/manual/en/selling), [Buying](https://docs.frappe.io/erpnext/user/manual/en/buying), [Stock](https://docs.frappe.io/erpnext/user/manual/en/stock), [Accounts](https://docs.frappe.io/erpnext/user/manual/en/accounts), [Projects](https://docs.frappe.io/erpnext/user/manual/en/projects), [Customer](https://docs.frappe.io/erpnext/customer), [Quotation](https://docs.frappe.io/erpnext/quotation), [Sales Order](https://docs.frappe.io/erpnext/sales-order), [Sales Invoice](https://docs.frappe.io/erpnext/sales-invoice). Flolah agents use **`erp_*` tools** (and MCP `mcp-flolah-erp`) against the **CEO-bound Company** only.

You are a **domain SME** for this company’s books. Operate **masters → quote → order → deliver → invoice → cash** (selling) and **request → purchase order → bill → pay** (buying). Draft vs submit is the control plane (**38**).

---

## Company scope on Flolah

- Each CEO maps to **one ERPNext Company** on a shared multi-company site.
- Desk SSO and `erp_*` tools are **company-scoped** (`company` on transactions; **`flolah_company`** on Customer, Supplier, Lead, Contact, Address, Item, Item Price, Opportunity).
- Agents **must not** invent cross-company data, list Users, or pass foreign company ids.
- `erp_get_company` / `erp_list_fiscal_years` — own company only (fiscal year **names** may be site-shared; responses redact peer companies).

---

## Document states (critical)

ERPNext submittable documents have **docstatus**:

| Status | Meaning | Who on Flolah |
|--------|---------|----------------|
| **Draft** (0) | Editable; **no** GL/stock effect | **Makers** create/update |
| **Submitted** (1) | Final for that version; accounting/stock effects per doctype | **ERP Checker** (`erp_submit_doc`) or CEO desk |
| **Cancelled** (2) | Reversed submitted doc (strict; may need amendment) | **ERP Checker** (`erp_cancel_doc`) |

**Never** tell the CEO a quote/invoice/payment is “posted” while it is still draft. Convert **from the source document** when possible (Quotation → Sales Order → Delivery Note / Sales Invoice) so links and billed/delivered % stay correct.

---

## Domain processes (what “operate ERPNext” means)

ERPNext is **not** a single form. It is linked **cycles**. Pick the shortest cycle that still audits. Always **list/get masters first** (`erp_get_company`, Customer, Item, fiscal year).

### A. Selling — order-to-cash (O2C)

Business path: **Lead / Customer → Quotation → Sales Order → (Delivery) → Sales Invoice → Payment**.

| Step | DocType | Business meaning | Typical tools | Submit? |
|------|---------|------------------|---------------|---------|
| 1 Party | **Lead** then **Customer** | Who we sell to. Convert Lead before order if the quote was to a Lead | `erp_create_lead`, `erp_create_customer`, Contact | Customer is a master (not a GL post) |
| 2 Offer | **Quotation** | Priced offer; not a commitment | `erp_create_quotation` | Checker if the CEO treats quotes as controlled; often draft until accepted |
| 3 Order | **Sales Order** | Customer **commitment** (qty, rate, dates) | `erp_create_sales_order` | **Checker** before it drives delivery/billing |
| 4 Fulfil (goods) | **Delivery Note** | Stock out from Warehouse | `erp_create_delivery_note` (Maker B) | **Checker** — stock moves on submit |
| 5 Bill | **Sales Invoice** | Receivable + income (GL) | `erp_create_sales_invoice` (Maker A / Invoice specialist) | **Checker** |
| 6 Cash | **Payment Entry** | Cash/bank applied to invoice | `erp_create_payment_entry` | **Checker** for material amounts |

**Shorter variants (pick the shortest that still audits):**

| Variant | Documents | When |
|---------|-----------|------|
| Standard goods | QTN → SO → DN → SI → PE | Stocked goods, fulfilment tracking |
| Direct invoice + stock | SI with update-stock → PE | Counter / cash-and-carry |
| Services | QTN? → SO → SI → PE (**no DN**) | Consulting, software, non-stock |
| Drop-ship | SO + supplier PO; SI/PI; usually **no** DN | Supplier ships to customer |
| From Twenty CRM | CRM Won + ids → Customer + QTN/SO (this table) | Pipeline SoR is Twenty (**40**); books SoR is ERPNext |

**CRM = ERPNext** (no Twenty): same O2C, plus Sales **Lead / Opportunity / Contact** via `erp_*` or `crm_*` facade. Do not skip Customer before Sales Order.

**Do not** recreate an unlinked Sales Invoice “because the order exists.” Convert along the chain so billed % stays correct.

### B. Buying — purchase-to-pay (P2P) (Maker B)

Business path: **need → Material Request (optional) → Purchase Order → Purchase Invoice → Payment**.

| Step | DocType | Meaning | Tools |
|------|---------|---------|-------|
| Demand | **Material Request** | Internal ask for items/qty | `erp_create_material_request` |
| Commit buy | **Purchase Order** | Promise to supplier | `erp_create_purchase_order` |
| Bill | **Purchase Invoice** | Payable / expense (GL) | `erp_create_purchase_invoice` |
| Pay | **Payment Entry** | Pay the supplier | `erp_create_payment_entry` |

Flolah tools do **not** currently expose a dedicated Purchase Receipt tool. Prefer **PO → PI** (and stock via Delivery/Stock only when an allowlisted doctype exists). Do not invent Receipt names. Warehouses and items **must** belong to this company.

### C. Stock (Maker B)

- **Item:** `item_code` or `item_name`; `item_group` default Products; `stock_uom` default Nos. **Service items:** do not maintain stock — no Delivery Note.
- **Delivery Note:** goods **out** against a Sales Order when you dispatch.
- **Material Request:** internal demand; does not buy by itself.
- Never pick a warehouse or item from another Flolah company. If create fails, get Item + Company and fix links.

### D. Accounting (Maker A / Checker / P&L)

- **Sales Invoice / Purchase Invoice** — revenue or expense + party balance (on **submit**).
- **Payment Entry** — bank/cash vs party.
- **Journal Entry** — adjustments; must **balance**; Checker submit.
- **`erp_list_gl_entries`** — ledger lines. **`erp_profit_and_loss`** — period P&L.
- **Never invent balances, GL accounts, or tax codes.** If accounts are missing, get Company and list resource — do not copy peer-company accounts.

P&L specialist: **report only**. Posting stays with Makers/Checker.

### E. Projects (Project specialist / Maker B)

- **Project** (`project_name`) + **Task** (`subject`) for delivery work, not a substitute for Sales Order.
- Link project to Customer when the work is billed; invoicing still SI → Checker.
- Education/college mapping (no Education doctypes): prospect → CRM Lead; enrolled/payer → Customer; fee → Item (service); bill → SI; collected → PE; batch → Project. See **32**.

### F. Returns / mistakes

- **Draft:** Maker amends (`erp_update_resource`). Do not cancel drafts.
- **Submitted by error:** Checker `erp_cancel_doc` only when policy allows; then Maker recreates the correct chain.
- Do not invent Credit Note doctypes unless `erp_list_resource` / get shows that allowlisted type for this company.

---

## Sales cycle (order-to-cash) — summary

ERPNext Selling connects masters → offer → commitment → fulfilment → bill → cash.

**Typical path (goods):**

1. **Lead** (`lead_name`) and/or **Customer** (`customer_name`, `customer_type` Company/Individual)
2. **Contact** / **Address** (link to Customer)
3. **Opportunity** (pipeline; optional if CRM=Twenty)
4. **Item** (`item_code` or `item_name`; `item_group` default Products; `stock_uom` default Nos). Service items: do **not** maintain stock.
5. **Quotation** — offer (often draft). May target a Lead; convert to Customer before order.
6. **Sales Order** — customer **commitment** (items, qty, dates, rates)
7. **Delivery Note** — goods issued (stock) when you dispatch from a Warehouse
8. **Sales Invoice** — receivable / income (GL)
9. **Payment Entry** — cash applied to invoice

---

## Required fields (tool creates)

| DocType | Minimum Flolah expects | Notes |
|---------|------------------------|-------|
| Customer | `customer_name` | `customer_type` default Company; tools stamp `flolah_company` |
| Lead | `lead_name` | email via `email_id` |
| Contact | `first_name` or `last_name` or `email_id` | Link to Customer when known |
| Item | `item_code` or `item_name` | group Products, uom Nos unless specified |
| Quotation / Sales Order / Invoice | Customer (or Lead on QTN), **items** with qty/rate, **company** | Use `doc` / `data` payload; company forced to bound company |
| Payment Entry | party, amount, accounts / mode | Large posts → Checker |
| Journal Entry | accounts + amounts balanced | Checker submit |
| Project | `project_name` | company-scoped |
| Task | `subject` | |
| Fiscal Year | year name (e.g. `2026`) | Maker A may **link** existing site year to this company |

If create fails, **get/list** the related master (Customer, Item, Company) and fix missing links — do not invent GL accounts or warehouses from other companies.

---

## Prefab ERP AI employees

Selecting **ERP = ERPNext** provisions:

| Agent | Domain | Tools posture |
|-------|--------|----------------|
| **ERP Maker A** | Finance / setup / sales-money | Company + fiscal write, customers, quotes, orders, invoices, payments, journals, P&L. **Draft only** |
| **ERP Maker B** | Ops / stock | Company + fiscal **read**, PO/DN/MR/items, projects/tasks. **Draft only** |
| **ERP Checker** | Approvals | List + **`erp_submit_doc` / `erp_cancel_doc`** + Kanban assign/move + certify tools. Does not bulk-create drafts |
| **ERP P&L / Invoice / Project** | Specialists | Focused subsets; Invoice drafts still need Checker submit |

Maker A + Maker B together ≈ CEO desk **operational** scope (not System Manager / User admin).

**Discount / policy:** ≥5% (or company policy) → Maker ends with `{"decision":"needs_ceo","gate":"discount_5pct",...}` — **workflow CEO Approval**, not free-form CEO Kanban. See **38**.

---

## Maker operating sequence (non-trivial selling)

1. `learnings_summary` then `master_data_rag` query `ERPNext order to cash quotation sales order delivery invoice payment`.
2. `erp_get_company` + fiscal year. List Customer / Item (create masters if missing — still this company).
3. If the work came from Twenty: reuse CRM company/person/amount/SKU; do not invent a second customer name.
4. Draft the **next** document in the cycle (do not jump to SI if SO is missing unless cash-and-carry).
5. Kanban `[ERP] Submit …` to **ERP Checker** with doctype + name + source links.
6. Stop. Checker submits. You do not call `erp_submit_doc`.

---

## Checker audit (before submit)

Checker **must** `erp_get_resource` / named `erp_list_*` on the draft and confirm:

1. **Company** is the CEO-bound company (`erp_get_company`).
2. **Party** exists (Customer/Supplier) and matches the Kanban / CRM handoff.
3. **Items** exist; qty/rate match the offer; taxes/currency plausible.
4. **Warehouse** (stock docs) belongs to this company; stock items vs service items correct.
5. **Accounts** (invoice/payment/journal) are company accounts — never peer companies.
6. **Links:** SO/DN/SI chain is consistent (do not submit an orphan SI that double-bills).
7. **Docstatus** is draft. After submit, confirm submitted in the tool result.

**Reject:** Kanban comment `FINDING: …` and reassign Maker. **Approve:** `erp_submit_doc` with `{ "doctype": "Sales Invoice", "name": "SINV-…" }` then complete the card.

Cancel is exceptional (wrong post). Prefer Maker amendment on draft; cancel+recreate only when already submitted and CEO/policy allows.

---

## Reporting

- **`erp_list_gl_entries`** — ledger lines for the company.
- **`erp_profit_and_loss`** — period P&L. **Never invent balances.**
- P&L specialist: report only; posting stays with Makers/Checker.

---

## Isolation reminders

| Topic | Rule |
|-------|------|
| Customer / Item / Lead | `flolah_company` stamped + filtered |
| SO / SI / DN / PO / JE / Project | native `company` |
| User doctype | **blocked** for agents |
| Fiscal Year | site-global name; tools show **your** company link only |
| Org sync | optional roster (Department + Employee). Skip for invoicing |

---

## Useful Flolah tools

`erp_status`, `erp_get_company`, `erp_update_company`, `erp_list_*`, `erp_create_*` (Maker draft), `erp_get_resource` / `erp_update_resource` / `erp_create_resource` (allowlisted doctypes), `erp_submit_doc` / `erp_cancel_doc` (Checker), `erp_profit_and_loss`, `erp_list_gl_entries`, `erp_sync_org` (optional).

MCP: `mcp-flolah-erp` with `X-Ceo-User-Id`.

---

## CEO how-to (Platform Help)

1. Profile or Company setup → ERP **ERPNext** → Save / Apply.
2. Confirm Maker A/B, Checker, specialists under **AI Employees**.
3. Open **ERP** for desk SSO (`/app` with default Company).
4. Chat ERP Maker to **draft**; Checker (or desk) to **submit**.
5. CRM pipeline may live in Twenty (**40**); billing still ERP.

---

## What this doc is not

Full Manufacturing MRP, HR payroll, multi-currency tax codes — defer to Frappe docs or a specialist. Isolation/setup: **32**.

## Tips for Platform Help answers

1. **Answer first** from this doc + **32** + **38** (numbered desk/tool steps, draft vs submit).
2. Soft-tip **ERP Maker / Checker / COO** after help if the CEO needs live books or submit.
3. “What is my AR?” → explain SI + Payment Entry + P&L tools, then COO/ERP for live numbers.
4. “How do I take an order?” → Sales Order after Customer + Item; Checker submits; CRM Won is not an order (**40**).

## Tips for ERP Maker / Checker

1. You are an **ERP SME**. Own **quote → order → deliver → invoice → cash** and **PO → bill → pay**. Read **DOMAIN.md** and `master_data_rag` (`ERPNext order to cash purchase to pay`) before non-trivial posts. Flolah Help ERPNext SME is included (`corpus=platform-help`) — do not say you lack ERPNext help docs.
2. List/get masters first. Draft only if Maker. Submit only if Checker.
3. Convert along the cycle; do not recreate unlinked invoices.
4. Never invent GL, warehouses, or peer-company parties.
5. Never spoof `ceo_user_id`. Bound company only.
