# TOOLS — Agent OS tools

When you have access to Agent OS tools, invoke them **by tool name with JSON parameters**; do not use exec or run as shell commands.

---

## Granted tools

- **ceo_profile** — CEO Profile (Account): API tool: return this org CEO's platform account profile (name, email, mobile, region, business_name, industry)
- **crm_list_companies** — CRM List Companies: List Twenty companies/accounts (optional limit)
- **crm_list_deals** — CRM List Deals: Alias of crm_list_opportunities — Twenty pipeline deals
- **crm_list_leads** — CRM List Leads: List pipeline leads (Twenty opportunities in early stages NEW/SCREENING/MEETING/PROPOSAL/QUALIFIED)
- **crm_list_notes** — CRM List Notes: List Twenty notes for this workspace
- **crm_list_opportunities** — CRM List Opportunities: List Twenty opportunities/deals (optional limit, stage filter)
- **crm_list_people** — CRM List People: List Twenty people/contacts (optional limit)
- **crm_list_tasks** — CRM List Tasks: List Twenty tasks for this workspace
- **crm_status** — CRM Status: Twenty CRM status: bind, API key set?, objects (people/companies/opportunities/notes/tasks)
- **crm_sync_org** — CRM Sync Org: Sync Flolah departments + AI employees into Twenty (people)
- **kanban_create_task** — Kanban Create Task: API tool: create a Kanban task for the CEO
- **kanban_move_status** — Kanban Move Status: API tool: move a Kanban task status
- **master_data_list_rows** — Master Data — List / Query Rows: API tool: READ DATA from an existing Master Data table
- **master_data_list_tables** — Master Data — List Tables: API tool: DISCOVERY ONLY — list this CEO's Master Data tables with name, purpose/description, columns, row_count
- **master_data_rag** — Master Data — RAG Search: API tool: answer questions from this CEO's uploaded Master Data documents (PDF, Word 
- **notify_ceo** — Notify CEO (Push): Send an in-app push to the entitled CEO ONLY when they asked you to reach/notify/ping them, or for a true blocker/approval while they are NOT already in your Dashboard chat

---

## Choosing the right tool

- **Match the tool to the request:** Read the user's message and choose the tool whose purpose best fits.
- **If a tool's result is not good enough:** Try the next most relevant granted tool before giving up.

---

## Browser automation (OpenClaw + Playwright)

You have the **browser** tool when enabled in OpenClaw config.

- **Always use `profile="openclaw"`** for managed Playwright/Chromium.
