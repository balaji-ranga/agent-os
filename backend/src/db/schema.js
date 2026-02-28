import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getDbPath() {
  const dataDir = process.env.AGENT_OS_DATA_DIR || join(__dirname, '../../data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  return join(dataDir, 'agent-os.db');
}

let _db = null;

export function initDb() {
  if (_db) return _db;
  _db = new Database(getDbPath());
  _db.pragma('journal_mode = WAL');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT DEFAULT '',
      parent_id TEXT,
      workspace_path TEXT,
      openclaw_agent_id TEXT DEFAULT 'main',
      is_coo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS chat_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS workspace_files (
      name TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      last_modified TEXT
    );

    CREATE TABLE IF NOT EXISTS standups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scheduled_at TEXT NOT NULL,
      status TEXT DEFAULT 'scheduled',
      coo_summary TEXT,
      ceo_summary TEXT,
      source TEXT DEFAULT 'manual',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS standup_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      standup_id INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      submitted_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (standup_id) REFERENCES standups(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE INDEX IF NOT EXISTS idx_activities_agent ON activities(agent_id);
    CREATE INDEX IF NOT EXISTS idx_chat_turns_agent ON chat_turns(agent_id);
    CREATE TABLE IF NOT EXISTS standup_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      standup_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (standup_id) REFERENCES standups(id)
    );

    CREATE TABLE IF NOT EXISTS agent_delegation_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      standup_id INTEGER NOT NULL,
      request_id TEXT NOT NULL,
      to_agent_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      response_content TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (standup_id) REFERENCES standups(id),
      FOREIGN KEY (to_agent_id) REFERENCES agents(id)
    );

    CREATE INDEX IF NOT EXISTS idx_standup_responses_standup ON standup_responses(standup_id);
    CREATE INDEX IF NOT EXISTS idx_standup_messages_standup ON standup_messages(standup_id);
    CREATE TABLE IF NOT EXISTS delegation_callbacks (
      request_id TEXT PRIMARY KEY,
      posted_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_delegation_tasks_status ON agent_delegation_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_delegation_tasks_request ON agent_delegation_tasks(request_id);

    CREATE TABLE IF NOT EXISTS content_tool_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL,
      source TEXT,
      request_payload TEXT,
      response_payload TEXT,
      status TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_content_tool_logs_created ON content_tool_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_tool_logs_tool ON content_tool_logs(tool_name);

    CREATE TABLE IF NOT EXISTS content_tools_meta (
      name TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT DEFAULT 'POST',
      purpose TEXT DEFAULT '',
      model_used TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      is_builtin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      auth_header TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_content_tools_meta_enabled ON content_tools_meta(enabled);

    CREATE TABLE IF NOT EXISTS kanban_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'open',
      assigned_agent_id TEXT,
      created_by TEXT DEFAULT 'user',
      standup_id INTEGER,
      agent_delegation_task_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      due_date TEXT,
      FOREIGN KEY (assigned_agent_id) REFERENCES agents(id),
      FOREIGN KEY (standup_id) REFERENCES standups(id),
      FOREIGN KEY (agent_delegation_task_id) REFERENCES agent_delegation_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_kanban_tasks_status ON kanban_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_kanban_tasks_assigned ON kanban_tasks(assigned_agent_id);
    CREATE INDEX IF NOT EXISTS idx_kanban_tasks_created ON kanban_tasks(created_at);

    CREATE TABLE IF NOT EXISTS task_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES kanban_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_messages_task ON task_messages(task_id);
  `);

  try {
    _db.exec(`ALTER TABLE standups ADD COLUMN source TEXT DEFAULT 'manual'`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE standups ADD COLUMN approved_at TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE standups ADD COLUMN title TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE standups ADD COLUMN outcomes TEXT`);
  } catch (_) {}
  try {
    _db.exec(`CREATE TABLE standup_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, standup_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (standup_id) REFERENCES standups(id))`);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_standup_messages_standup ON standup_messages(standup_id)`);
  } catch (_) {}
  try {
    _db.exec(`CREATE TABLE agent_delegation_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, standup_id INTEGER NOT NULL, request_id TEXT NOT NULL, to_agent_id TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT DEFAULT 'pending', response_content TEXT, error_message TEXT, created_at TEXT DEFAULT (datetime('now')), completed_at TEXT, FOREIGN KEY (standup_id) REFERENCES standups(id), FOREIGN KEY (to_agent_id) REFERENCES agents(id))`);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_delegation_tasks_status ON agent_delegation_tasks(status)`);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_delegation_tasks_request ON agent_delegation_tasks(request_id)`);
  } catch (_) {}
  try {
    _db.exec(`CREATE TABLE delegation_callbacks (request_id TEXT PRIMARY KEY, posted_at TEXT DEFAULT (datetime('now')))`);
  } catch (_) {}
  try {
    _db.exec(`CREATE TABLE content_tool_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_name TEXT NOT NULL, source TEXT, request_payload TEXT, response_payload TEXT, status TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_content_tool_logs_created ON content_tool_logs(created_at DESC)`);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_content_tool_logs_tool ON content_tool_logs(tool_name)`);
  } catch (_) {}
  try {
    _db.exec(`CREATE TABLE content_tools_meta (name TEXT PRIMARY KEY, display_name TEXT NOT NULL, endpoint TEXT NOT NULL, method TEXT DEFAULT 'POST', purpose TEXT DEFAULT '', model_used TEXT DEFAULT '', enabled INTEGER DEFAULT 1, is_builtin INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), auth_header TEXT DEFAULT '')`);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_content_tools_meta_enabled ON content_tools_meta(enabled)`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE content_tools_meta ADD COLUMN auth_header TEXT DEFAULT ''`);
  } catch (_) {}
  try {
    _db.exec(`CREATE TABLE kanban_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT DEFAULT '', status TEXT DEFAULT 'open', assigned_agent_id TEXT, created_by TEXT DEFAULT 'user', standup_id INTEGER, agent_delegation_task_id INTEGER, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), due_date TEXT, FOREIGN KEY (assigned_agent_id) REFERENCES agents(id), FOREIGN KEY (standup_id) REFERENCES standups(id), FOREIGN KEY (agent_delegation_task_id) REFERENCES agent_delegation_tasks(id))`);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_kanban_tasks_status ON kanban_tasks(status)`);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_kanban_tasks_assigned ON kanban_tasks(assigned_agent_id)`);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_kanban_tasks_created ON kanban_tasks(created_at)`);
  } catch (_) {}
  try {
    _db.exec(`CREATE TABLE task_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (task_id) REFERENCES kanban_tasks(id))`);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_task_messages_task ON task_messages(task_id)`);
  } catch (_) {}

  return _db;
}

export function getDb() {
  if (!_db) initDb();
  return _db;
}

export { getDbPath };
