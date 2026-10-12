# TOOLS — Agent OS tools

When you have access to Agent OS tools, invoke them **by tool name with JSON parameters**; do not use exec or run as shell commands.

## Domain knowledge

Read workspace **DOMAIN.md** (ERPNext SME). Own PO→bill and SO→Delivery Note. Before stock/buying drafts, **`master_data_rag`** query `ERPNext delivery note purchase order material request`. Help **39** / **38**. Draft only. List/RAG include Flolah Help (`corpus=platform-help`) even with no CEO uploads.

---

## Granted tools

- **ceo_profile** — CEO Profile (Account): API tool: return this org CEO's platform account profile (name, email, mobile, country, region, business_name, industry)
- **erp_create_customer** — ERP Create Customer: Create ERPNext Customer (customer_name required)
- **erp_create_delivery_note** — ERP Create Delivery Note: Create ERPNext Delivery Note
- **erp_create_item** — ERP Create Item: Create ERPNext Item (item_code or item_name)
- **erp_create_material_request** — ERP Create Material Request: Create Material Request
- **erp_create_project** — ERP Create Project: Create Project
- **erp_create_purchase_order** — ERP Create Purchase Order: Create Purchase Order draft
- **erp_create_resource** — ERP Create Resource: Generic Frappe create doctype
- **erp_create_task** — ERP Create Task: Create Task (subject required)
- **erp_get_company** — ERP Get Company: Get the CEO-bound ERPNext Company document (not other companies)
- **erp_get_resource** — ERP Get Resource: Generic Frappe get by doctype + name
- **erp_list_customers** — ERP List Customers: List ERPNext Customers for company
- **erp_list_delivery_notes** — ERP List Delivery Notes: List ERPNext Delivery Notes
- **erp_list_fiscal_years** — ERP List Fiscal Years: List Fiscal Years usable by your bound company
- **erp_list_items** — ERP List Items: List ERPNext Items (catalog)
- **erp_list_material_requests** — ERP List Material Requests: List Material Requests
- **erp_list_projects** — ERP List Projects: List Projects
- **erp_list_purchase_invoices** — ERP List Purchase Invoices: List Purchase Invoices
- **erp_list_purchase_orders** — ERP List Purchase Orders: List Purchase Orders
- **erp_list_resource** — ERP List Resource: Generic Frappe list: doctype + filters (company-scoped allowlist; Company returns bound company only)
- **erp_list_sales_orders** — ERP List Sales Orders: List ERPNext Sales Orders
- **erp_list_tasks** — ERP List Tasks: List Tasks
- **erp_status** — ERP Status: ERPNext status: company bind, uses_erpnext, catalog of accessible objects
- **erp_sync_org** — ERP Sync Org: Sync Flolah departments + AI employees into ERPNext
- **erp_update_resource** — ERP Update Resource: Generic Frappe update: doctype + name + fields
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

## Multi format content generation conversion and OCR

When granted, call **multi-format-content-tool** by its exact name with JSON. It generates PDF, Word (docx or legacy doc), Excel (xlsx), txt and sanitized HTML; converts Word to PDF, PDF to editable Word/text, PDF pages to png/jpg, images to PDF, and OCRs images/scanned PDFs. This is deterministic private processing, not a browser or shell action.

- Prefer an existing **Content Folder** reference: `content_file: {id: "up:inbound/attachments/report.pdf"}`, `{id: "gen:downloads/<owner>/<uuid>.pdf"}`, or `{relative_path: "inbound/attachments/report.pdf"}`. For a generated file, copy **files[].content_file_id** unchanged into `content_file: {id: ...}`; never rewrite it as inbound/attachments. Use exact item IDs/paths returned by tools; do not invent paths or resend a whole file. A unique `{filename: "report.pdf"}` is also accepted. Only this authenticated company's files are accessible.
- Otherwise supply exactly one of `text` with `input_format: "txt"|"md"|"html"`, `content_base64` plus `input_format`/`input_filename`, or `formatted_input` as blocks: heading {text,level}, paragraph/list {text}, table {rows:[[...]]}.
- Required `output_format`: pdf, docx, doc, xlsx, txt, html, png or jpg. Optional `operation`: generate, convert (default), ocr. `ocr`: auto (default), force, off. `language`: eng (default), spa, fra, deu or plus-separated combinations. Optional `output_filename` sets the display filename.
- Example generation: {"text":"# Weekly report\n\n| Item | Count |\n| --- | --- |\n| Leads | 12 |","input_format":"md","output_format":"pdf","operation":"generate"}.
- Example file conversion: {"content_file":{"relative_path":"inbound/attachments/report.docx"},"output_format":"pdf"}. Example OCR: {"content_file":{"relative_path":"inbound/attachments/scan.png"},"operation":"ocr","output_format":"docx"}.
- Paste **each files[].paste_exactly** unchanged on its own line to attach in the current channel. Never manufacture a file link or use a public signed URL. Antivirus input/output scanning is required; failures/infection block delivery. Source files are unchanged. Limits: 25 MiB combined output, 20 PDF pages; no macros, encrypted Office/PDF inputs or network-loaded resources.
- Preserve returned warnings. PDF-to-Word reconstructs editable text, not guaranteed original layout; OCR can misread text/numbers. Excel uses source tables or a Content sheet and never executes input formulas. Review important conversions before claiming exact fidelity.
- If not granted, ask for the tool grant in Agent Workspace; documenting this tool does not authorize its use.
