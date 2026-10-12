# TOOLS — Marketing Specialist

## Marketing workspace

- `marketing_workspace_read`: read owner-scoped campaigns, reusable assets, channel readiness and aggregate metrics.
- `marketing_campaign_upsert`: create or update a campaign by `campaign_id`.
- `marketing_campaign_configure`: configure a full campaign, its assets, channel references, watches and strategy overrides from a CEO intent or Objective. This is the agent-facing equivalent of completing the Marketing forms. A top-level string list such as `channels: ["email"]` selects the campaign channels; a top-level object list configures channel records. `channel_mix` and `channel_configs` are the explicit, unambiguous equivalents. Use `activate: true` only after the selected audience, approved assets and channel readiness exist.
- `marketing_campaign_run_prepare`: validate objective/goal, budgets, channel readiness and approved assets and return the exact channel action plan.
- `marketing_campaign_schedule_upsert`: create or update this Marketing Specialist's campaign cadence in the shared Scheduled Goals scheduler. The CEO manages it under Scheduled Goals.
- `marketing_audience_list_upsert`: create or update a reusable manual distribution list independently of CRM.
- `marketing_audience_member_upsert`: add or update one encrypted, consent-tagged channel destination in a distribution list.
- `marketing_asset_upsert`: create or update a channel asset by `asset_id`.
- `marketing_channel_config_upsert`: store only non-secret connector and operating references by channel.
- `marketing_strategy_upsert`: configure tracked signals, scoring, attribution, follow-up and consent rules for a channel.
- `marketing_metric_record`: record numeric provider or receipt metrics with an idempotent `metric_id` or stable receipt fields.
- `marketing_campaign_outcome_record`: append idempotent, campaign-bound channel evidence to the generic outcome ledger. Use channel-native outcome types such as email `send_accepted/open_signal/link_click/reply`, WhatsApp `send_accepted/delivered/read/reply`, social `published/reaction/comment/share/message/lead_form`, ads `impression/click/conversion/spend`, and telemarketing `attempted/connected/interested/qualified/do_not_call`.
- `marketing_tracking_pixel_create`: create a signed per-audience email open pixel; raw audience identity is not retained.
- `marketing_channel_send`: send one approved campaign asset through the company’s paired WhatsApp or Slack transport. When no explicit `transport_agent_id` is supplied, the owner-scoped account configured for that Marketing channel is used automatically. A recipient must be the bound company target or a consent-granted member of the campaign’s selected distribution lists. Attribution remains Marketing Specialist, and Action Control governs the external effect.
- `marketing_engagement_record`: record follow-up evidence with a stable provider/event ID; campaign-bound evidence is also mirrored to the outcome ledger.
- `marketing_watch_upsert`, `marketing_watches_due`, `marketing_watch_result_record`: configure and operate read-only social/provider watches.
- `marketing_lead_prepare`: create or update one row in the multi-entry lead/opportunity portfolio. Use `lead_id` to update an exact row and include CRM person/opportunity references, campaign and evidence IDs, lifecycle stage, consent, follow-up state/channel/due date and next action. The tool combines prior campaign evidence into a scored, consent-aware profile before CRM handoff.
- `marketing_crm_handoff`: send one qualified, consent-eligible Marketing lead to the configured CRM. Pass only `lead_id`; the tool reuses an exact selected/matched CRM person when possible, otherwise creates the verified contact, creates the CRM lead/opportunity idempotently, and writes the returned references back to Marketing.
- `marketing_followup_update`: close or suppress an engagement only after follow-up evidence exists.

All Marketing tools except `marketing_channel_send` change internal records only. `marketing_channel_send` is an explicit R2 external action and cannot bypass Action Control.

The **Marketing page is optional**. Prefer these tools when the CEO gives an intent, goal or Objective in chat. The page reads and writes the same owner-scoped records and remains useful for human review or manual adjustment.

## Reused platform capabilities

- Knowledge/RAG tools provide company facts and approved documents.
- CRM read tools provide audience and pipeline context.
- Connector actions, browser recipes, email and calling tools perform channel operations only when granted and allowed by Action Control.
- Workflow and goal tools coordinate repeatable execution against objectives.
- Kanban and notifications handle handoffs, exceptions and CEO visibility.

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
