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
      is_orchestrator INTEGER DEFAULT 0,
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
      owner_user_id TEXT NOT NULL DEFAULT 'default',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      session_id TEXT,
      work_unit_id TEXT,
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
      owner_user_id TEXT,
      parent_work_unit_id TEXT,
      parent_agent_id TEXT,
      callback_delivered_at TEXT,
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
      owner_user_id TEXT,
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
    _db.exec(`ALTER TABLE standups ADD COLUMN last_scheduled_run_at TEXT`);
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

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS job_search_profiles (
        id TEXT NOT NULL,
        ceo_user_id TEXT NOT NULL DEFAULT 'default',
        display_name TEXT DEFAULT '',
        status TEXT DEFAULT 'draft',
        intake_json TEXT DEFAULT '{}',
        version INTEGER DEFAULT 1,
        confirmed_at TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (ceo_user_id, id)
      )
    `);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE job_search_profiles ADD COLUMN ceo_user_id TEXT DEFAULT 'default'`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE job_search_profiles ADD COLUMN display_name TEXT DEFAULT ''`);
  } catch (_) {}
  try {
    _db.exec(`UPDATE job_search_profiles SET ceo_user_id = 'default' WHERE ceo_user_id IS NULL OR ceo_user_id = ''`);
  } catch (_) {}
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS job_search_ceo_settings (
        ceo_user_id TEXT PRIMARY KEY,
        active_profile_id TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE job_applications ADD COLUMN profile_id TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE job_applications ADD COLUMN ceo_user_id TEXT DEFAULT 'default'`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE job_pipeline_state ADD COLUMN ceo_user_id TEXT DEFAULT 'default'`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE job_pipeline_state ADD COLUMN active_profile_id TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE job_pipeline_state ADD COLUMN active_workflow_run_id INTEGER`);
  } catch (_) {}
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS job_applications (
        job_id TEXT PRIMARY KEY,
        status TEXT DEFAULT 'discovered',
        source TEXT,
        company TEXT,
        title TEXT,
        location TEXT,
        url TEXT,
        fit_score REAL,
        fit_rationale TEXT,
        why_me_summary TEXT,
        cover_letter_text TEXT,
        tailoring_notes TEXT,
        owner_action TEXT,
        application_notes TEXT,
        extra_json TEXT,
        discovered_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_job_applications_status ON job_applications(status)`);
  } catch (_) {}
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS job_pipeline_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        standup_id INTEGER,
        enabled INTEGER DEFAULT 0,
        last_discovery_at TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE job_search_profiles ADD COLUMN last_pipeline_run_at TEXT`);
  } catch (_) {}
  try {
    _db.exec(`INSERT OR IGNORE INTO job_pipeline_state (id, enabled) VALUES (1, 0)`);
  } catch (_) {}
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS job_workflow_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_number INTEGER NOT NULL,
        ceo_user_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        workflow_goal TEXT DEFAULT 'job_application',
        status TEXT DEFAULT 'running',
        trigger TEXT DEFAULT 'manual',
        started_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        kanban_ceo_review_task_id INTEGER,
        metadata_json TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS job_workflow_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_run_id INTEGER NOT NULL,
        step_key TEXT NOT NULL,
        step_label TEXT NOT NULL,
        step_order INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        actor_type TEXT,
        actor_id TEXT,
        started_at TEXT,
        completed_at TEXT,
        detail_json TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (workflow_run_id) REFERENCES job_workflow_runs(id)
      )
    `);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_job_workflow_runs_profile ON job_workflow_runs(ceo_user_id, profile_id)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_job_workflow_steps_run ON job_workflow_steps(workflow_run_id)`);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS platform_users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        region TEXT DEFAULT '',
        mobile TEXT DEFAULT '',
        role TEXT NOT NULL CHECK (role IN ('admin', 'ceo', 'org_user')),
        enabled INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS platform_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES platform_users(id)
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS user_agents (
        user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        granted_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, agent_id),
        FOREIGN KEY (user_id) REFERENCES platform_users(id),
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      )
    `);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_users_email ON platform_users(email)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_user_agents_user ON user_agents(user_id)`);
  } catch (_) {}

  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN ceo_db_mode TEXT DEFAULT 'tenant'`);
  } catch (_) {}
  try {
    const balaId = (process.env.AGENT_OS_BALA_CEO_ID || 'ceo-bala').trim();
    _db.prepare(`UPDATE platform_users SET ceo_db_mode = 'shared' WHERE id = ?`).run(balaId);
    _db.prepare(`UPDATE platform_users SET ceo_db_mode = 'shared' WHERE id = 'default'`);
  } catch (_) {}

  try {
    _db.exec(`ALTER TABLE agents ADD COLUMN agent_type TEXT DEFAULT 'standard'`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE agents ADD COLUMN owner_user_id TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE agents ADD COLUMN department TEXT DEFAULT ''`);
  } catch (_) {}
  try {
    _db.exec(`UPDATE agents SET agent_type = 'standard' WHERE agent_type IS NULL OR agent_type = ''`);
  } catch (_) {}
  try {
    // Backfill known standard agents when department is empty
    const deptById = {
      balserve: 'Executive',
      techresearcher: 'Research',
      expensemanager: 'Finance',
      socialasstant: 'Social',
      jobdiscovery: 'Job Pipeline',
      fitscorer: 'Job Pipeline',
      resumetailor: 'Job Pipeline',
      applicationagent: 'Job Pipeline',
      workflowbuilder: 'Engineering',
      platformhelp: 'Operations',
    };
    const upd = _db.prepare(
      `UPDATE agents SET department = ? WHERE id = ? AND (department IS NULL OR department = '')`
    );
    for (const [id, dept] of Object.entries(deptById)) {
      upd.run(dept, id);
    }
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS agent_workflow_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        owner_user_id TEXT NOT NULL,
        status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
        draft_graph_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
        published_graph_json TEXT,
        schedule_cron TEXT,
        chat_trigger_phrase TEXT,
        trigger_modes TEXT DEFAULT 'manual',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS agent_workflow_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        definition_id TEXT NOT NULL,
        action TEXT NOT NULL,
        summary TEXT DEFAULT '',
        changed_by TEXT,
        changed_by_name TEXT,
        diff_json TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (definition_id) REFERENCES agent_workflow_definitions(id)
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS agent_workflow_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_number INTEGER NOT NULL,
        definition_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        trigger TEXT DEFAULT 'manual',
        progress_pct INTEGER DEFAULT 0,
        context_json TEXT DEFAULT '{}',
        standup_id INTEGER,
        started_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        error_message TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (definition_id) REFERENCES agent_workflow_definitions(id)
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS agent_workflow_run_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL,
        node_id TEXT NOT NULL,
        node_type TEXT NOT NULL,
        node_label TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        input_json TEXT,
        output_json TEXT,
        delegation_task_id INTEGER,
        kanban_task_id INTEGER,
        started_at TEXT,
        completed_at TEXT,
        error_message TEXT,
        FOREIGN KEY (run_id) REFERENCES agent_workflow_runs(id)
      )
    `);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_wf_defs_owner ON agent_workflow_definitions(owner_user_id)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_wf_audit_def ON agent_workflow_audit(definition_id, created_at DESC)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_wf_runs_def ON agent_workflow_runs(definition_id, started_at DESC)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_wf_steps_run ON agent_workflow_run_steps(run_id)`);
  } catch (_) {}

  try {
    _db.exec(`ALTER TABLE agent_workflow_definitions ADD COLUMN paused INTEGER DEFAULT 0`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE agent_workflow_definitions ADD COLUMN webhook_secret TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE agent_workflow_definitions ADD COLUMN variables_json TEXT DEFAULT '{}'`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE agent_workflow_definitions ADD COLUMN input_schema_json TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE agent_workflow_runs ADD COLUMN graph_json TEXT`);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS ceo_media_artifacts (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'other',
        mime_type TEXT DEFAULT 'application/octet-stream',
        filename TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        size_bytes INTEGER DEFAULT 0,
        duration_ms INTEGER,
        meta_json TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ceo_media_owner ON ceo_media_artifacts(owner_user_id, created_at DESC);
    `);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS ceo_avatars (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT DEFAULT 'model/gltf-binary',
        storage_path TEXT NOT NULL,
        size_bytes INTEGER DEFAULT 0,
        source TEXT DEFAULT 'upload',
        animation_catalog_json TEXT DEFAULT '[]',
        agent_id TEXT,
        inbound_workflow_id TEXT,
        outbound_workflow_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ceo_avatars_owner ON ceo_avatars(owner_user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ceo_avatars_agent ON ceo_avatars(owner_user_id, agent_id);
    `);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS ceo_vr_scenes (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT DEFAULT 'model/gltf-binary',
        storage_path TEXT NOT NULL,
        size_bytes INTEGER DEFAULT 0,
        scene_json TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ceo_vr_scenes_owner ON ceo_vr_scenes(owner_user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS ceo_vr_rooms (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        scene_id TEXT,
        layout_json TEXT DEFAULT '{}',
        published INTEGER DEFAULT 0,
        public_slug TEXT,
        published_at TEXT,
        publish_title TEXT,
        public_token TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ceo_vr_rooms_owner ON ceo_vr_rooms(owner_user_id, updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ceo_vr_rooms_slug ON ceo_vr_rooms(public_slug) WHERE public_slug IS NOT NULL;

      CREATE TABLE IF NOT EXISTS ceo_vr_room_members (
        room_id TEXT NOT NULL,
        avatar_id TEXT NOT NULL,
        agent_id TEXT,
        handle TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        PRIMARY KEY (room_id, avatar_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ceo_vr_room_members_room ON ceo_vr_room_members(room_id, sort_order);

      CREATE TABLE IF NOT EXISTS ceo_agent_channels (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        config_json TEXT DEFAULT '{}',
        vault_refs_json TEXT DEFAULT '{}',
        last_test_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(owner_user_id, agent_id, channel)
      );
      CREATE INDEX IF NOT EXISTS idx_ceo_agent_channels_owner
        ON ceo_agent_channels(owner_user_id, agent_id, updated_at DESC);
    `);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS ibkr_position_meta (
        owner_user_id TEXT NOT NULL,
        symbol_key TEXT NOT NULL,
        opened_at TEXT,
        hold_until TEXT,
        last_review_at TEXT,
        last_review_json TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (owner_user_id, symbol_key)
      )
    `);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE agent_workflow_run_steps ADD COLUMN iteration INTEGER DEFAULT 1`);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_wf_steps_run_node_iter ON agent_workflow_run_steps(run_id, node_id, iteration)`);
  } catch (_) {}
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS agent_workflow_pending_listeners (
        run_id INTEGER NOT NULL,
        node_id TEXT NOT NULL,
        mcp_server_id TEXT,
        events_path TEXT DEFAULT '/events/stream',
        timeout_ms INTEGER DEFAULT 30000,
        started_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (run_id, node_id),
        FOREIGN KEY (run_id) REFERENCES agent_workflow_runs(id) ON DELETE CASCADE
      )
    `);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS agent_workflow_schedule_ticks (
        definition_id TEXT NOT NULL,
        tick_minute TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (definition_id, tick_minute)
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS agent_workflow_schedules (
        definition_id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        workflow_name TEXT DEFAULT '',
        schedule_cron TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (definition_id) REFERENCES agent_workflow_definitions(id) ON DELETE CASCADE
      )
    `);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_wf_schedules_enabled ON agent_workflow_schedules(enabled)`);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS agent_workflow_chat_turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_wf_chat_thread ON agent_workflow_chat_turns(owner_user_id, workflow_id, created_at)`
    );
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        transport TEXT NOT NULL DEFAULT 'streamable_http',
        url TEXT,
        command TEXT,
        args_json TEXT DEFAULT '[]',
        cwd TEXT,
        env_json TEXT DEFAULT '{}',
        headers_json TEXT DEFAULT '{}',
        auth_secret_env TEXT DEFAULT '',
        owner_user_id TEXT NOT NULL,
        owner_role TEXT NOT NULL CHECK (owner_role IN ('admin', 'ceo')),
        is_platform INTEGER DEFAULT 0,
        status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'healthy', 'disabled')),
        last_health_at TEXT,
        last_error TEXT,
        server_info_json TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_tools_cache (
        server_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        description TEXT DEFAULT '',
        input_schema_json TEXT,
        PRIMARY KEY (server_id, tool_name),
        FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_prompts_cache (
        server_id TEXT NOT NULL,
        prompt_name TEXT NOT NULL,
        description TEXT DEFAULT '',
        arguments_schema_json TEXT,
        PRIMARY KEY (server_id, prompt_name),
        FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_resources_cache (
        server_id TEXT NOT NULL,
        resource_uri TEXT NOT NULL,
        name TEXT DEFAULT '',
        description TEXT DEFAULT '',
        mime_type TEXT DEFAULT '',
        PRIMARY KEY (server_id, resource_uri),
        FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_call_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT,
        tool_name TEXT,
        user_id TEXT,
        request_json TEXT,
        response_json TEXT,
        status TEXT,
        latency_ms INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_servers_owner ON mcp_servers(owner_user_id)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_servers_platform ON mcp_servers(is_platform)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_call_logs_server ON mcp_call_logs(server_id, created_at DESC)`);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS agent_tool_grants (
        agent_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (agent_id, tool_name),
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      )
    `);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_tool_grants_agent ON agent_tool_grants(agent_id)`);
  } catch (_) {}

  // Tombstones for deliberately deleted agents. Startup catalog re-grants and
  // OpenClaw sync both recreate agents from leftover state, which resurrected
  // deleted agents; they consult this table before recreating an id.
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS deleted_agents (
        agent_id TEXT PRIMARY KEY,
        name TEXT DEFAULT '',
        openclaw_agent_id TEXT DEFAULT '',
        owner_user_id TEXT DEFAULT '',
        deleted_by TEXT DEFAULT '',
        deleted_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_deleted_agents_oc ON deleted_agents(openclaw_agent_id)`);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS external_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        card_url TEXT,
        endpoint_url TEXT,
        skill_id TEXT,
        auth_header TEXT,
        headers_json TEXT DEFAULT '{}',
        agent_card_json TEXT,
        owner_user_id TEXT NOT NULL,
        owner_role TEXT NOT NULL CHECK (owner_role IN ('admin', 'ceo')),
        is_platform INTEGER DEFAULT 0,
        status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'healthy', 'disabled')),
        last_health_at TEXT,
        last_error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_external_agents_owner ON external_agents(owner_user_id)`);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_a2a_publications (
        id TEXT PRIMARY KEY,
        workflow_definition_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        skill_id TEXT DEFAULT 'default',
        skill_name TEXT DEFAULT '',
        skill_description TEXT DEFAULT '',
        agent_card_json TEXT DEFAULT '{}',
        metadata_json TEXT DEFAULT '{}',
        auth_token TEXT,
        auth_mode TEXT DEFAULT 'public',
        client_id TEXT,
        client_secret_hash TEXT,
        status TEXT DEFAULT 'published' CHECK (status IN ('published', 'unpublished')),
        published_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (workflow_definition_id) REFERENCES agent_workflow_definitions(id) ON DELETE CASCADE
      )
    `);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_wf_a2a_pub_owner ON workflow_a2a_publications(owner_user_id)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_wf_a2a_pub_status ON workflow_a2a_publications(status)`);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_wf_a2a_pub_workflow ON workflow_a2a_publications(workflow_definition_id, status)`
    );
  } catch (_) {}

  try {
    _db.exec(`ALTER TABLE workflow_a2a_publications ADD COLUMN auth_mode TEXT DEFAULT 'public'`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE workflow_a2a_publications ADD COLUMN client_id TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE workflow_a2a_publications ADD COLUMN client_secret_hash TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE workflow_a2a_publications ADD COLUMN input_schema_json TEXT`);
  } catch (_) {}
  try {
    _db.exec(
      `UPDATE workflow_a2a_publications
       SET auth_mode = 'secured'
       WHERE (auth_mode IS NULL OR auth_mode = '' OR auth_mode = 'public')
         AND auth_token IS NOT NULL AND TRIM(auth_token) != ''`
    );
  } catch (_) {}
  try {
    _db.exec(
      `UPDATE workflow_a2a_publications SET auth_mode = 'public' WHERE auth_mode IS NULL OR auth_mode = ''`
    );
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_wf_a2a_pub_client ON workflow_a2a_publications(client_id)`);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_a2a_access_tokens (
        token_hash TEXT PRIMARY KEY,
        publish_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (publish_id) REFERENCES workflow_a2a_publications(id) ON DELETE CASCADE
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_wf_a2a_tokens_publish ON workflow_a2a_access_tokens(publish_id, expires_at)`
    );
  } catch (_) {}

  try {
    _db.exec(`ALTER TABLE workflow_a2a_publications ADD COLUMN invoke_mode TEXT DEFAULT 'sync'`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE workflow_a2a_publications ADD COLUMN callback_url TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE workflow_a2a_publications ADD COLUMN access_policy TEXT DEFAULT 'deny_all'`);
  } catch (_) {}
  try {
    _db.exec(
      `UPDATE workflow_a2a_publications
       SET access_policy = 'deny_all'
       WHERE access_policy IS NULL OR access_policy NOT IN ('deny_all', 'allow_all', 'whitelist')`
    );
  } catch (_) {}
  /**
   * Marketplace / org visibility for published A2A agents.
   * public (default): AgentExchange + public card/oauth/invoke subject to access_policy.
   * private: public endpoints always denied; only COO or the org leaf's reports-to lead may
   * invoke via the org/delegation path (or the owner via AgentExchange Test).
   */
  try {
    _db.exec(`ALTER TABLE workflow_a2a_publications ADD COLUMN visibility TEXT DEFAULT 'public'`);
  } catch (_) {}
  try {
    _db.exec(
      `UPDATE workflow_a2a_publications
       SET visibility = 'public'
       WHERE visibility IS NULL OR visibility NOT IN ('public', 'private')`
    );
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_a2a_ip_whitelist (
        id TEXT PRIMARY KEY,
        publish_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        cidr_or_ip TEXT NOT NULL,
        label TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (publish_id) REFERENCES workflow_a2a_publications(id) ON DELETE CASCADE
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_wf_a2a_ip_whitelist_publish
       ON workflow_a2a_ip_whitelist(publish_id, owner_user_id)`
    );
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_a2a_tasks (
        task_id TEXT PRIMARY KEY,
        publish_id TEXT NOT NULL,
        run_id INTEGER NOT NULL,
        owner_user_id TEXT NOT NULL,
        callback_url TEXT,
        state TEXT NOT NULL DEFAULT 'working',
        output_text TEXT DEFAULT '',
        run_metadata_json TEXT DEFAULT '{}',
        callback_status INTEGER,
        callback_error TEXT,
        callback_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (publish_id) REFERENCES workflow_a2a_publications(id) ON DELETE CASCADE
      )
    `);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_wf_a2a_tasks_run ON workflow_a2a_tasks(run_id)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_wf_a2a_tasks_publish ON workflow_a2a_tasks(publish_id, created_at DESC)`);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_a2a_invocation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        publish_id TEXT,
        owner_user_id TEXT,
        workflow_definition_id TEXT,
        agent_name TEXT,
        client_ip TEXT,
        endpoint TEXT NOT NULL,
        rpc_method TEXT,
        skill_id TEXT,
        outcome TEXT NOT NULL,
        reason_code TEXT,
        reason_message TEXT,
        auth_mode TEXT,
        access_policy TEXT,
        http_status INTEGER,
        jsonrpc_code INTEGER,
        jsonrpc_id TEXT,
        task_id TEXT,
        run_id INTEGER,
        request_json TEXT,
        response_json TEXT,
        latency_ms INTEGER,
        source TEXT DEFAULT 'public',
        bypass_access INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_wf_a2a_inv_created ON workflow_a2a_invocation_logs(created_at DESC)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_wf_a2a_inv_publish ON workflow_a2a_invocation_logs(publish_id, created_at DESC)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_wf_a2a_inv_outcome ON workflow_a2a_invocation_logs(outcome, created_at DESC)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_wf_a2a_inv_owner ON workflow_a2a_invocation_logs(owner_user_id, created_at DESC)`
    );
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS custom_scripts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        language TEXT NOT NULL DEFAULT 'python' CHECK (language IN ('python', 'javascript')),
        runtime_profile TEXT NOT NULL DEFAULT 'restricted' CHECK (runtime_profile IN ('restricted', 'network')),
        source TEXT NOT NULL,
        scan_result_json TEXT,
        scan_status TEXT DEFAULT 'pending' CHECK (scan_status IN ('pending', 'approved', 'rejected')),
        risk_level TEXT DEFAULT 'low',
        owner_user_id TEXT NOT NULL,
        owner_role TEXT NOT NULL CHECK (owner_role IN ('admin', 'ceo')),
        is_platform INTEGER DEFAULT 0,
        status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'disabled')),
        last_run_at TEXT,
        last_error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_custom_scripts_owner ON custom_scripts(owner_user_id)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_custom_scripts_status ON custom_scripts(status, scan_status)`);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS platform_user_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT DEFAULT '',
        link_url TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES platform_users(id)
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_platform_user_notifications_user ON platform_user_notifications(user_id, created_at DESC)`
    );
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE platform_user_notifications ADD COLUMN read_at TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE platform_user_notifications ADD COLUMN source TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE platform_user_notifications ADD COLUMN source_key TEXT`);
  } catch (_) {}
  try {
    _db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_notif_source
       ON platform_user_notifications(user_id, source, source_key)
       WHERE source IS NOT NULL AND source_key IS NOT NULL`
    );
  } catch (_) {}
  try {
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_platform_notif_unread
       ON platform_user_notifications(user_id, created_at DESC)
       WHERE read_at IS NULL`
    );
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS user_feed_dismissals (
        user_id TEXT NOT NULL,
        feed_kind TEXT NOT NULL,
        feed_id TEXT NOT NULL,
        dismissed_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, feed_kind, feed_id)
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_user_feed_dismissals_user ON user_feed_dismissals(user_id, feed_kind)`
    );
  } catch (_) {}

  try {
    _db.exec(`ALTER TABLE platform_sessions ADD COLUMN impersonator_user_id TEXT`);
  } catch (_) {}

  try {
    _db.exec(`ALTER TABLE chat_turns ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT 'default'`);
  } catch (_) {}
  try {
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_chat_turns_agent_owner ON chat_turns(agent_id, owner_user_id)`
    );
  } catch (_) {}
  try {
    const legacyOwner = (process.env.AGENT_OS_BALA_CEO_ID || 'ceo-bala').trim() || 'ceo-bala';
    _db.prepare(`UPDATE chat_turns SET owner_user_id = ? WHERE owner_user_id = 'default'`).run(legacyOwner);
  } catch (_) {}

  try {
    _db.exec(`ALTER TABLE content_tool_logs ADD COLUMN owner_user_id TEXT`);
  } catch (_) {}
  try {
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_content_tool_logs_owner ON content_tool_logs(owner_user_id, created_at DESC)`
    );
  } catch (_) {}
  try {
    const legacyOwner = (process.env.AGENT_OS_BALA_CEO_ID || 'ceo-bala').trim() || 'ceo-bala';
    _db.prepare(`UPDATE content_tool_logs SET owner_user_id = ? WHERE owner_user_id IS NULL`).run(legacyOwner);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS ibkr_budget_days (
        owner_user_id TEXT NOT NULL,
        day TEXT NOT NULL,
        budget_usd REAL NOT NULL,
        reserved_usd REAL NOT NULL DEFAULT 0,
        consumed_usd REAL NOT NULL DEFAULT 0,
        trades_placed INTEGER NOT NULL DEFAULT 0,
        residual_json TEXT DEFAULT '[]',
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (owner_user_id, day)
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS ibkr_trade_reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id TEXT NOT NULL,
        day TEXT NOT NULL,
        run_id INTEGER,
        symbol_key TEXT NOT NULL,
        side TEXT NOT NULL,
        qty REAL NOT NULL,
        notional_usd REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'reserved',
        detail_json TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_ibkr_reservations_owner_day ON ibkr_trade_reservations(owner_user_id, day, status)`
    );
    _db.exec(`
      CREATE TABLE IF NOT EXISTS ibkr_order_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id TEXT NOT NULL,
        reservation_id INTEGER,
        run_id INTEGER,
        symbol_key TEXT,
        symbol TEXT,
        side TEXT,
        ib_order_id INTEGER,
        status TEXT NOT NULL,
        reason_code TEXT,
        reason_text TEXT,
        source TEXT,
        error_code INTEGER,
        qty REAL,
        detail_json TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_ibkr_order_events_owner_created ON ibkr_order_events(owner_user_id, created_at DESC)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_ibkr_order_events_symbol ON ibkr_order_events(owner_user_id, symbol_key, created_at DESC)`
    );
  } catch (_) {}

  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN llm_provider TEXT DEFAULT 'platform_decided'`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN llm_api_key TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN llm_model TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN last_login_at TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN industry TEXT DEFAULT ''`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN industry_other TEXT DEFAULT ''`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN business_name TEXT DEFAULT ''`);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS platform_industries (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1
      )
    `);
    const industrySeed = [
      ['personal', 'Personal', 10],
      ['technology', 'Technology', 20],
      ['finance', 'Finance', 30],
      ['healthcare', 'Healthcare', 40],
      ['education', 'Education', 50],
      ['retail', 'Retail', 60],
      ['manufacturing', 'Manufacturing', 70],
      ['consulting', 'Consulting', 80],
      ['real_estate', 'Real Estate', 90],
      ['media', 'Media & Entertainment', 100],
      ['nonprofit', 'Non-profit', 110],
      ['government', 'Government', 120],
      ['others', 'Others', 999],
    ];
    const insInd = _db.prepare(
      `INSERT OR IGNORE INTO platform_industries (id, label, sort_order, enabled) VALUES (?, ?, ?, 1)`
    );
    for (const [id, label, sort] of industrySeed) insInd.run(id, label, sort);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS openconnector_user_links (
        user_id TEXT PRIMARY KEY,
        runtime_token TEXT,
        connection_name TEXT DEFAULT '',
        oc_user_id TEXT DEFAULT '',
        linked_at TEXT,
        last_provisioned_at TEXT,
        last_error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES platform_users(id) ON DELETE CASCADE
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_openconnector_links_connection ON openconnector_user_links(connection_name)`
    );
  } catch (_) {}

  /**
   * Per-CEO OpenConnector OAuth app credentials (BYOA).
   * When set, startConnectorOAuth passes clientId/clientSecret on OC
   * POST /api/oauth/authorizations (connection-scoped; OC keeps them for refresh).
   * client_secret encrypted with USER_API_KEYS_KEK (enc:g1: prefix) when available.
   */
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS openconnector_oauth_client_overrides (
        app_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        client_id TEXT NOT NULL DEFAULT '',
        client_secret TEXT NOT NULL DEFAULT '',
        scopes TEXT DEFAULT '',
        extra_json TEXT DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (app_id, owner_user_id),
        FOREIGN KEY (owner_user_id) REFERENCES platform_users(id) ON DELETE CASCADE
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_oc_oauth_overrides_owner
       ON openconnector_oauth_client_overrides(owner_user_id, app_id)`
    );
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS agent_response_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'chat',
        message_id TEXT,
        message_role TEXT DEFAULT 'assistant',
        message_content TEXT,
        rating TEXT NOT NULL CHECK (rating IN ('up', 'down')),
        comment TEXT DEFAULT '',
        context_json TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_feedback_owner_agent
       ON agent_response_feedback(owner_user_id, agent_id, created_at DESC)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_feedback_owner_created
       ON agent_response_feedback(owner_user_id, created_at DESC)`
    );
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_file_pollers (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        definition_id TEXT NOT NULL,
        watch_dir TEXT NOT NULL,
        glob_pattern TEXT DEFAULT '*',
        interval_ms INTEGER DEFAULT 5000,
        move_to_dir TEXT,
        enabled INTEGER DEFAULT 1,
        last_tick_at TEXT,
        last_error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (definition_id) REFERENCES agent_workflow_definitions(id) ON DELETE CASCADE
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_wf_file_pollers_owner ON workflow_file_pollers(owner_user_id)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_wf_file_pollers_enabled ON workflow_file_pollers(enabled)`
    );
    _db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_file_poller_seen (
        poller_id TEXT NOT NULL,
        file_key TEXT NOT NULL,
        file_path TEXT,
        seen_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (poller_id, file_key),
        FOREIGN KEY (poller_id) REFERENCES workflow_file_pollers(id) ON DELETE CASCADE
      )
    `);
  } catch (_) {}

  try {
    _db.exec(`ALTER TABLE standups ADD COLUMN owner_user_id TEXT`);
  } catch (_) {}
  try {
    const legacyOwner = (process.env.AGENT_OS_BALA_CEO_ID || 'ceo-bala').trim();
    _db.prepare(
      `UPDATE standups SET owner_user_id = ? WHERE owner_user_id IS NULL OR owner_user_id = ''`
    ).run(legacyOwner);
  } catch (_) {}
  try {
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_standups_owner ON standups(owner_user_id, scheduled_at DESC)`
    );
  } catch (_) {}

  // Per-CEO delegation task ownership
  try {
    _db.exec(`ALTER TABLE agent_delegation_tasks ADD COLUMN owner_user_id TEXT`);
  } catch (_) {}
  try {
    // Backfill from standup owner for existing rows
    _db.exec(
      `UPDATE agent_delegation_tasks
       SET owner_user_id = (
         SELECT s.owner_user_id FROM standups s WHERE s.id = agent_delegation_tasks.standup_id
       )
       WHERE owner_user_id IS NULL OR owner_user_id = ''`
    );
  } catch (_) {}
  try {
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_delegation_tasks_owner ON agent_delegation_tasks(owner_user_id, status, created_at)`
    );
  } catch (_) {}

  // Per-CEO Kanban ownership (required for multi-tenant isolation)
  try {
    _db.exec(`ALTER TABLE kanban_tasks ADD COLUMN owner_user_id TEXT`);
  } catch (_) {}
  try {
    _db.exec(
      `UPDATE kanban_tasks
       SET owner_user_id = (
         SELECT d.owner_user_id FROM agent_delegation_tasks d
         WHERE d.id = kanban_tasks.agent_delegation_task_id
       )
       WHERE (owner_user_id IS NULL OR owner_user_id = '')
         AND agent_delegation_task_id IS NOT NULL`
    );
  } catch (_) {}
  try {
    _db.exec(
      `UPDATE kanban_tasks
       SET owner_user_id = (
         SELECT s.owner_user_id FROM standups s WHERE s.id = kanban_tasks.standup_id
       )
       WHERE (owner_user_id IS NULL OR owner_user_id = '')
         AND standup_id IS NOT NULL`
    );
  } catch (_) {}
  try {
    const orphanRows = _db
      .prepare(
        `SELECT id, description FROM kanban_tasks
         WHERE owner_user_id IS NULL OR owner_user_id = ''`
      )
      .all();
    const upd = _db.prepare(`UPDATE kanban_tasks SET owner_user_id = ? WHERE id = ?`);
    for (const row of orphanRows) {
      const text = String(row.description || '');
      const ownerMatch = text.match(/owner_user_id:\s*(\S+)/i);
      const ceoMatch = text.match(/ceo_user_id:\s*(\S+)/i);
      const owner = (ownerMatch?.[1] || ceoMatch?.[1] || '').trim();
      if (owner) upd.run(owner, row.id);
    }
  } catch (_) {}
  try {
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_kanban_tasks_owner ON kanban_tasks(owner_user_id, created_at DESC)`
    );
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS ceo_guardrails (
        ceo_user_id TEXT PRIMARY KEY,
        policy_text TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (ceo_user_id) REFERENCES platform_users(id) ON DELETE CASCADE
      )
    `);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS ceo_browser_session (
        ceo_user_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL DEFAULT 'managed',
        profile TEXT NOT NULL DEFAULT 'openclaw',
        session_ready INTEGER DEFAULT 0,
        relay_notes TEXT DEFAULT '',
        pair_hint TEXT DEFAULT '',
        logged_in_domains_json TEXT DEFAULT '{}',
        url_allowlist_json TEXT DEFAULT '[]',
        url_denylist_json TEXT DEFAULT '[]',
        last_attached_at TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (ceo_user_id) REFERENCES platform_users(id) ON DELETE CASCADE
      )
    `);
  } catch (_) {}
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS browser_tasks (
        id TEXT PRIMARY KEY,
        ceo_user_id TEXT NOT NULL,
        agent_id TEXT,
        recipe_id TEXT,
        mode TEXT NOT NULL DEFAULT 'autonomous',
        status TEXT DEFAULT 'pending',
        goal_text TEXT DEFAULT '',
        start_url TEXT DEFAULT '',
        input_json TEXT DEFAULT '{}',
        result_json TEXT,
        steps_json TEXT DEFAULT '[]',
        wait_reason TEXT,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (ceo_user_id) REFERENCES platform_users(id) ON DELETE CASCADE
      )
    `);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_browser_tasks_ceo ON browser_tasks(ceo_user_id, created_at DESC)`);
    const browserTaskColumns = [
      ['selected_node_id', 'TEXT'],
      ['selected_driver_mode', 'TEXT'],
      ['protocol_version', 'INTEGER NOT NULL DEFAULT 1'],
      ['trace_id', 'TEXT'],
      ['parent_goal_run_id', 'TEXT'],
      ['parent_goal_step_id', 'TEXT'],
      ['restartable', 'INTEGER NOT NULL DEFAULT 1'],
    ];
    for (const [column, type] of browserTaskColumns) {
      try { _db.exec(`ALTER TABLE browser_tasks ADD COLUMN ${column} ${type}`); } catch (_) {}
    }
  } catch (_) {}
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS browser_recipes (
        id TEXT PRIMARY KEY,
        ceo_user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        status TEXT DEFAULT 'draft',
        start_url TEXT,
        domain_allowlist_json TEXT DEFAULT '[]',
        version INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (ceo_user_id) REFERENCES platform_users(id) ON DELETE CASCADE
      )
    `);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_browser_recipes_ceo ON browser_recipes(ceo_user_id)`);
  } catch (_) {}
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS browser_recipe_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id TEXT NOT NULL,
        step_order INTEGER NOT NULL,
        action TEXT NOT NULL,
        args_json TEXT DEFAULT '{}',
        label TEXT DEFAULT '',
        on_error TEXT DEFAULT 'stop',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (recipe_id) REFERENCES browser_recipes(id) ON DELETE CASCADE
      )
    `);
  } catch (_) {}
  try {
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_browser_recipe_steps_recipe ON browser_recipe_steps(recipe_id, step_order)`
    );
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS agent_workflow_certify_jobs (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        workflow_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        goal_json TEXT NOT NULL DEFAULT '{}',
        report_json TEXT,
        attempt INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 5,
        last_error TEXT,
        created_by TEXT,
        created_by_name TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_wf_certify_owner ON agent_workflow_certify_jobs(owner_user_id, updated_at DESC)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_wf_certify_wf ON agent_workflow_certify_jobs(workflow_id, updated_at DESC)`
    );
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE agent_workflow_definitions ADD COLUMN certify_state TEXT`);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT,
        summary TEXT,
        oc_thread_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_chat_sessions_owner_agent ON chat_sessions(owner_user_id, agent_id, status, archived_at DESC)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_chat_sessions_active ON chat_sessions(agent_id, owner_user_id, status)`
    );
    try {
      _db.exec(`ALTER TABLE chat_turns ADD COLUMN session_id TEXT`);
    } catch (_) {}
    try {
      _db.exec(`ALTER TABLE chat_turns ADD COLUMN work_unit_id TEXT`);
    } catch (_) {}
    try {
      _db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_turns_session ON chat_turns(session_id, created_at)`);
    } catch (_) {}
  } catch (_) {}

  // Semantic work-unit routing and correlated delegated outcomes.
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS chat_work_units (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        execution_mode TEXT NOT NULL,
        resolved_request TEXT NOT NULL,
        parent_work_unit_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        execution_ref TEXT,
        request_fingerprint TEXT,
        route_json TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_chat_work_units_session
        ON chat_work_units(owner_user_id, agent_id, session_id, created_at DESC);
    `);
    try { _db.exec(`ALTER TABLE agent_delegation_tasks ADD COLUMN parent_work_unit_id TEXT`); } catch (_) {}
    try { _db.exec(`ALTER TABLE agent_delegation_tasks ADD COLUMN parent_agent_id TEXT`); } catch (_) {}
    try { _db.exec(`ALTER TABLE agent_delegation_tasks ADD COLUMN callback_delivered_at TEXT`); } catch (_) {}
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS user_api_keys (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        key_name TEXT NOT NULL,
        secret_value TEXT NOT NULL,
        is_encrypted INTEGER NOT NULL DEFAULT 0,
        phrase_wrapped TEXT,
        salt_b64 TEXT,
        iv_b64 TEXT,
        tag_b64 TEXT,
        key_hint TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(owner_user_id, key_name)
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_user_api_keys_owner ON user_api_keys(owner_user_id, key_name)`
    );
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE external_agents ADD COLUMN auth_header_ref TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE openconnector_user_links ADD COLUMN runtime_token_ref TEXT`);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS platform_agent_workspace_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
        is_default INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('platform', 'admin', 'ceo')),
        files_json TEXT NOT NULL DEFAULT '{}',
        created_by TEXT,
        created_by_name TEXT,
        published_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_plat_ws_tpl_status ON platform_agent_workspace_templates(status, updated_at DESC)`
    );
  } catch (_) {}

  /** Desktop workflow packages: bearer tokens (hashed) + optional client IP allowlist. */
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_desktop_tokens (
        id TEXT PRIMARY KEY,
        definition_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        name TEXT DEFAULT '',
        token_hash TEXT NOT NULL UNIQUE,
        token_prefix TEXT NOT NULL,
        expires_at TEXT,
        revoked_at TEXT,
        last_used_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (definition_id) REFERENCES agent_workflow_definitions(id) ON DELETE CASCADE
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_wf_desktop_tokens_def ON workflow_desktop_tokens(definition_id, owner_user_id)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_wf_desktop_tokens_hash ON workflow_desktop_tokens(token_hash)`
    );
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_desktop_ip_whitelist (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        definition_id TEXT,
        cidr_or_ip TEXT NOT NULL,
        label TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_wf_desktop_ip_owner ON workflow_desktop_ip_whitelist(owner_user_id, definition_id)`
    );
  } catch (_) {}

  /** Local browser worker (Connectors download): owner-scoped token, IP allowlist, online node, jobs. */
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS browser_worker_tokens (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        name TEXT DEFAULT '',
        token_hash TEXT NOT NULL UNIQUE,
        token_prefix TEXT NOT NULL,
        expires_at TEXT,
        revoked_at TEXT,
        last_used_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (owner_user_id) REFERENCES platform_users(id) ON DELETE CASCADE
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_browser_worker_tokens_owner ON browser_worker_tokens(owner_user_id, created_at DESC)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_browser_worker_tokens_hash ON browser_worker_tokens(token_hash)`
    );
  } catch (_) {}

  /** Local IBKR bridge packages: LOCAL_BRIDGE_TOKEN inventory (hash only; laptop loopback auth). */
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS ibkr_bridge_tokens (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        name TEXT DEFAULT '',
        token_hash TEXT NOT NULL UNIQUE,
        token_prefix TEXT NOT NULL,
        expires_at TEXT,
        revoked_at TEXT,
        last_used_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_ibkr_bridge_tokens_owner ON ibkr_bridge_tokens(owner_user_id, created_at DESC)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_ibkr_bridge_tokens_hash ON ibkr_bridge_tokens(token_hash)`
    );
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS browser_worker_ip_whitelist (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        cidr_or_ip TEXT NOT NULL,
        label TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (owner_user_id) REFERENCES platform_users(id) ON DELETE CASCADE
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_browser_worker_ip_owner ON browser_worker_ip_whitelist(owner_user_id)`
    );
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS browser_worker_nodes (
        owner_user_id TEXT PRIMARY KEY,
        token_id TEXT,
        online INTEGER NOT NULL DEFAULT 0,
        last_heartbeat_at TEXT,
        worker_version TEXT DEFAULT '',
        driver_mode TEXT DEFAULT 'playwright',
        capabilities_json TEXT DEFAULT '{}',
        last_client_ip TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (owner_user_id) REFERENCES platform_users(id) ON DELETE CASCADE
      )
    `);
  } catch (_) {}

  /** Multiple browser executors may be online for one CEO. */
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS browser_executor_nodes (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        token_id TEXT,
        device_name TEXT DEFAULT '',
        online INTEGER NOT NULL DEFAULT 0,
        last_heartbeat_at TEXT,
        worker_version TEXT DEFAULT '',
        browser_version TEXT DEFAULT '',
        driver_mode TEXT DEFAULT 'playwright',
        protocol_version INTEGER NOT NULL DEFAULT 1,
        capabilities_json TEXT DEFAULT '{}',
        last_client_ip TEXT,
        active_task_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (owner_user_id) REFERENCES platform_users(id) ON DELETE CASCADE
      )
    `);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_browser_executor_owner_online ON browser_executor_nodes(owner_user_id, online, last_heartbeat_at DESC)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_browser_executor_owner_driver ON browser_executor_nodes(owner_user_id, driver_mode)`);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_browser_executor_token ON browser_executor_nodes(token_id)`);
  } catch (_) {}

  /** Short-lived, single-use extension pairing codes. Only hashes are persisted. */
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS browser_extension_pairing_codes (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        code_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (owner_user_id) REFERENCES platform_users(id) ON DELETE CASCADE
      )
    `);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_browser_pairing_owner ON browser_extension_pairing_codes(owner_user_id, created_at DESC)`);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS browser_worker_jobs (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        args_json TEXT DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'queued',
        result_json TEXT,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        claimed_at TEXT,
        completed_at TEXT,
        FOREIGN KEY (owner_user_id) REFERENCES platform_users(id) ON DELETE CASCADE
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_browser_worker_jobs_owner_status ON browser_worker_jobs(owner_user_id, status, created_at)`
    );
    const browserJobColumns = [
      ['selected_node_id', 'TEXT'],
      ['selected_driver_mode', 'TEXT'],
      ['protocol_version', 'INTEGER NOT NULL DEFAULT 1'],
      ['capability_requirements_json', "TEXT DEFAULT '{}'"],
      ['idempotency_key', 'TEXT'],
      ['attempt_number', 'INTEGER NOT NULL DEFAULT 1'],
      ['dispatch_deadline', 'TEXT'],
      ['result_state', 'TEXT'],
      ['failure_code', 'TEXT'],
    ];
    for (const [column, type] of browserJobColumns) {
      try {
        _db.exec(`ALTER TABLE browser_worker_jobs ADD COLUMN ${column} ${type}`);
      } catch (_) {}
    }
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_browser_jobs_node_status ON browser_worker_jobs(owner_user_id, selected_node_id, status, created_at)`);
    _db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_browser_jobs_owner_idempotency ON browser_worker_jobs(owner_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`);
  } catch (_) {}

  /** Monthly token + error-rate budgets per org member (internal agent or org leaf member). */
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS agent_ops_budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id TEXT NOT NULL,
        member_key TEXT NOT NULL,
        period TEXT NOT NULL,
        monthly_token_budget INTEGER,
        error_budget_pct REAL,
        warn_token_pct REAL DEFAULT 80,
        warn_error_pct REAL DEFAULT 80,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(owner_user_id, member_key, period)
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_ops_budgets_owner ON agent_ops_budgets(owner_user_id, period)`
    );
  } catch (_) {}

  /** Durable token usage ledger (actual provider usage when available, else estimated). */
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id TEXT NOT NULL,
        member_key TEXT NOT NULL,
        agent_id TEXT,
        source TEXT NOT NULL DEFAULT 'unknown',
        model_id TEXT,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        tokens_estimated INTEGER DEFAULT 0,
        session_id TEXT,
        run_id TEXT,
        trace_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_token_usage_owner_created ON token_usage(owner_user_id, created_at DESC)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_token_usage_member ON token_usage(owner_user_id, member_key, created_at DESC)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_token_usage_trace ON token_usage(owner_user_id, trace_id, created_at DESC)`
    );
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE token_usage ADD COLUMN trace_id TEXT`);
  } catch (_) {}
  try {
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_token_usage_trace ON token_usage(owner_user_id, trace_id, created_at DESC)`
    );
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE content_tool_logs ADD COLUMN trace_id TEXT`);
  } catch (_) {}
  try {
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_content_tool_logs_trace ON content_tool_logs(owner_user_id, trace_id)`
    );
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE agent_workflow_runs ADD COLUMN trace_id TEXT`);
  } catch (_) {}
  try {
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_wf_runs_trace ON agent_workflow_runs(owner_user_id, trace_id)`
    );
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE goal_mission_events ADD COLUMN trace_id TEXT`);
  } catch (_) {}

  /** CEO price book (owner_user_id empty = platform estimate catalog). */
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS llm_price_book (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL,
        input_usd_per_1m REAL NOT NULL DEFAULT 1,
        output_usd_per_1m REAL NOT NULL DEFAULT 3,
        currency TEXT NOT NULL DEFAULT 'USD',
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(owner_user_id, model_id)
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_llm_price_book_owner ON llm_price_book(owner_user_id)`
    );
  } catch (_) {}

  /** Cost lines: live LLM estimates plus CEO-entered outside costs. Owner-scoped. */
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS cost_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id TEXT NOT NULL,
        period TEXT NOT NULL,
        category TEXT NOT NULL,
        source TEXT DEFAULT '',
        model_id TEXT DEFAULT '',
        member_key TEXT DEFAULT '',
        units_input INTEGER DEFAULT 0,
        units_output INTEGER DEFAULT 0,
        amount_usd REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        confidence TEXT NOT NULL DEFAULT 'estimated',
        payer TEXT DEFAULT '',
        note TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_cost_lines_owner_period ON cost_lines(owner_user_id, period DESC)`
    );
  } catch (_) {}

  /** External / published-A2A agents that sit in the org chart as leaf reports. */
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS org_agent_members (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('external', 'a2a_publish')),
        ref_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        purpose TEXT DEFAULT '',
        department TEXT DEFAULT '',
        parent_id TEXT,
        monthly_token_budget INTEGER,
        error_budget_pct REAL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(owner_user_id, kind, ref_id)
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_org_agent_members_owner ON org_agent_members(owner_user_id, enabled)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_org_agent_members_parent ON org_agent_members(owner_user_id, parent_id)`
    );
  } catch (_) {}

  /** Terminal outcomes for org leaf members (external / A2A) — feeds error-budget math. */
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS org_member_invocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id TEXT NOT NULL,
        member_key TEXT NOT NULL,
        source TEXT DEFAULT 'delegation',
        status TEXT NOT NULL,
        error_message TEXT,
        latency_ms INTEGER,
        task_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_org_member_inv_member ON org_member_invocations(owner_user_id, member_key, created_at DESC)`
    );
  } catch (_) {}

  /**
   * Kanban cards for work delegated to org leaf members. `assigned_agent_id` has a foreign key to
   * `agents`, which leaf members are deliberately not in, so their `ext:`/`a2a:` key lives here.
   */
  try {
    _db.exec(`ALTER TABLE kanban_tasks ADD COLUMN assigned_member_key TEXT`);
  } catch (_) {}
  try {
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_kanban_tasks_member_key ON kanban_tasks(assigned_member_key)`
    );
  } catch (_) {}

  try {
    _db.exec(`ALTER TABLE kanban_tasks ADD COLUMN a2a_task_id TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE kanban_tasks ADD COLUMN workflow_run_id INTEGER`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE kanban_tasks ADD COLUMN goal_run_id TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE kanban_tasks ADD COLUMN goal_step_id TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE kanban_tasks ADD COLUMN trace_id TEXT`);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_kanban_tasks_a2a ON kanban_tasks(a2a_task_id)`);
  } catch (_) {}

  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN data_retention_days INTEGER DEFAULT 90`);
  } catch (_) {}

  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN role_title TEXT DEFAULT ''`);
  } catch (_) {}

  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN display_timezone TEXT DEFAULT ''`);
  } catch (_) {}

  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN ui_nav_hidden TEXT DEFAULT '[]'`);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS company_workspace_boards (
        owner_user_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        layout_json TEXT NOT NULL DEFAULT '{}',
        widgets_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (owner_user_id, slug)
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_boards_owner
        ON company_workspace_boards(owner_user_id);
    `);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS docker_onboarded_tools (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        purpose TEXT DEFAULT '',
        image TEXT NOT NULL,
        image_canonical TEXT,
        container_name TEXT,
        container_id TEXT,
        container_port INTEGER NOT NULL DEFAULT 8080,
        invoke_path TEXT NOT NULL DEFAULT '/',
        method TEXT NOT NULL DEFAULT 'POST',
        request_schema_json TEXT,
        response_schema_json TEXT,
        network_name TEXT,
        endpoint TEXT,
        auth_header TEXT,
        status TEXT NOT NULL DEFAULT 'declared',
        last_error TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_docker_tools_status ON docker_onboarded_tools(status)`);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS admin_stepup_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  } catch (_) {}

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS ceo_org_strategy (
        owner_user_id TEXT PRIMARY KEY,
        purpose TEXT,
        vision TEXT,
        goals_short_term TEXT,
        goals_long_term TEXT,
        strategic_profile_json TEXT,
        draft_journey_json TEXT,
        status TEXT DEFAULT 'draft',
        applied_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  } catch (_) {}

  
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS company_industry_blueprints (
        id TEXT PRIMARY KEY,
        industry_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        depth TEXT DEFAULT 'thin',
        is_default INTEGER DEFAULT 0,
        source TEXT DEFAULT 'published',
        payload_json TEXT NOT NULL,
        source_owner_user_id TEXT,
        source_company_name TEXT,
        published_by TEXT,
        published INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_cib_industry ON company_industry_blueprints(industry_id)`);
  } catch (_) {}

  // Per-CEO tool → chat/vision/image/video model overrides (Tools menu mapping; owner-scoped)
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS tool_model_overrides (
        owner_user_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        llm_model TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (owner_user_id, tool_name)
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_tool_model_overrides_owner ON tool_model_overrides(owner_user_id)`
    );
  } catch (_) {}

  // Per-CEO tool API call budgets (Tools → Rate limits). Independent of agent token budgets.
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS tool_api_rate_limits (
        owner_user_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        max_calls_per_day INTEGER,
        max_calls_per_month INTEGER,
        calls_today INTEGER NOT NULL DEFAULT 0,
        calls_this_month INTEGER NOT NULL DEFAULT 0,
        period_day TEXT,
        period_month TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (owner_user_id, tool_name)
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_tool_api_rate_limits_owner ON tool_api_rate_limits(owner_user_id)`
    );
    _db.exec(`
      CREATE TABLE IF NOT EXISTS tool_api_rate_limit_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        reset_kind TEXT NOT NULL,
        period TEXT NOT NULL,
        budget_max_day INTEGER,
        budget_max_month INTEGER,
        actuals_day INTEGER,
        actuals_month INTEGER,
        period_day TEXT,
        period_month TEXT,
        reset_by TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_tool_api_rate_limit_resets_owner
       ON tool_api_rate_limit_resets(owner_user_id, tool_name, created_at)`
    );
  } catch (_) {}

  /** User profile photo (data URL or relative media path). */
  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN profile_image TEXT DEFAULT ''`);
  } catch (_) {}

  /** Profile Efficiency mode: 1 = wave-1 utility LLM jobs use local Ollama. */
  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN llm_efficiency_mode INTEGER DEFAULT 0`);
  } catch (_) {}

  /**
   * Legal acceptance at registration (Terms + Privacy).
   * Null for legacy / admin-created users until they re-accept (future gate).
   */
  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN terms_accepted_at TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN terms_version TEXT`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN privacy_version TEXT`);
  } catch (_) {}

  /** ISO 3166-1 alpha-2 (SG). region holds ISO 3166-2 (US-CA) or empty. */
  try {
    _db.exec(`ALTER TABLE platform_users ADD COLUMN country TEXT DEFAULT ''`);
  } catch (_) {}

  /** Agent icon / profile pic (data URL; default UI uses robot icon when empty). */
  try {
    _db.exec(`ALTER TABLE agents ADD COLUMN avatar_image TEXT DEFAULT ''`);
  } catch (_) {}

  /** How this AI employee was created: hired | imported_agent (from Agent Exchange). */
  try {
    _db.exec(`ALTER TABLE agents ADD COLUMN source_kind TEXT DEFAULT 'hired'`);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE agents ADD COLUMN source_publish_id TEXT DEFAULT ''`);
  } catch (_) {}
  try {
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agents_source_publish ON agents(owner_user_id, source_publish_id)`
    );
  } catch (_) {}

  /** USD hourly value rate for Digest Est. Value (hire default 10). */
  try {
    _db.exec(`ALTER TABLE agents ADD COLUMN hourly_rate_usd REAL DEFAULT 10`);
  } catch (_) {}
  /** Role pack folder under openclaw-workspace-templates/ (slow-caller, realtime-caller, …). */
  try {
    _db.exec(`ALTER TABLE agents ADD COLUMN template_base_id TEXT DEFAULT ''`);
  } catch (_) {}
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS ceo_voice_sessions (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        channel_id TEXT,
        public_slug TEXT,
        token_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        transcript_json TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        ended_at TEXT,
        expires_at TEXT,
        is_guest INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_ceo_voice_sessions_owner
        ON ceo_voice_sessions(owner_user_id, agent_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ceo_voice_sessions_token ON ceo_voice_sessions(token_hash);
    `);
  } catch (_) {}
  try {
    _db.exec(`ALTER TABLE ceo_voice_sessions ADD COLUMN is_guest INTEGER DEFAULT 0`);
  } catch (_) {}
  try {
    _db.exec(`UPDATE agents SET hourly_rate_usd = 10 WHERE hourly_rate_usd IS NULL`);
  } catch (_) {}

  /**
   * CEO scheduled goals/prompts — durable cadence owned by an AI employee.
   * Pause/delete are DB-only (status); platform master tick never fires non-active rows after restart.
   */
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_goals (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        cadence TEXT NOT NULL DEFAULT 'daily',
        weekday INTEGER,
        time_local TEXT NOT NULL DEFAULT '09:00',
        timezone TEXT DEFAULT '',
        ends_at TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        last_run_at TEXT,
        last_run_status TEXT,
        last_run_error TEXT,
        last_run_key TEXT,
        run_count INTEGER DEFAULT 0,
        source TEXT DEFAULT 'ceo',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_scheduled_goals_owner ON scheduled_goals(owner_user_id, status)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_scheduled_goals_active ON scheduled_goals(status, time_local)`
    );
  } catch (_) {}
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_goal_runs (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        run_key TEXT NOT NULL,
        status TEXT NOT NULL,
        agent_id TEXT,
        reply_preview TEXT,
        error TEXT,
        triggered_by TEXT DEFAULT 'schedule',
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(goal_id, run_key)
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_scheduled_goal_runs_goal ON scheduled_goal_runs(goal_id, created_at DESC)`
    );
  } catch (_) {}

  try {
    const sgCols = _db.prepare('PRAGMA table_info(scheduled_goals)').all().map((c) => c.name);
    if (!sgCols.includes('plan_json')) _db.exec('ALTER TABLE scheduled_goals ADD COLUMN plan_json TEXT');
    if (!sgCols.includes('plan_status')) _db.exec("ALTER TABLE scheduled_goals ADD COLUMN plan_status TEXT DEFAULT 'none'");
    if (!sgCols.includes('plan_feedback_json')) _db.exec('ALTER TABLE scheduled_goals ADD COLUMN plan_feedback_json TEXT');
    if (!sgCols.includes('plan_version')) _db.exec('ALTER TABLE scheduled_goals ADD COLUMN plan_version INTEGER DEFAULT 0');
    if (!sgCols.includes('deliver_to')) _db.exec(`ALTER TABLE scheduled_goals ADD COLUMN deliver_to TEXT DEFAULT '["web"]'`);
  } catch (_) {}

  /**
   * Generic multi-intent goal runs: durable plan steps + advance on async child terminal.
   * Orchestrator-agnostic (any agent_id / any owner); not CRM/ERP-specific.
   * Schema must match agent-goal-run.js ensureAgentGoalRunTables().
   */
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS agent_goal_runs (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        title TEXT DEFAULT '',
        prompt TEXT DEFAULT '',
        source TEXT DEFAULT '',
        scheduled_goal_id TEXT,
        scheduled_goal_run_id TEXT,
        status TEXT DEFAULT 'pending',
        context_json TEXT DEFAULT '{}',
        current_step_index INTEGER DEFAULT 0,
        error_message TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_goal_runs_owner ON agent_goal_runs(owner_user_id, created_at DESC)`
    );
    _db.exec(`
      CREATE TABLE IF NOT EXISTS agent_goal_steps (
        id TEXT PRIMARY KEY,
        goal_run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        step_type TEXT NOT NULL,
        label TEXT DEFAULT '',
        spec_json TEXT DEFAULT '{}',
        status TEXT DEFAULT 'pending',
        child_workflow_run_id INTEGER,
        result_json TEXT,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_goal_steps_run ON agent_goal_steps(goal_run_id, step_index ASC)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_goal_steps_wf ON agent_goal_steps(child_workflow_run_id)`
    );
  } catch (_) {}

  try {
    const agentCols = _db.prepare('PRAGMA table_info(agents)').all().map((c) => c.name);
    if (!agentCols.includes('is_orchestrator')) {
      _db.exec('ALTER TABLE agents ADD COLUMN is_orchestrator INTEGER DEFAULT 0');
    }
    _db.exec(`UPDATE agents SET is_orchestrator = 1 WHERE is_coo = 1`);
    _db.exec(
      `UPDATE agents SET is_orchestrator = 1
       WHERE lower(COALESCE(name, '')) = 'content orchestrator'
          OR lower(COALESCE(template_base_id, '')) = 'video-orchestrator'
          OR lower(COALESCE(id, '')) LIKE 'video-orch-%'`
    );
  } catch (_) {}
  try {
    const agCols = _db.prepare('PRAGMA table_info(agent_goal_steps)').all().map((c) => c.name);
    if (!agCols.includes('child_delegation_task_id')) {
      _db.exec('ALTER TABLE agent_goal_steps ADD COLUMN child_delegation_task_id INTEGER');
    }
    const runCols = _db.prepare('PRAGMA table_info(agent_goal_runs)').all().map((c) => c.name);
    if (runCols.length && !runCols.includes('outcome_json')) {
      _db.exec('ALTER TABLE agent_goal_runs ADD COLUMN outcome_json TEXT');
    }
    if (runCols.length && !runCols.includes('plan_history_json')) {
      _db.exec('ALTER TABLE agent_goal_runs ADD COLUMN plan_history_json TEXT');
    }
    if (agCols.length && !agCols.includes('exception_retry_count')) {
      _db.exec('ALTER TABLE agent_goal_steps ADD COLUMN exception_retry_count INTEGER DEFAULT 0');
    }
    if (agCols.length && !agCols.includes('exception_kanban_id')) {
      _db.exec('ALTER TABLE agent_goal_steps ADD COLUMN exception_kanban_id INTEGER');
    }
  } catch (_) {}
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS exception_policies (
        owner_user_id TEXT PRIMARY KEY,
        retry_limit INTEGER NOT NULL DEFAULT 1,
        create_kanban INTEGER NOT NULL DEFAULT 1,
        agent_pickup INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    const wfStepCols = _db.prepare('PRAGMA table_info(agent_workflow_run_steps)').all().map((c) => c.name);
    if (wfStepCols.length && !wfStepCols.includes('exception_retry_count')) {
      _db.exec('ALTER TABLE agent_workflow_run_steps ADD COLUMN exception_retry_count INTEGER DEFAULT 0');
    }
    if (wfStepCols.length && !wfStepCols.includes('exception_kanban_id')) {
      _db.exec('ALTER TABLE agent_workflow_run_steps ADD COLUMN exception_kanban_id INTEGER');
    }
  } catch (_) {}
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS goal_mission_events (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        goal_run_id TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_goal_mission_events_owner
        ON goal_mission_events(owner_user_id, created_at DESC);
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS action_family_policies (
        owner_user_id TEXT NOT NULL,
        family TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'autonomous',
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (owner_user_id, family)
      );
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS action_approval_grants (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        action_family TEXT NOT NULL,
        tool_name TEXT DEFAULT '',
        constraints_json TEXT DEFAULT '{}',
        remaining_uses INTEGER NOT NULL DEFAULT 1,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_action_approval_grants_owner
        ON action_approval_grants(owner_user_id, expires_at DESC);
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS action_policy_overrides (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        action_family TEXT NOT NULL,
        mode TEXT NOT NULL,
        constraints_json TEXT DEFAULT '{}',
        expires_at TEXT,
        max_uses INTEGER,
        use_count INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(owner_user_id, scope_type, scope_id, action_family)
      );
      CREATE INDEX IF NOT EXISTS idx_action_policy_overrides_owner_scope
        ON action_policy_overrides(owner_user_id, scope_type, scope_id, enabled);
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS tool_write_idempotency (
        owner_user_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        object_id TEXT,
        result_json TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (owner_user_id, tool_name, idempotency_key)
      );
    `);
  } catch (_) {}

  /**
   * Generic MCP OAuth — client config per MCP server + per-CEO connection tokens (vault refs).
   * Any future OAuth-based MCP can reuse these tables via Connectors → MCPs tab.
   */
  try {
    /**
     * OAuth client configs for Connectors → MCPs.
     * owner_user_id = '' → platform/admin default; non-empty → per-CEO override
     * (same table; resolve: CEO row first, else admin default). client_secret stored
     * encrypted with USER_API_KEYS_KEK when available (prefix enc:g1:).
     */
    _db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_oauth_configs (
        server_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT 'oauth2',
        display_name TEXT DEFAULT '',
        authorization_url TEXT NOT NULL,
        token_url TEXT NOT NULL,
        client_id TEXT DEFAULT '',
        client_secret TEXT DEFAULT '',
        client_id_env TEXT DEFAULT '',
        client_secret_env TEXT DEFAULT '',
        scopes TEXT DEFAULT '',
        auth_header_name TEXT DEFAULT 'Authorization',
        auth_header_template TEXT DEFAULT 'Bearer {{access_token}}',
        extra_auth_params_json TEXT DEFAULT '{}',
        token_request_style TEXT DEFAULT 'form',
        refresh_enabled INTEGER DEFAULT 1,
        provider_options_json TEXT DEFAULT '{}',
        enabled INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (server_id, owner_user_id),
        FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
      )
    `);
    // Migrate legacy single-row PK (server_id only) → composite + owner_user_id
    try {
      const cols = _db.prepare(`PRAGMA table_info(mcp_oauth_configs)`).all();
      const names = new Set(cols.map((c) => c.name));
      if (cols.length && !names.has('owner_user_id')) {
        _db.exec(`
          CREATE TABLE mcp_oauth_configs_migrated (
            server_id TEXT NOT NULL,
            owner_user_id TEXT NOT NULL DEFAULT '',
            provider TEXT NOT NULL DEFAULT 'oauth2',
            display_name TEXT DEFAULT '',
            authorization_url TEXT NOT NULL,
            token_url TEXT NOT NULL,
            client_id TEXT DEFAULT '',
            client_secret TEXT DEFAULT '',
            client_id_env TEXT DEFAULT '',
            client_secret_env TEXT DEFAULT '',
            scopes TEXT DEFAULT '',
            auth_header_name TEXT DEFAULT 'Authorization',
            auth_header_template TEXT DEFAULT 'Bearer {{access_token}}',
            extra_auth_params_json TEXT DEFAULT '{}',
            token_request_style TEXT DEFAULT 'form',
            refresh_enabled INTEGER DEFAULT 1,
            provider_options_json TEXT DEFAULT '{}',
            enabled INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (server_id, owner_user_id),
            FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
          );
          INSERT INTO mcp_oauth_configs_migrated (
            server_id, owner_user_id, provider, display_name, authorization_url, token_url,
            client_id, client_secret, client_id_env, client_secret_env, scopes,
            auth_header_name, auth_header_template, extra_auth_params_json, token_request_style,
            refresh_enabled, provider_options_json, enabled, created_at, updated_at
          )
          SELECT
            server_id, '', provider, display_name, authorization_url, token_url,
            client_id, client_secret, client_id_env, client_secret_env, scopes,
            auth_header_name, auth_header_template, extra_auth_params_json, token_request_style,
            refresh_enabled, provider_options_json, enabled, created_at, updated_at
          FROM mcp_oauth_configs;
          DROP TABLE mcp_oauth_configs;
          ALTER TABLE mcp_oauth_configs_migrated RENAME TO mcp_oauth_configs;
        `);
        console.info('[schema] migrated mcp_oauth_configs to owner_user_id composite PK');
      }
    } catch (migE) {
      console.warn('[schema] mcp_oauth_configs owner migration:', migE.message);
    }
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_mcp_oauth_configs_owner
       ON mcp_oauth_configs(owner_user_id, server_id)`
    );
    _db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_oauth_connections (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        access_token_ref TEXT DEFAULT '',
        refresh_token_ref TEXT DEFAULT '',
        access_token_hint TEXT DEFAULT '',
        expires_at TEXT,
        scopes TEXT DEFAULT '',
        account_label TEXT DEFAULT '',
        metadata_json TEXT DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'connected',
        last_error TEXT,
        connected_at TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(owner_user_id, server_id),
        FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_mcp_oauth_connections_server
       ON mcp_oauth_connections(server_id, owner_user_id)`
    );
    _db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_oauth_states (
        state TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        code_verifier TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_mcp_oauth_states_expires ON mcp_oauth_states(expires_at)`
    );
  } catch (_) {}

  // Central owner IP whitelist (Settings → IP Whitelists). Migration of legacy
  // rows runs on first service use (ensureOwnerIpWhitelistTables).
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS owner_ip_whitelists (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        cidr_or_ip TEXT NOT NULL,
        label TEXT DEFAULT '',
        apply_ibkr_bridge INTEGER NOT NULL DEFAULT 0,
        apply_workflow_desktop INTEGER NOT NULL DEFAULT 0,
        apply_a2a INTEGER NOT NULL DEFAULT 0,
        apply_browser_worker INTEGER NOT NULL DEFAULT 0,
        definition_id TEXT,
        publish_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_owner_ip_wl_owner
       ON owner_ip_whitelists(owner_user_id, created_at DESC)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_owner_ip_wl_desktop
       ON owner_ip_whitelists(owner_user_id, apply_workflow_desktop, definition_id)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_owner_ip_wl_a2a
       ON owner_ip_whitelists(owner_user_id, apply_a2a, publish_id)`
    );
    _db.exec(`
      CREATE TABLE IF NOT EXISTS owner_ip_whitelist_meta (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  } catch (_) {}

  /**
   * AI employees published to Agent Exchange (separate from workflow A2A).
   * visibility: public (internet A2A) | flolah (in-app Exchange only).
   */
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS agent_a2a_publications (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        avatar_image TEXT DEFAULT '',
        visibility TEXT NOT NULL DEFAULT 'flolah',
        auth_mode TEXT NOT NULL DEFAULT 'public',
        access_policy TEXT NOT NULL DEFAULT 'allow_all',
        status TEXT NOT NULL DEFAULT 'published',
        skill_id TEXT DEFAULT 'chat',
        published_at TEXT,
        unpublished_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_a2a_pub_owner
       ON agent_a2a_publications(owner_user_id, status, published_at DESC)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_a2a_pub_agent
       ON agent_a2a_publications(agent_id, status)`
    );
    _db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_a2a_pub_listed
       ON agent_a2a_publications(status, visibility, published_at DESC)`
    );
  } catch (_) {}

  ensureOrgPeopleSchema(_db);

  return _db;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** People (sub-users), roles, and Kanban human assignees under a CEO root tenant. */
function ensureOrgPeopleSchema(_db) {
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS org_roles (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        is_ceo_delegate INTEGER DEFAULT 0,
        is_builtin INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(owner_user_id, slug)
      )
    `);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS org_role_permissions (
        role_id TEXT NOT NULL,
        permission_key TEXT NOT NULL,
        PRIMARY KEY (role_id, permission_key),
        FOREIGN KEY (role_id) REFERENCES org_roles(id) ON DELETE CASCADE
      )
    `);
  } catch (e) {
    console.warn('[schema] org_roles tables:', e.message);
  }

  for (const sql of [
    `ALTER TABLE platform_users ADD COLUMN owner_user_id TEXT`,
    `ALTER TABLE platform_users ADD COLUMN org_role_id TEXT`,
    `ALTER TABLE platform_users ADD COLUMN department TEXT DEFAULT ''`,
    `ALTER TABLE platform_users ADD COLUMN parent_id TEXT DEFAULT ''`,
    `ALTER TABLE kanban_tasks ADD COLUMN assigned_user_id TEXT`,
  ]) {
    try {
      _db.exec(sql);
    } catch (_) {
      /* already exists */
    }
  }
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_users_owner ON platform_users(owner_user_id)`);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_org_roles_owner ON org_roles(owner_user_id)`);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_kanban_assigned_user ON kanban_tasks(assigned_user_id)`);
  } catch (_) {}

  try {
    const row = _db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='platform_users'`).get();
    const sql = String(row?.sql || '');
    if (sql && !sql.includes("'org_user'")) {
      migratePlatformUsersRoleCheck(_db);
    }
  } catch (e) {
    console.warn('[schema] platform_users org_user role migration:', e.message);
  }
}

function migratePlatformUsersRoleCheck(_db) {
  const cols = _db.prepare('PRAGMA table_info(platform_users)').all();
  if (!cols.length) return;
  const pkCols = cols.filter((c) => c.pk).sort((a, b) => a.pk - b.pk);
  const colDefs = cols.map((c) => {
    if (c.name === 'role') {
      return `role TEXT NOT NULL CHECK (role IN ('admin', 'ceo', 'org_user'))`;
    }
    let def = `${quoteIdent(c.name)} ${c.type || 'TEXT'}`;
    if (c.notnull && !c.pk) def += ' NOT NULL';
    if (c.dflt_value != null && c.dflt_value !== undefined) {
      let dflt = String(c.dflt_value);
      if (!/^\(.*\)$/.test(dflt) && /^[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(dflt)) {
        dflt = `(${dflt})`;
      }
      def += ` DEFAULT ${dflt}`;
    }
    return def;
  });
  if (pkCols.length === 1) {
    const i = cols.findIndex((c) => c.name === pkCols[0].name);
    if (i >= 0) colDefs[i] += ' PRIMARY KEY';
  } else if (pkCols.length > 1) {
    colDefs.push(`PRIMARY KEY (${pkCols.map((c) => quoteIdent(c.name)).join(', ')})`);
  }
  const names = cols.map((c) => quoteIdent(c.name)).join(', ');
  _db.exec('PRAGMA foreign_keys=OFF');
  try {
    _db.exec('DROP TABLE IF EXISTS platform_users_org_migrated');
    _db.exec(`CREATE TABLE platform_users_org_migrated (${colDefs.join(', ')})`);
    _db.exec(`INSERT INTO platform_users_org_migrated (${names}) SELECT ${names} FROM platform_users`);
    _db.exec('DROP TABLE platform_users');
    _db.exec('ALTER TABLE platform_users_org_migrated RENAME TO platform_users');
  } catch (e) {
    try {
      _db.exec('DROP TABLE IF EXISTS platform_users_org_migrated');
    } catch (_) {}
    _db.exec('PRAGMA foreign_keys=ON');
    throw e;
  }
  try {
    _db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_users_email ON platform_users(email)`);
  } catch (_) {}
  try {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_users_owner ON platform_users(owner_user_id)`);
  } catch (_) {}
  _db.exec('PRAGMA foreign_keys=ON');
  console.info('[schema] migrated platform_users.role CHECK to include org_user');
}

export function getDb() {
  if (!_db) initDb();
  return _db;
}

export { getDbPath };
