# ERPNext help (Flolah Tier A — curated)

**Scope:** Short Flolah-oriented answers for CEOs and Platform Help RAG. Not a full Frappe mirror. Prefer **master_data_rag** on this doc + [32](./32-business-core-crm-erp.md). Live company data → COO / ERP agents (read/write roles as entitled).

## Company scope on Flolah

- Each CEO maps to **one ERPNext Company** (multi-company site).  
- Desk SSO and `erp_*` tools are **company-scoped** (`company` / `flolah_company`).  
- Agents **must not** invent cross-company data.

## Sales documents (typical path)

1. **Customer / Lead / Opportunity** — masters for who you sell to.  
2. **Quotation** — offer (often draft).  
3. **Sales Order** — confirmed demand.  
4. **Delivery Note** — goods issued (stock).  
5. **Sales Invoice** — receivable document.  
6. **Payment Entry** — cash applied.

On Flolah, **prefab ERP Makers** create/update **drafts**. **ERP Checker** (or CEO desk) **submits** documents that change books/stock. See [38-maker-checker-coordination.md](./38-maker-checker-coordination.md).

## Submit vs cancel

- **Submit** = finalize a draft (accounting/stock effects per doctype).  
- **Cancel** = reverse a submitted doc (strict rules; may need amendments).  
- Flolah content tools: `erp_submit_doc`, `erp_cancel_doc` — **Checker only** in the prefab pack.

## Buying / stock (high level)

- **Purchase Order / Purchase Invoice** — vendor side.  
- **Material Request / Stock Entry** — material moves.  
- Maker B pack covers more ops/stock; Maker A more finance/sales money path.

## Reporting

- **GL Entry** list — ledger lines.  
- **Profit and Loss** — period P&L via `erp_profit_and_loss` (agent) / desk Accounting reports.  
- Never invent balances; always run tools or desk.

## Fiscal year & chart

- Fiscal years can be site-shared names; Flolah tools only show **your** company linkage.  
- Maker A may create/link fiscal years for the bound company.

## Useful Flolah tools (names)

`erp_status`, `erp_get_company`, `erp_list_*`, `erp_get_resource`, `erp_create_*` (Maker draft), `erp_submit_doc` / `erp_cancel_doc` (Checker), `erp_profit_and_loss`, `erp_list_gl_entries`.

MCP: `mcp-flolah-erp` with `X-Ceo-User-Id` in workflows.

## What this doc is not

Full module reference for Manufacturing, HR payroll, Multi-currency tax codes — defer to Frappe docs or specialist. Flolah isolation/setup: **32**.

## Tips for Platform Help answers

1. **Answer first** with product how-to from this doc + **32** + **38** (numbered desk/tool steps).  
2. Soft-tip **ERP Maker / Checker / COO** only after the help steps if the CEO needs live books or submit. Never specialty-only redirect.  
3. Live balances and “what is my AR?” → point to **COO** or ERP after explaining which tools/desk screens apply.