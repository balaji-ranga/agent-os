# TOOLS — Agent OS tools

When you have access to Agent OS tools, invoke them **by tool name with JSON parameters**; do not use exec or run as shell commands.

## Domain knowledge

Read workspace **DOMAIN.md** (Twenty CRM SME). Before non-trivial pipeline work, **`master_data_rag`** query `Twenty CRM people companies opportunities stages`. Help **40** / **38**. List/RAG include Flolah Help (`corpus=platform-help`) even with no CEO uploads.

---

## Granted tools

- **ceo_profile** — CEO Profile (Account): API tool: return this org CEO's platform account profile (name, email, mobile, country, region, business_name, industry)
- **crm_create_company** — CRM Create Company: Create Twenty company (name required; domain_url?, employees?)
- **crm_create_deal** — CRM Create Deal: Create deal (opportunity) default stage PROPOSAL
- **crm_create_lead** — CRM Create Lead: Create lead as Twenty opportunity with stage NEW (name, amount?, company_id?)
- **crm_create_opportunity** — CRM Create Opportunity: Create Twenty opportunity/deal (name, amount?, stage?, company_id?, close_date?)
- **crm_create_person** — CRM Create Person: Create Twenty person (name, email?, phone?, company_id?) in the company Twenty workspace (not a shared platform workspace)
- **crm_list_companies** — CRM List Companies: List Twenty companies/accounts (optional limit)
- **crm_list_deals** — CRM List Deals: Alias of crm_list_opportunities — Twenty pipeline deals
- **crm_list_leads** — CRM List Leads: List pipeline leads (Twenty opportunities in early stages NEW/SCREENING/MEETING/PROPOSAL/QUALIFIED)
- **crm_list_notes** — CRM List Notes: List Twenty notes for this workspace
- **crm_list_opportunities** — CRM List Opportunities: List Twenty opportunities/deals (optional limit, stage filter)
- **crm_list_people** — CRM List People: List Twenty people/contacts (optional limit)
- **crm_list_tasks** — CRM List Tasks: List Twenty tasks for this workspace
- **crm_status** — CRM Status: Twenty CRM status: bind, API key set?, objects (people/companies/opportunities/notes/tasks)
- **crm_sync_org** — CRM Sync Org: Sync Flolah departments + AI employees into Twenty (people)
- **crm_update_opportunity** — CRM Update Opportunity: Patch Twenty opportunity by id (stage, amount, name…)
- **kanban_create_task** — Kanban Create Task: API tool: create a Kanban task for the CEO
- **kanban_move_status** — Kanban Move Status: API tool: move a Kanban task status
- **learnings_summary** — Learnings Summary: API tool: summarize this user's past feedback (thumbs up/down) and Kanban approve/reject/comment actions for a topic
- **master_data_list_rows** — Master Data — List / Query Rows: API tool: READ DATA from an existing Master Data table
- **master_data_list_tables** — Master Data — List Tables: API tool: DISCOVERY ONLY — list this CEO's Master Data tables with name, purpose/description, columns, row_count
- **master_data_rag** — Master Data — RAG Search: API tool: answer questions from this CEO's uploaded Master Data documents (PDF, Word 
- **notify_ceo** — Notify CEO (Push): Send an in-app push to the entitled CEO ONLY when they asked you to reach/notify/ping them, or for a true blocker/approval while they are NOT already in your Dashboard chat
- **summarize_url** — Summarize URL: Fetch a web page (HTTPS) and return a short summary and title

---

## Choosing the right tool

- **Deletes / duplicates:** You do **not** have `crm_delete_*`. List keep vs drop ids, then `kanban_create_task` assigned to **CRM Checker**, title `[CRM] Review delete …`.
- **Match the tool to the request:** Read the user's message and choose the tool whose purpose best fits.
- **If a tool's result is not good enough:** Try the next most relevant granted tool before giving up.

---

## Browser automation (OpenClaw + Playwright)

You have the **browser** tool when enabled in OpenClaw config.

- **Always use `profile="openclaw"`** for managed Playwright/Chromium.
