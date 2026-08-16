# TOOLS — Agent OS tools

When you have access to Agent OS tools, invoke them **by tool name with JSON parameters**; do not use exec or run as shell commands.

## Domain knowledge

Read workspace **DOMAIN.md** (ERPNext SME). Own Project + Task for delivery (not a substitute for Sales Order). Before project drafts, **`master_data_rag`** query `ERPNext project task sales order invoice`. Help **39**. Billing still SI → Checker. List/RAG include Flolah Help (`corpus=platform-help`) even with no CEO uploads.

---

## Granted tools

- **ceo_profile** — CEO Profile (Account): API tool: return this org CEO's platform account profile (name, email, mobile, country, region, business_name, industry)
- **erp_create_project** — ERP Create Project: Create Project
- **erp_create_resource** — ERP Create Resource: Generic Frappe create doctype
- **erp_create_task** — ERP Create Task: Create Task (subject required)
- **erp_get_company** — ERP Get Company: Get the CEO-bound ERPNext Company document (not other companies)
- **erp_get_resource** — ERP Get Resource: Generic Frappe get by doctype + name
- **erp_list_customers** — ERP List Customers: List ERPNext Customers for company
- **erp_list_items** — ERP List Items: List ERPNext Items (catalog)
- **erp_list_projects** — ERP List Projects: List Projects
- **erp_list_resource** — ERP List Resource: Generic Frappe list: doctype + filters (company-scoped allowlist; Company returns bound company only)
- **erp_list_sales_invoices** — ERP List Sales Invoices: List Sales Invoices for company
- **erp_list_sales_orders** — ERP List Sales Orders: List ERPNext Sales Orders
- **erp_list_tasks** — ERP List Tasks: List Tasks
- **erp_status** — ERP Status: ERPNext status: company bind, uses_erpnext, catalog of accessible objects
- **erp_sync_org** — ERP Sync Org: Sync Flolah departments + AI employees into ERPNext
- **kanban_create_task** — Kanban Create Task: API tool: create a Kanban task for the CEO
- **kanban_get_task** — Kanban Get Task: API tool: read one Kanban task by task_id with full content — status, description, task messages, delegation_response/deliverable (completed agent work), and agent-chat turns (including archived)
- **kanban_move_status** — Kanban Move Status: API tool: move a Kanban task status
- **learnings_summary** — Learnings Summary: API tool: summarize this user's past feedback (thumbs up/down) and Kanban approve/reject/comment actions for a topic
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
