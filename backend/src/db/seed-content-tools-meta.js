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
