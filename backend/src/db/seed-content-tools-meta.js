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
    purpose: 'Fetch a web page (HTTPS) and return a short summary and title. Use for research and citing sources.',
    model_used: 'gpt-4o-mini (optional, for summary)',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'generate_image',
    display_name: 'Generate Image',
    endpoint: '/api/tools/generate-image',
    method: 'POST',
    purpose: 'Generate an image from a text prompt. Use for social/draft assets (travel, food, nature).',
    model_used: 'gpt-image-1 (OpenAI)',
    enabled: 1,
    is_builtin: 1,
  },
  {
    name: 'generate_video',
    display_name: 'Generate Video',
    endpoint: '/api/tools/generate-video',
    method: 'POST',
    purpose: 'Generate a short video from a text prompt. Use for draft assets.',
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
    purpose: 'API tool (COO only): assign a Kanban task to an agent. Invoke by name with task_id and to_agent_id. Do not run via exec or shell.',
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
      'API tool: create a Kanban task for the CEO. Invoke by name with title (required), optional description, optional assign_to (agent id or "coo"/omit for CEO inbox). Do not run via exec or shell.',
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
      'API tool (Workflow Builder agent): create/update/test workflows for the entitled CEO. Parameters: workflow_id (optional for create_workflow), actions (JSON array). Actions include create_workflow, add_node, update_node, publish, test_workflow, until_success (build-test-iterate), list_runs, inspect_run. Do not run via exec.',
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
      'API tool: load prior Brain node I/O from workflow run-step audit for the entitled CEO. Body: workflow_id (string|array), node_id (string|array of brain node ids), days (default 7), response_type actual|summarized, optional limit/purpose. Only node_type=brain steps are returned — use summarized to compress maker/checker lessons into context_text.',
    model_used: 'platform LLM when response_type=summarized',
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
      'API tool: DISCOVERY for uploaded documents (title, filename, chunk_count). Use when the user asks about files/PDFs and you need an id, then call master_data_rag with query. ' +
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
      'API tool: answer questions from this CEO\'s uploaded Master Data documents (PDF, Word .docx, Excel, text) via keyword retrieval (+ optional summary). ' +
      'Parameters: query (required), optional document_id, top_k, summarize. ' +
      'Use when the ask is about document content, policies, resumes, handbooks, or "what does the doc say…". ' +
      'Do NOT use for structured master tables (use list_tables → list_rows by purpose). Prefer rag directly with the user question; list_documents only if you need document_id.',
    model_used: 'platform LLM when summarize=true',
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
    'intent_classify_and_delegate',
  ].includes(t.name)
);

const WORKFLOW_TOOLS = BUILTIN_TOOLS.filter((t) =>
  [
    'agent_workflow_list',
    'agent_workflow_enquire',
    'agent_workflow_trigger',
    'agent_workflow_get_draft',
    'agent_workflow_mutate',
    'brain_history',
    'content_tools_enquire',
  ].includes(t.name)
);

const LEARNINGS_TOOLS = BUILTIN_TOOLS.filter((t) => t.name === 'learnings_summary');
const EMAIL_SEND_TOOLS = BUILTIN_TOOLS.filter((t) => t.name === 'email_send');
const NOTIFY_CEO_TOOLS = BUILTIN_TOOLS.filter((t) => t.name === 'notify_ceo');
const CONNECTOR_TOOLS = BUILTIN_TOOLS.filter((t) => String(t.name).startsWith('connector_'));
const MASTER_DATA_TOOLS = BUILTIN_TOOLS.filter((t) => String(t.name).startsWith('master_data_'));

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
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ? WHERE name = ?'
  );
  for (const t of WORKFLOW_TOOLS) {
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.name);
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
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ? WHERE name = ?'
  );
  for (const t of MASTER_DATA_TOOLS) {
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.name);
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
