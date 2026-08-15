# TOOLS — Agent OS tools

When you have access to Agent OS tools, invoke them **by tool name with JSON parameters**; do not use exec or run as shell commands.

## Domain knowledge

Read workspace **DOMAIN.md** (ERPNext SME). Before submit/cancel, **`master_data_rag`** query `ERPNext submit cancel sales invoice` and get the draft. Help **39** / **38**.

---

## Granted tools

- **agent_workflow_certify_resume** — Resume Workflow Certify: API tool (Workflow Builder): resume a blocked certify job after the CEO provides inputs
- **agent_workflow_certify_start** — Start Workflow Certify: API tool (Workflow Builder): start an autonomous Maker/Checker certify job for the entitled CEO
- **agent_workflow_certify_status** — Workflow Certify Status: API tool (Workflow Builder or COO): get status of a certify job
- **ceo_profile** — CEO Profile (Account): API tool: return this org CEO's platform account profile (name, email, mobile, region, business_name, industry)
- **erp_cancel_doc** — ERP Cancel Doc: Cancel submitted Frappe document
- **erp_get_company** — ERP Get Company: Get the CEO-bound ERPNext Company document (not other companies)
- **erp_get_resource** — ERP Get Resource: Generic Frappe get by doctype + name
- **erp_list_contacts** — ERP List Contacts: List ERPNext Contacts
- **erp_list_customers** — ERP List Customers: List ERPNext Customers for company
- **erp_list_delivery_notes** — ERP List Delivery Notes: List ERPNext Delivery Notes
- **erp_list_fiscal_years** — ERP List Fiscal Years: List Fiscal Years usable by your bound company
- **erp_list_gl_entries** — ERP List GL Entries: List GL Entries
- **erp_list_items** — ERP List Items: List ERPNext Items (catalog)
- **erp_list_journal_entries** — ERP List Journal Entries: List Journal Entries
- **erp_list_leads** — ERP List Leads: List ERPNext Leads
- **erp_list_material_requests** — ERP List Material Requests: List Material Requests
- **erp_list_opportunities** — ERP List Opportunities: List ERPNext Opportunities (CRM pipeline)
- **erp_list_payment_entries** — ERP List Payment Entries: List Payment Entries
- **erp_list_projects** — ERP List Projects: List Projects
- **erp_list_purchase_invoices** — ERP List Purchase Invoices: List Purchase Invoices
- **erp_list_purchase_orders** — ERP List Purchase Orders: List Purchase Orders
- **erp_list_quotations** — ERP List Quotations: List ERPNext Quotations
- **erp_list_resource** — ERP List Resource: Generic Frappe list: doctype + filters (company-scoped allowlist; Company returns bound company only)
- **erp_list_sales_invoices** — ERP List Sales Invoices: List Sales Invoices for company
- **erp_list_sales_orders** — ERP List Sales Orders: List ERPNext Sales Orders
- **erp_list_tasks** — ERP List Tasks: List Tasks
- **erp_profit_and_loss** — ERP Profit and Loss: Run Profit and Loss Statement for company
- **erp_status** — ERP Status: ERPNext status: company bind, uses_erpnext, catalog of accessible objects
- **erp_submit_doc** — ERP Submit Doc: Submit Frappe document (docstatus 1)
- **erp_sync_org** — ERP Sync Org: Sync Flolah departments + AI employees into ERPNext
- **kanban_assign_task** — Kanban Assign Task: API tool (COO only): assign a Kanban task to an agent
- **kanban_create_task** — Kanban Create Task: API tool: create a Kanban task for the CEO
- **kanban_get_task** — Kanban Get Task: API tool: read one Kanban task by task_id with full content — status, description, task messages, delegation_response/deliverable (completed agent work), and agent-chat turns (including archived)
- **kanban_move_status** — Kanban Move Status: API tool: move a Kanban task status
- **kanban_reassign_to_coo** — Kanban Reassign to COO: API tool: reassign a task back to the COO
- **learnings_summary** — Learnings Summary: API tool: summarize this user's past feedback (thumbs up/down) and Kanban approve/reject/comment actions for a topic
- **master_data_list_rows** — Master Data — List / Query Rows: API tool: READ DATA from an existing Master Data table
- **master_data_list_tables** — Master Data — List Tables: API tool: DISCOVERY ONLY — list this CEO's Master Data tables with name, purpose/description, columns, row_count
- **master_data_rag** — Master Data — RAG Search: API tool: answer questions from this CEO's uploaded Master Data documents (PDF, Word 
- **notify_ceo** — Notify CEO (Push): Send an in-app push to the entitled CEO ONLY when they asked you to reach/notify/ping them, or for a true blocker/approval while they are NOT already in your Dashboard chat
- **status_checker** — COO Status Checker: API tool (COO only): reconcile A2A/Kanban task status and post a task-count digest to the CEO standup chat (returns HTML)

---

## Choosing the right tool

- **Match the tool to the request:** Read the user's message and choose the tool whose purpose best fits.
- **If a tool's result is not good enough:** Try the next most relevant granted tool before giving up.

---

## Browser automation (OpenClaw + Playwright)

You have the **browser** tool when enabled in OpenClaw config.

- **Always use `profile="openclaw"`** for managed Playwright/Chromium.
