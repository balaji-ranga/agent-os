/**
 * Seed content_tools_meta with built-in tools if table is empty.
 * Called from initDb or on startup.
 */
import { getDb } from './schema.js';

const BUILTIN_TOOLS = [
  {
    name: 'summarize_url',
    display_name: 'Summarize URL',
    endpoint: '/api/tools/summarize-url',
    method: 'POST',
    purpose: 'Fetch a web page (HTTPS) and return a short summary and title. Retired URLs (e.g. old nasa.gov/mission_pages) may auto-remap; on 404 returns hint + suggested_url — try that or browser. Never invent page content.',
    model_used: 'gpt-4o-mini (optional, for summary)',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'generate_image',
    display_name: 'Generate Image',
    endpoint: '/api/tools/generate-image',
    method: 'POST',
    purpose:
      'Generate an image from a text prompt. Use for social/draft assets (travel, food, nature). After success, paste paste_exactly/media_uri (MEDIA:/abs/path) on its own line so WhatsApp embeds the file; Dashboard renders MEDIA: too. Do not paste auth-only https /api/media URLs (WhatsApp Media failed).',
    model_used: 'gpt-image-1 (OpenAI)',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'generate_video',
    display_name: 'Generate Video',
    endpoint: '/api/tools/generate-video',
    method: 'POST',
    purpose:
      'Generate a short video from a text prompt (Replicate). When ready, paste paste_exactly/media_uri (MEDIA:/abs/path) on its own line so WhatsApp attaches the video; Dashboard plays it inline. Do not paste auth-only https /api/media URLs.',
    model_used: 'zeroscope-v2-xl (Replicate)',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'kanban_move_status',
    display_name: 'Kanban Move Status',
    endpoint: '/api/tools/kanban-move-status',
    method: 'POST',
    purpose: 'API tool: move a Kanban task status. Invoke this tool by name with parameters task_id (number) and new_status (open, awaiting_confirmation, in_progress, completed, failed). Do not run via exec or shell—call the tool directly. Use in_progress when starting, completed/failed when done.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'kanban_reassign_to_coo',
    display_name: 'Kanban Reassign to COO',
    endpoint: '/api/tools/kanban-reassign-to-coo',
    method: 'POST',
    purpose: 'API tool: reassign a task back to the COO. Invoke by name with parameter task_id. Do not run via exec or shell.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'kanban_assign_task',
    display_name: 'Kanban Assign Task',
    endpoint: '/api/tools/kanban-assign-task',
    method: 'POST',
    purpose: 'API tool (COO only): assign a Kanban task to an agent. Invoke by name with task_id and to_agent_id. Sets status to open so the agent (or orphan watcher) can start; agent moves to awaiting_confirmation when CEO input is needed. Do not run via exec or shell.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'kanban_create_task',
    display_name: 'Kanban Create Task',
    endpoint: '/api/tools/kanban-create-task',
    method: 'POST',
    purpose:
      'API tool: create a Kanban task for the CEO. Invoke by name with title (required), optional description, optional assign_to (agent id or "coo"/omit for CEO inbox). New cards start as open (even when assigned); the assigned agent moves to awaiting_confirmation only when they need CEO input. Do not run via exec or shell.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'kanban_get_task',
    display_name: 'Kanban Get Task',
    endpoint: '/api/tools/kanban-get-task',
    method: 'POST',
    purpose:
      'API tool: read one Kanban task by task_id with full content — status, description, task messages, delegation_response/deliverable (completed agent work), and agent-chat turns (including archived). Use when the CEO asks what a task produced or to review a completed card. Do not run via exec or shell.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'kanban_watch_tick',
    display_name: 'Kanban Watch Tick',
    endpoint: '/api/tools/kanban-watch-tick',
    method: 'POST',
    purpose:
      'API tool (COO watch crons): check Kanban task_id; if still open/in_progress return reply NO_REPLY; if completed/failed return notify_text and automatically remove matching OpenClaw cron jobs (pass cron_job_id when known). Cron agent must reply with exactly the returned reply field. Do not run via exec or shell.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'intent_classify_and_delegate',
    display_name: 'Intent Classify and Delegate',
    endpoint: '/api/tools/intent-classify-and-delegate',
    method: 'POST',
    purpose: 'API tool (COO only): classify message intent and delegate. Invoke by name with message and optional standup_id. Do not run via exec or shell.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'agent_workflow_list',
    display_name: 'List Agent Workflows',
    endpoint: '/api/tools/agent-workflow-list',
    method: 'POST',
    purpose:
      'API tool (COO or Workflow Builder): list custom agent workflows for the entitled CEO (owner from session — never spoof ceo_user_id). Workflow Builder includes drafts by default; COO sees published non-paused. Optional chat_only / include_drafts. Use agent_workflow_enquire to search by description.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'agent_workflow_enquire',
    display_name: 'Enquire Agent Workflows',
    endpoint: '/api/tools/agent-workflow-enquire',
    method: 'POST',
    purpose:
      'API tool (COO or Workflow Builder): find workflows matching a natural-language query for the entitled CEO, or pass all: true. Workflow Builder includes drafts by default. Returns id, name, description, status, trigger_modes, chat_trigger_phrase, trigger_hint.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'agent_workflow_trigger',
    display_name: 'Trigger Agent Workflow',
    endpoint: '/api/tools/agent-workflow-trigger',
    method: 'POST',
    purpose:
      'API tool (COO or Workflow Builder): start a published custom agent workflow for the entitled CEO. Invoke with message containing the chat phrase OR workflow_id plus optional input. Owner from session only.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'agent_workflow_runs',
    display_name: 'Agent Workflow Runs',
    endpoint: '/api/tools/agent-workflow-runs',
    method: 'POST',
    purpose:
      'API tool (COO or Workflow Builder): list or inspect recent custom agent workflow run statuses/outcomes for the entitled CEO. Pass workflow_id or workflow_query/query to scope one workflow; omit to list recent runs across workflows; pass run_id to inspect one run (steps + errors). Owner from session only. Never use ibkr_order_learnings or other IBKR tools for workflow run status.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'agent_workflow_retry',
    display_name: 'Retry Agent Workflow Run',
    endpoint: '/api/tools/agent-workflow-retry',
    method: 'POST',
    purpose:
      'API tool (COO or Workflow Builder): retry a workflow run. Required: run_id, mode. mode=from_start starts a NEW run with the same (or override) input. mode=from_failed_step re-dispatches the failed step on the SAME run (optional node_id). Owner from session only. Inspect with agent_workflow_runs first.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'agent_workflow_get_draft',
    display_name: 'Get Workflow Draft',
    endpoint: '/api/tools/agent-workflow-get-draft',
    method: 'POST',
    purpose:
      'API tool (Workflow Builder agent): get draft graph and metadata for a workflow owned by the entitled CEO. Parameters: workflow_id (required).',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'agent_workflow_mutate',
    display_name: 'Mutate Workflow Draft',
    endpoint: '/api/tools/agent-workflow-mutate',
    method: 'POST',
    purpose:
      'API tool (Workflow Builder agent): create/update/test workflows for the entitled CEO. Parameters: workflow_id (optional for create_workflow), actions (JSON array). Actions include create_workflow, add_node, update_node, publish, test_workflow, until_success, until_certified (Maker/Checker certify). Prefer agent_workflow_certify_start for long autonomous builds so status can be polled. Do not run via exec.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'agent_workflow_certify_start',
    display_name: 'Start Workflow Certify',
    endpoint: '/api/tools/agent-workflow-certify-start',
    method: 'POST',
    purpose:
      'API tool (Workflow Builder): start an autonomous Maker/Checker certify job for the entitled CEO. Parameters: message (intent), optional workflow_id, optional max_attempts. Returns job_id immediately; poll with agent_workflow_certify_status. Do not run via exec.',
    model_used: 'platform LLM (Maker/Checker)',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'agent_workflow_certify_status',
    display_name: 'Workflow Certify Status',
    endpoint: '/api/tools/agent-workflow-certify-status',
    method: 'POST',
    purpose:
      'API tool (Workflow Builder or COO): get status of a certify job. Parameters: job_id and/or workflow_id and/or query (workflow name / intent substring). Returns status, attempt, input_requests, verdict. Pull-on-request — call when the CEO asks for an update.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'agent_workflow_certify_resume',
    display_name: 'Resume Workflow Certify',
    endpoint: '/api/tools/agent-workflow-certify-resume',
    method: 'POST',
    purpose:
      'API tool (Workflow Builder): resume a blocked certify job after the CEO provides inputs. Parameters: job_id (required), inputs (object keyed by request keys e.g. nodes.brain-1.task_config.apiKey).',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'learnings_summary',
    display_name: 'Learnings Summary',
    endpoint: '/api/tools/learnings-summary',
    method: 'POST',
    purpose:
      "API tool: summarize this user's past feedback (thumbs up/down) and Kanban approve/reject/comment actions for a topic. Invoke BEFORE starting any non-trivial task with optional topic and days (default 30). Owner is always the entitled CEO from session — never spoof ceo_user_id. Use the summary to avoid past mistakes and prefer patterns the user liked.",
    model_used: 'platform LLM (user BYOK if set)',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'brain_history',
    display_name: 'Brain History',
    endpoint: '/api/agent-workflows/brain-history',
    method: 'POST',
    purpose:
      'API tool: load prior Brain node I/O from workflow run-step audit for the entitled CEO. Body: workflow_id (string|array), node_id (string|array of brain node ids), days (default 7), response_type actual|summarized, optional limit/purpose. Only node_type=brain steps are returned — use summarized to compress maker/checker lessons into context_text. ' +
      'response_type=summarized is cached once per UTC day per scope and rebuilt automatically when new brain steps land, so repeat calls are free; pass force=true only if you must bypass the cache.',
    model_used: 'platform/BYOK LLM when response_type=summarized (daily cache)',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'content_tools_enquire',
    display_name: 'Enquire Content Tools',
    endpoint: '/api/tools/content-tools-enquire',
    method: 'POST',
    purpose:
      'API tool (Workflow Builder): list or search ALL registered content tools by purpose. Pass query (natural language intent) to rank recommendations, or all: true for the full catalog. Returns name, display_name, purpose, top_recommendation, and how to wire a tool node (toolName). Use before adding tool nodes or when advising which content tool fits a user request.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'connector_list_apps',
    display_name: 'Connectors — List Connected Apps',
    endpoint: '/api/tools/connector-list-apps',
    method: 'POST',
    purpose:
      'API tool: list OpenConnector apps already connected for the entitled CEO. Use before execute — owner is always session CEO. Prefer connector_* tools over raw mcp_tool for SaaS integrations.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'connector_search_actions',
    display_name: 'Connectors — Search Actions',
    endpoint: '/api/tools/connector-search-actions',
    method: 'POST',
    purpose:
      'API tool: search the OpenConnector catalog for actions/apps. Pass query (e.g. gmail send, github issues). Returns action ids suitable for connector_execute_action.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'connector_get_action_guide',
    display_name: 'Connectors — Action Guide',
    endpoint: '/api/tools/connector-get-action-guide',
    method: 'POST',
    purpose:
      'API tool: fetch markdown input guide for one OpenConnector action id before calling connector_execute_action.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'connector_execute_action',
    display_name: 'Connectors — Execute Action',
    endpoint: '/api/tools/connector-execute-action',
    method: 'POST',
    purpose:
      'API tool: execute an OpenConnector action for the entitled CEO. Required: action_id (e.g. hackernews.get_top_stories). Optional: input (object), connection_name. Uses per-CEO runtime token + default connection alias.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'email_send',
    display_name: 'Send Email & Calendar Invite',
    endpoint: '/api/tools/email-send',
    method: 'POST',
    purpose:
      'Send email via SMTP. For calendar invites pass calendar:{title,start,end,...} as ISO 8601 JSON — never paste BEGIN:VCALENDAR text in body. Optional attachments:[{filename,content}] or ics shortcut. Uses WORKFLOW_SMTP_* env.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'platform_feedback_submit',
    display_name: 'Submit Platform Feedback',
    endpoint: '/api/tools/platform-feedback-submit',
    method: 'POST',
    purpose:
      'API tool (COO): file a platform bug, feedback, or enhancement for Admin. Parameters: title (required), optional category (bug|feedback|enhancement), body. Returns id + status=open. Do not run via exec.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'platform_feedback_enquire',
    display_name: 'Enquire Platform Feedback Status',
    endpoint: '/api/tools/platform-feedback-enquire',
    method: 'POST',
    purpose:
      'API tool (COO / Platform Help): look up platform feedback by id or filter status/category/query. Returns status (open|implemented|rejected) and status_reason. Do not run via exec.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'speech_tts',
    display_name: 'Speech TTS (Piper)',
    endpoint: '/api/tools/speech-tts',
    method: 'POST',
    purpose:
      'API tool: free local Piper TTS. Invoke with text (required), optional voice, length_scale, format (wav default|mp3|m4a|ogg|opus). Returns paste_exactly/media_uri — WhatsApp MEDIA: uses OGG/Opus (or MP3); WAV often Media-fails. Dashboard plays inline. Prefer this over ElevenLabs when free speech is enough.',
    model_used: 'piper',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'speech_stt',
    display_name: 'Speech STT (Whisper)',
    endpoint: '/api/tools/speech-stt',
    method: 'POST',
    purpose:
      'API tool: free local speech-to-text via Whisper (SPEECH_STT_URL / optional-voice). Invoke with artifact_id or media_ref/audio from a prior speech_tts/upload, or content_base64 (+ filename/mime_type). Optional language, model. Returns text transcript. Do not run via exec or shell.',
    model_used: 'whisper',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'analyze_image',
    display_name: 'Analyze Image (Vision / OCR)',
    endpoint: '/api/tools/analyze-image',
    method: 'POST',
    purpose:
      'API tool: describe, OCR, or review an inbound image (WhatsApp / chat paperclip). Invoke with path or relative_path from list_inbound_attachments (inbound/attachments/…), or MEDIA:/…, or content_base64. Optional mode: full|describe|ocr|review; optional prompt for custom focus (e.g. YouTube thumbnail legibility). Returns description + ocr_text. Prefer this over the built-in image tool. Do not run via exec or shell.',
    model_used: 'vision',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'notify_ceo',
    display_name: 'Notify CEO (Push)',
    endpoint: '/api/tools/notify-ceo',
    method: 'POST',
    purpose:
      'Send an in-app push to the entitled CEO ONLY when they asked you to reach/notify/ping them, or for a true blocker/approval while they are NOT already in your Dashboard chat. Do NOT call this for ordinary chat replies, task acknowledgements, or research/content answers — reply in chat instead. Never pass user_id. Parameters: title (required), body?, link_url? (prefer /agents/<your-id>/chat), source_key?.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'onboarding_save_proposal',
    display_name: 'Save Onboarding Proposal',
    endpoint: '/api/tools/onboarding-save-proposal',
    method: 'POST',
    purpose:
      'API tool (Onboarding Helper): save a structured onboarding proposal for the entitled CEO. Parameters: departments, agents, tools, workflows, channels, md_files. It opens /onboarding at selective review; it does not apply changes. Do not run via exec or shell.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'onboarding_apply_proposal',
    display_name: 'Apply Onboarding Proposal',
    endpoint: '/api/tools/onboarding-apply-proposal',
    method: 'POST',
    purpose:
      'API tool (Onboarding Helper): apply the CEO-selected onboarding proposal only after explicit CEO confirmation. Required: confirm_override:true. Optional: selected map from /onboarding review. Do not call merely after drafting; do not run via exec or shell.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'ceo_profile',
    display_name: 'CEO Profile (Account)',
    endpoint: '/api/tools/ceo-profile',
    method: 'POST',
    purpose:
      'API tool: return this org CEO\'s platform account profile (name, email, mobile, region, business_name, industry). ' +
      'ALWAYS call this before answering questions about the CEO\'s identity/contact details — do NOT invent from chat memory. ' +
      'Never pass user_id (owner is session-scoped). Optional: fields:[\"email\",\"name\",...] to request a subset. ' +
      'If a needed field is empty in missing_or_empty, ask the CEO or fall back to chat memory and say so.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'status_checker',
    display_name: 'COO Status Checker',
    endpoint: '/api/tools/status-checker',
    method: 'POST',
    purpose:
      'API tool (COO only): reconcile A2A/Kanban task status and post a digest to the CEO standup chat (returns HTML). Does NOT email — the daily platform batch cron sends the HTML email. Optional: post_standup (default true). Do not invent task outcomes — Kanban is source of truth.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'master_data_list_tables',
    display_name: 'Master Data — List Tables',
    endpoint: '/api/tools/master-data-list-tables',
    method: 'POST',
    purpose:
      'API tool: DISCOVERY ONLY — list this CEO\'s Master Data tables with name, purpose/description, columns, row_count. ' +
      'After calling this, you MUST pick the table whose purpose best matches the user question, then call master_data_list_rows on that table. ' +
      'Never answer the user with only the table catalog. Example: "what departments exist?" → list_tables → then list_rows on the departments (or purpose-matching) table. ' +
      'For questions about uploaded PDFs/docs/policies, use master_data_rag (or list_documents then rag) — not this tool. Strictly owner-scoped. No schema create/alter/drop.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'master_data_list_rows',
    display_name: 'Master Data — List / Query Rows',
    endpoint: '/api/tools/master-data-list-rows',
    method: 'POST',
    purpose:
      'API tool: READ DATA from an existing Master Data table. Required: table_name or table_id (from list_tables purpose match). Optional: query, column, equals, limit, offset. ' +
      'Use this to answer factual org questions (departments, employees, lookup values). Do not stop after list_tables. No schema changes.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'master_data_insert_row',
    display_name: 'Master Data — Insert Row',
    endpoint: '/api/tools/master-data-insert-row',
    method: 'POST',
    purpose:
      'API tool: insert one row into an existing Master Data table for this CEO. Parameters: table_name or table_id, data:{column:value}. Cannot create tables or add columns.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'master_data_update_row',
    display_name: 'Master Data — Update Row',
    endpoint: '/api/tools/master-data-update-row',
    method: 'POST',
    purpose:
      'API tool: update a row by row_id in an existing Master Data table for this CEO. Parameters: table_name or table_id, row_id, data:{column:value}. No alter/drop table.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'master_data_delete_row',
    display_name: 'Master Data — Delete Row',
    endpoint: '/api/tools/master-data-delete-row',
    method: 'POST',
    purpose:
      'API tool: delete a row by row_id from an existing Master Data table for this CEO. Parameters: table_name or table_id, row_id. Never drops the table.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'master_data_list_documents',
    display_name: 'Master Data — List Documents',
    endpoint: '/api/tools/master-data-list-documents',
    method: 'POST',
    purpose:
      'API tool: DISCOVERY for already-indexed Master Data documents (title, filename, document_id, chunk_count). ' +
      'Use when the CEO asks which docs are indexed, or to find a resume/PDF by name after list_inbound does not match. ' +
      'Then master_data_rag with query (optional document_id). For raw bytes still only in inbound (not indexed), use list_inbound_attachments first. ' +
      'Do not use for structured table questions (departments etc.) — those use list_tables → list_rows.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'master_data_rag',
    display_name: 'Master Data — RAG Search',
    endpoint: '/api/tools/master-data-rag',
    method: 'POST',
    purpose:
      'API tool: answer questions from this CEO\'s uploaded Master Data documents (PDF, Word .docx, Excel, text) via keyword retrieval. ' +
      'Parameters: query (required), optional document_id, top_k, summarize. ' +
      'summarize defaults to FALSE — you get raw excerpts in chunks[] and write the answer yourself; only pass summarize=true when excerpts are too long or scattered to answer directly. ' +
      'Use when the ask is about document content, policies, resumes, handbooks, or "what does the doc say…". ' +
      'Do NOT use for structured master tables (use list_tables → list_rows by purpose). Prefer rag directly with the user question; list_documents only if you need document_id.',
    model_used: 'platform/BYOK LLM only when summarize=true',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'list_inbound_attachments',
    display_name: 'List Inbound Attachments',
    endpoint: '/api/tools/list-inbound-attachments',
    method: 'POST',
    purpose:
      'API tool: list files in this CEO\'s workspace inbound/attachments (chat paperclip, WhatsApp, channel uploads). ' +
      'Use when the CEO asks to find, download, attach, or re-send a previously uploaded file/PDF/resume. ' +
      'Returns relative_path, size, rag_indexable, is_media, download_url, paste_in_chat (markdown link for Dashboard). ' +
      'To put the file back in chat: paste paste_in_chat in your reply. ' +
      'For PDF/Word/Excel/text content Q&A: call master_data_index_document then master_data_rag. ' +
      'For images/audio/video: leave in inbound (no RAG); use analyze_image / speech_stt. No parameters.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'master_data_index_document',
    display_name: 'Master Data — Index Document (RAG)',
    endpoint: '/api/tools/master-data-index-document',
    method: 'POST',
    purpose:
      'API tool: index a RAG-able document into this CEO\'s OpenSearch Master Data indices (same as Master Data → Documents). ' +
      'Prefer relative_path from list_inbound_attachments (inbound/attachments/…). Or content_base64 / content_text + filename. ' +
      'Optional title, mime_type, tags. Rejects images/audio/video. Supported: PDF, Word .docx, Excel, txt/md/csv/json/html/xml. ' +
      'Owner is session-scoped (never pass owner_user_id). After indexing, call master_data_rag with the question (optional document_id).',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'vedic_compute_chart',
    display_name: 'Vedic Astrology — Compute Chart Data',
    endpoint: '/api/tools/vedic-compute-chart',
    method: 'POST',
    purpose:
      'Compute sidereal (Lahiri) Jyotish chart from birth date/time/place: Lagna, grahas, houses, optional Navāṁśa (D-9) and Vimśottarī daśā. ' +
      'Also auto-renders North/South Indian SVG charts and returns visuals_markdown + chart_urls — paste visuals_markdown at the TOP of the chat reply. ' +
      'Parameters: birth_date (YYYY-MM-DD), birth_time (HH:MM), timezone_offset_hours, latitude, longitude, optional place_name, chart_style (north|south|both), include_navamsa, include_dasha. ' +
      'Do NOT use generate_image for kundli diagrams.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'generate_chart',
    display_name: 'Generate Chart (from JSON spec)',
    endpoint: '/api/tools/generate-chart',
    method: 'POST',
    purpose:
      'Generic chart renderer: pass a chart_spec JSON (schema_version "1.0") with charts[].type = vedic_north_indian | vedic_south_indian | labeled_grid. ' +
      'Body: { spec: { schema_version, charts } } or the spec object; optional return_schema:true to fetch the JSON schema + example. ' +
      'Returns chart_urls and visuals_markdown — paste URLs at the top of the chat reply. Not Vedic-specific; granted only to agents that need diagrams.',
    model_used: '',
    enabled: 1,
    is_builtin: 1,
  },
];


const KANBAN_TOOLS = BUILTIN_TOOLS.filter((t) =>
  [
    'kanban_move_status',
    'kanban_reassign_to_coo',
    'kanban_assign_task',
    'kanban_create_task',
    'kanban_get_task',
    'kanban_watch_tick',
    'intent_classify_and_delegate',
  ].includes(t.name)
);

const WORKFLOW_TOOLS = BUILTIN_TOOLS.filter((t) =>
  [
    'agent_workflow_list',
    'agent_workflow_enquire',
    'agent_workflow_trigger',
    'agent_workflow_runs',
    'agent_workflow_retry',
    'agent_workflow_get_draft',
    'agent_workflow_mutate',
    'agent_workflow_certify_start',
    'agent_workflow_certify_status',
    'agent_workflow_certify_resume',
    'brain_history',
    'content_tools_enquire',
  ].includes(t.name)
);

const LEARNINGS_TOOLS = BUILTIN_TOOLS.filter((t) => t.name === 'learnings_summary');
const EMAIL_SEND_TOOLS = BUILTIN_TOOLS.filter((t) => t.name === 'email_send');
const SPEECH_TOOLS = BUILTIN_TOOLS.filter((t) => t.name === 'speech_tts' || t.name === 'speech_stt');
const VISION_TOOLS = BUILTIN_TOOLS.filter((t) => t.name === 'analyze_image');
const NOTIFY_CEO_TOOLS = BUILTIN_TOOLS.filter((t) => t.name === 'notify_ceo');
const ONBOARDING_PROPOSAL_TOOLS = BUILTIN_TOOLS.filter((t) =>
  t.name === 'onboarding_save_proposal' || t.name === 'onboarding_apply_proposal'
);
const CEO_PROFILE_TOOLS = BUILTIN_TOOLS.filter((t) => t.name === 'ceo_profile');
const STATUS_CHECKER_TOOLS = BUILTIN_TOOLS.filter((t) => t.name === 'status_checker');
const CONNECTOR_TOOLS = BUILTIN_TOOLS.filter((t) => String(t.name).startsWith('connector_'));
const MASTER_DATA_TOOLS = BUILTIN_TOOLS.filter(
  (t) => String(t.name).startsWith('master_data_') || t.name === 'list_inbound_attachments'
);
const VEDIC_TOOLS = BUILTIN_TOOLS.filter((t) => t.name === 'vedic_compute_chart');
const CHART_TOOLS = BUILTIN_TOOLS.filter((t) => t.name === 'generate_chart');

export function seedContentToolsMetaIfEmpty() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS n FROM content_tools_meta').get().n;
  if (count > 0) return;
  const stmt = db.prepare(
    `INSERT INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of BUILTIN_TOOLS) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
  }
}

/** Add Kanban and intent tools if missing (for existing DBs). */
export function seedKanbanToolsIfMissing() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of KANBAN_TOOLS) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
  }
}

/** Add workflow chat tools if missing (for existing DBs). */
export function seedWorkflowToolsIfMissing() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of WORKFLOW_TOOLS) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
  }
  const update = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ?, model_used = ? WHERE name = ?'
  );
  for (const t of WORKFLOW_TOOLS) {
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.model_used, t.name);
  }
}

/** Update purpose for Kanban/intent tools so they state "API tool" and "do not run via exec" (fixes agents using exec). */
export function updateKanbanToolPurposes() {
  const db = getDb();
  const update = db.prepare('UPDATE content_tools_meta SET purpose = ? WHERE name = ?');
  for (const t of KANBAN_TOOLS) {
    update.run(t.purpose, t.name);
  }
}

/** Add learnings_summary tool if missing (for existing DBs). */
export function seedLearningsToolsIfMissing() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of LEARNINGS_TOOLS) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
  }
  const update = db.prepare('UPDATE content_tools_meta SET purpose = ?, display_name = ? WHERE name = ?');
  for (const t of LEARNINGS_TOOLS) {
    update.run(t.purpose, t.display_name, t.name);
  }
}

/** Add email_send tool if missing (for existing DBs). */
export function seedEmailSendToolIfMissing() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of EMAIL_SEND_TOOLS) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
  }
  const update = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ? WHERE name = ?'
  );
  for (const t of EMAIL_SEND_TOOLS) {
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.name);
  }
}

/** Add speech_tts / speech_stt (Piper + Whisper) if missing. */
export function seedSpeechToolsIfMissing() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of SPEECH_TOOLS) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
  }
  const update = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ?, model_used = ? WHERE name = ?'
  );
  for (const t of SPEECH_TOOLS) {
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.model_used, t.name);
  }
}

/** Add analyze_image (vision / OCR) if missing. */
export function seedVisionToolsIfMissing() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of VISION_TOOLS) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
  }
  const update = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ?, model_used = ? WHERE name = ?'
  );
  for (const t of VISION_TOOLS) {
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.model_used, t.name);
  }
}

/** Add notify_ceo tool if missing (for existing DBs). */
export function seedNotifyCeoToolIfMissing() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of NOTIFY_CEO_TOOLS) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
  }
  const update = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ? WHERE name = ?'
  );
  for (const t of NOTIFY_CEO_TOOLS) {
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.name);
  }
}

/** Add Onboarding Helper proposal tools if missing (for existing DBs). */
export function seedOnboardingProposalToolsIfMissing() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const update = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ? WHERE name = ?'
  );
  for (const t of ONBOARDING_PROPOSAL_TOOLS) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.name);
  }
}

/** Add ceo_profile tool if missing (for existing DBs). */
export function seedCeoProfileToolIfMissing() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of CEO_PROFILE_TOOLS) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
  }
  const update = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ? WHERE name = ?'
  );
  for (const t of CEO_PROFILE_TOOLS) {
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.name);
  }
}

/** Add status_checker tool if missing (COO only; for existing DBs). */
export function seedStatusCheckerToolIfMissing() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of STATUS_CHECKER_TOOLS) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
  }
  const update = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ? WHERE name = ?'
  );
  for (const t of STATUS_CHECKER_TOOLS) {
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.name);
  }
}

/** Add Master Data + RAG content tools if missing (for existing DBs). */
export function seedMasterDataToolsIfMissing() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of MASTER_DATA_TOOLS) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
  }
  const update = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ?, model_used = ? WHERE name = ?'
  );
  for (const t of MASTER_DATA_TOOLS) {
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.model_used, t.name);
  }
}

/** Add OpenConnector connector content tools if missing (for existing DBs). */
export function seedConnectorToolsIfMissing() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of CONNECTOR_TOOLS) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
  }
  const update = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ? WHERE name = ?'
  );
  for (const t of CONNECTOR_TOOLS) {
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.name);
  }
}

/** Add Vedic ephemeris + generic generate_chart tools if missing. */
export function seedVedicChartToolIfMissing() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const update = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ? WHERE name = ?'
  );
  for (const t of [...VEDIC_TOOLS, ...CHART_TOOLS]) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.name);
  }
}

/** Alias — seed generic chart tool (same as seedVedicChartToolIfMissing for generate_chart). */
export function seedGenerateChartToolIfMissing() {
  seedVedicChartToolIfMissing();
}


const PLATFORM_FEEDBACK_TOOLS = BUILTIN_TOOLS.filter(
  (t) => t.name === 'platform_feedback_submit' || t.name === 'platform_feedback_enquire'
);

/** Add platform feedback tools if missing. */
export function seedPlatformFeedbackToolsIfMissing() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of PLATFORM_FEEDBACK_TOOLS) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
  }
  const update = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ? WHERE name = ?'
  );
  for (const t of PLATFORM_FEEDBACK_TOOLS) {
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.name);
  }
}

export function grantPlatformFeedbackTools() {
  const db = getDb();
  const ins = db.prepare('INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)');
  const agents = db.prepare('SELECT id FROM agents').all();
  let n = 0;
  for (const a of agents) {
    const id = String(a.id || '').toLowerCase();
    const isCoo = id === 'balserve' || id.endsWith('--balserve') || /(^|--)coo$/.test(id);
    const isHelp = id === 'platformhelp' || id.endsWith('--platformhelp');
    if (isCoo) {
      if (ins.run(a.id, 'platform_feedback_submit').changes) n += 1;
      if (ins.run(a.id, 'platform_feedback_enquire').changes) n += 1;
    } else if (isHelp) {
      if (ins.run(a.id, 'platform_feedback_enquire').changes) n += 1;
    }
  }
  return n;
}