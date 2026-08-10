# Twenty CRM help (Flolah Tier A — curated)

**Scope:** Flolah-oriented CRM help for Platform Help RAG. Live pipeline data → COO / CRM Maker / CRM Checker. Setup & isolation: [32-business-core-crm-erp.md](./32-business-core-crm-erp.md). Coordination: [38-maker-checker-coordination.md](./38-maker-checker-coordination.md).

## What Twenty holds on Flolah

Per CEO company: **one Twenty workspace**. SSO opens that workspace in the **CRM** nav iframe. Objects commonly used by agents:

- **People** — contacts  
- **Companies** — accounts  
- **Opportunities / Deals / Leads** — pipeline (stages via tools)  
- **Notes / Tasks** — activity  

Content tools: `crm_list_*`, `crm_create_*`, `crm_update_opportunity`, `crm_status`, optional `crm_sync_org`.

MCP: `mcp-flolah-crm` with `X-Ceo-User-Id`.

## Prefab AI employees

When Profile CRM = **Twenty** (or ERPNext sales CRM path):

- **CRM Maker A / B** — execute pipeline and research work.  
- **CRM Checker** — review **high-risk** CRM proposals via Kanban (Option 1 process gate).  

When CRM = **ERPNext**, makers use Sales-side `erp_*` instead of `crm_*`; same Kanban protocol.

## Org sync (optional)

`crm_sync_org` can push Flolah departments + AI employee names into CRM people/org stubs. **Usually skip** for customer sales work — it does not import your customer pipeline.

## High-risk CRM (Checker)

Use Checker Kanban before treating done:

- Stage to **Won** on large opportunities  
- Merge / delete accounts  
- Bulk stage or ownership changes  
- Handoff that creates financial ERP documents  

Low-risk: notes, early stages — Maker alone.

## COO

COO has **read-only** CRM list tools to report and to **delegate** to CRM makers/checkers. Platform Help does not call live CRM tools.

## Tips for Platform Help answers

1. **Answer first:** RAG this file + **32** + **38** and give numbered product steps (enable CRM, nav **CRM** `/work`, People/Companies/Opportunities, `crm_*` tools, Maker/Checker).  
2. For “how do I capture contacts and leads?” → full how-to from this doc; **then** optional tip that **CRM Maker** / **COO** can execute or read live data. Never specialist-only redirect.  
3. For “what deals are open?” (live data) → after noting they need live CRM, tell CEO to ask **COO** or open **CRM**.  
4. For “how do I submit an invoice?” → that is **ERP**, not Twenty — explain from **39** + ERP Checker after RAG.