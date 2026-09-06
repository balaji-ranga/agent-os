import { createHash, randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { chatCompletions } from '../config/llm.js';

const PERIODS = new Set(['monthly', 'quarterly', 'half_yearly', 'annual']);
const STATUSES = new Set(['draft', 'active', 'paused', 'completed', 'cancelled']);
const HEALTH = new Set(['on_track', 'at_risk', 'off_track', 'blocked', 'complete', 'not_started']);

const db = () => getDb();
const id = (prefix) => `${prefix}-${randomUUID()}`;
const json = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const COMMON_FORMULAS = {
  count: ['count','Record count','Count unique matching records'], sum: ['sum','Sum','Sum a numeric field'], average: ['average','Average','Average a numeric field'],
  latest_value: ['latest_value','Latest value','Use the latest authoritative value'], change: ['change','Change','Difference from the period baseline'], percentage: ['percentage','Percentage','Matching records as a percentage of the population'],
  completion_rate: ['completion_rate','Completion rate','Completed items divided by eligible items'], success_rate: ['success_rate','Success rate','Successful executions divided by completed executions'],
  cycle_time: ['cycle_time','Cycle time','Average elapsed time from start to completion'], error_rate: ['error_rate','Error rate','Failed executions divided by all completed executions'],
};
const formula = (id, label = null, description = null) => { const common = COMMON_FORMULAS[id]; return { id, label: label || common?.[1] || id, description: description || common?.[2] || '' }; };

export function measurementRegistry(ownerUserId = null) {
  const sources = [
    { id: 'flolah_crm', label: 'CRM', category: 'Business data', provider: 'Flolah CRM / Twenty', availability: 'native', formulas: [formula('weighted_pipeline','Weighted pipeline','Sum opportunity amount multiplied by probability'),formula('pipeline_value','Pipeline value','Sum matching opportunity amounts'),formula('count'),formula('conversion_rate','Conversion rate','Converted records divided by eligible records'),formula('cycle_time')] },
    { id: 'flolah_erp', label: 'ERP', category: 'Business data', provider: 'Flolah ERP / ERPNext', availability: 'native', formulas: [formula('revenue','Revenue','Sum posted revenue in the objective period'),formula('expenses','Expenses','Sum posted expenses in the objective period'),formula('gross_margin','Gross margin','Revenue less direct cost as a percentage'),formula('invoice_count','Invoice count','Count matching invoices'),formula('collection_rate','Collection rate','Paid invoice value divided by due invoice value'),formula('sum'),formula('average')] },
    { id: 'business_events', label: 'Outcome evidence ledger', category: 'Business data', provider: 'Flolah objective evidence', availability: 'native', formulas: [formula('researched','Researched records','Count uniquely researched business records'),formula('qualified','Qualified records','Count evidence-qualified business records'),formula('drafts','Prepared drafts','Count evidence-backed draft artifacts'),formula('positive_responses','Positive responses','Count positively classified responses'),formula('weighted_pipeline','Weighted pipeline','Sum opportunity amount multiplied by probability'),formula('cost','Recorded cost','Sum costs attached to objective evidence')] },
    { id: 'goal_plans', label: 'Goal Plans', category: 'Execution data', provider: 'Flolah Goal Plans', availability: 'native', formulas: [formula('count'),formula('completion_rate'),formula('success_rate'),formula('cycle_time'),formula('evidence_count','Evidence count','Count durable evidence records produced by linked runs')] },
    { id: 'workflows', label: 'Workflows', category: 'Execution data', provider: 'Flolah Workflows', availability: 'native', formulas: [formula('count'),formula('completion_rate'),formula('success_rate'),formula('cycle_time'),formula('error_rate')] },
    { id: 'tasks', label: 'Tasks', category: 'Execution data', provider: 'Flolah Kanban', availability: 'native', formulas: [formula('count'),formula('completion_rate'),formula('overdue_count','Overdue count','Count unfinished tasks past due'),formula('cycle_time')] },
    { id: 'knowledge', label: 'Knowledge', category: 'Company data', provider: 'Flolah Knowledge / RAG', availability: 'native', formulas: [formula('document_count','Document count','Count matching owner-scoped documents'),formula('indexed_count','Indexed count','Count documents available to retrieval'),formula('retrieval_success_rate','Retrieval success rate','Queries with sufficient evidence divided by all queries'),formula('freshness','Freshness','Age of the newest qualifying evidence')] },
    { id: 'agents', label: 'AI employees', category: 'Execution data', provider: 'Flolah Agents', availability: 'native', formulas: [formula('activity_count','Activity count','Count matching agent activities'),formula('success_rate'),formula('error_rate'),formula('cycle_time')] },
    { id: 'communications', label: 'Communications', category: 'Channel data', provider: 'Email / WhatsApp / connected channels', availability: 'connection_dependent', formulas: [formula('sent_count','Sent count','Count receipt-backed external sends'),formula('reply_count','Reply count','Count correlated inbound replies'),formula('positive_response_rate','Positive response rate','Positive replies divided by classified replies'),formula('approval_queue','Approval queue','Count external actions awaiting approval')] },
    { id: 'llmops', label: 'AI and tool telemetry', category: 'Platform telemetry', provider: 'Flolah LLMOps', availability: 'native', formulas: [formula('cost','Cost','Total model and tool cost'),formula('tokens','Token usage','Total input and output tokens'),formula('error_rate'),formula('latency','Latency','Average execution latency')] },
    { id: 'events', label: 'Events and webhooks', category: 'Integration data', provider: 'Registered event stream', availability: 'configuration_required', formulas: [formula('count'),formula('sum'),formula('average'),formula('latest_value'),formula('change'),formula('percentage')] },
    { id: 'custom_api', label: 'Custom API or MCP', category: 'Integration data', provider: 'Registered API / MCP tool', availability: 'configuration_required', formulas: [formula('count'),formula('sum'),formula('average'),formula('latest_value'),formula('change'),formula('percentage')] },
    { id: 'documents', label: 'Evidence documents', category: 'Evidence', provider: 'Uploaded or agent-generated documents', availability: 'native', formulas: [formula('document_count','Document count'),formula('count'),formula('latest_value'),formula('percentage')] },
    { id: 'manual', label: 'Manual evidence', category: 'Fallback', provider: 'Human attestation', availability: 'fallback', formulas: [formula('latest_value'),formula('change'),formula('percentage'),formula('count')] },
  ];
  if (!ownerUserId) return { version: 1, scope: 'system', sources };
  ensureCompanyObjectiveTables();
  const safeAll = (sql, ...params) => { try { return db().prepare(sql).all(...params); } catch { return []; } };
  const safeGet = (sql, ...params) => { try { return db().prepare(sql).get(...params) || {}; } catch { return {}; } };
  const profile = safeGet('SELECT crm_provider,erp_provider FROM company_business_profiles WHERE owner_user_id=?', ownerUserId);
  const workflows = safeAll(`SELECT id,name,status FROM agent_workflow_definitions WHERE owner_user_id=? ORDER BY updated_at DESC LIMIT 100`, ownerUserId).map((row) => ({ id: row.id, label: row.name, status: row.status }));
  const agents = safeAll(`SELECT a.id,a.name,a.role FROM agents a JOIN user_agents ua ON ua.agent_id=a.id WHERE ua.user_id=? AND COALESCE(ua.enabled,1)=1 ORDER BY a.name LIMIT 100`, ownerUserId).map((row) => ({ id: row.id, label: row.name, detail: row.role }));
  const mcps = safeAll(`SELECT id,name,status,is_platform FROM mcp_servers WHERE (owner_user_id=? OR is_platform=1) AND status='healthy' ORDER BY is_platform DESC,name LIMIT 100`, ownerUserId).map((row) => ({ id: row.id, label: row.name, status: row.status, platform: Boolean(row.is_platform) }));
  const scripts = safeAll(`SELECT id,name,status FROM custom_scripts WHERE owner_user_id=? AND status='approved' AND scan_status='approved' ORDER BY name LIMIT 100`, ownerUserId).map((row) => ({ id: row.id, label: row.name, status: row.status }));
  const channels = mcps.filter((item) => /gmail|email|whatsapp|slack|linkedin|meta|message/i.test(item.label));
  const instances = {
    flolah_crm: profile.crm_provider && profile.crm_provider !== 'none' ? [{ id: `crm:${profile.crm_provider}`, label: `${profile.crm_provider} CRM` }] : [],
    flolah_erp: profile.erp_provider && profile.erp_provider !== 'none' ? [{ id: `erp:${profile.erp_provider}`, label: `${profile.erp_provider} ERP` }] : [],
    goal_plans: [{ id: 'goal_plans:owner', label: 'Company Goal Plans' }], workflows,
    tasks: [{ id: 'kanban:owner', label: 'Company Kanban tasks' }], knowledge: [{ id: 'knowledge:owner', label: 'Company Knowledge' }], agents,
    communications: channels, llmops: [{ id: 'llmops:owner', label: 'Company AI/tool telemetry' }], events: mcps,
    custom_api: [...mcps, ...scripts.map((item) => ({ ...item, id: `script:${item.id}` }))], documents: [{ id: 'documents:owner', label: 'Company evidence documents' }],
    business_events: [{ id: 'business_events:owner', label: 'Objective evidence ledger' }], manual: [{ id: 'manual:owner', label: 'Human attestation' }],
  };
  return { version: 1, scope: 'company', owner_user_id: ownerUserId, sources: sources.map((source) => {
    const bound = instances[source.id] || [];
    const nativeWithoutBinding = ['goal_plans','tasks','knowledge','llmops','documents','business_events','manual'].includes(source.id);
    return { ...source, instances: bound, availability: bound.length || nativeWithoutBinding ? 'available' : 'configuration_required' };
  }) };
}

export function ensureCompanyObjectiveTables() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS company_objectives (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      outcome TEXT NOT NULL,
      period_type TEXT NOT NULL,
      period_label TEXT NOT NULL,
      starts_on TEXT NOT NULL,
      ends_on TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      owner_label TEXT DEFAULT 'COO',
      parent_objective_id TEXT,
      currency TEXT DEFAULT 'SGD',
      budget_amount REAL DEFAULT 0,
      authority_json TEXT DEFAULT '{}',
      constraints_json TEXT DEFAULT '[]',
      assumptions_json TEXT DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1,
      approved_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_company_objectives_owner_period
      ON company_objectives(owner_user_id, starts_on DESC, status);
    CREATE TABLE IF NOT EXISTS company_objective_versions (
      id TEXT PRIMARY KEY,
      objective_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      reason TEXT,
      actor_user_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(objective_id, version)
    );
    CREATE TABLE IF NOT EXISTS company_key_results (
      id TEXT PRIMARY KEY,
      objective_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      definition TEXT DEFAULT '',
      baseline REAL DEFAULT 0,
      target REAL NOT NULL,
      current_value REAL DEFAULT 0,
      unit TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'manual',
      formula TEXT DEFAULT '',
      confidence TEXT DEFAULT 'medium',
      owner_label TEXT DEFAULT 'COO',
      ordinal INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_company_key_results_objective ON company_key_results(objective_id, ordinal);
    CREATE TABLE IF NOT EXISTS company_initiatives (
      id TEXT PRIMARY KEY,
      objective_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      owner_label TEXT DEFAULT 'COO',
      cadence TEXT DEFAULT '',
      authority_json TEXT DEFAULT '{}',
      budget_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'draft',
      prompt TEXT DEFAULT '',
      next_run_at TEXT,
      ordinal INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS company_objective_measurements (
      id TEXT PRIMARY KEY,
      objective_id TEXT NOT NULL,
      key_result_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      value REAL NOT NULL,
      delta REAL DEFAULT 0,
      source_type TEXT NOT NULL,
      source_id TEXT,
      evidence_json TEXT DEFAULT '[]',
      measured_at TEXT DEFAULT (datetime('now')),
      UNIQUE(key_result_id, source_type, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_company_objective_measurements_kr
      ON company_objective_measurements(key_result_id, measured_at DESC);
    CREATE TABLE IF NOT EXISTS company_objective_goal_runs (
      objective_id TEXT NOT NULL,
      initiative_id TEXT,
      key_result_id TEXT,
      goal_run_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY(objective_id, goal_run_id)
    );
    CREATE TABLE IF NOT EXISTS company_initiative_scheduled_goals (
      initiative_id TEXT NOT NULL,
      objective_id TEXT NOT NULL,
      scheduled_goal_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY(initiative_id, scheduled_goal_id)
    );
    CREATE INDEX IF NOT EXISTS idx_company_initiative_schedules_objective
      ON company_initiative_scheduled_goals(objective_id, owner_user_id);
    CREATE TABLE IF NOT EXISTS company_revenue_evidence (
      id TEXT PRIMARY KEY,
      objective_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      record_type TEXT NOT NULL,
      external_id TEXT,
      account_name TEXT,
      status TEXT,
      amount REAL DEFAULT 0,
      probability REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      evidence_json TEXT DEFAULT '[]',
      metadata_json TEXT DEFAULT '{}',
      occurred_at TEXT DEFAULT (datetime('now')),
      UNIQUE(owner_user_id, objective_id, record_type, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_company_revenue_evidence_objective
      ON company_revenue_evidence(objective_id, record_type, occurred_at DESC);
    CREATE TABLE IF NOT EXISTS company_objective_approvals (
      id TEXT PRIMARY KEY,
      objective_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      recipients_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 1,
      used_count INTEGER NOT NULL DEFAULT 0,
      decided_by TEXT,
      decided_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_company_objective_approvals_objective
      ON company_objective_approvals(objective_id, status, created_at DESC);
  `);
  const krColumns = db().prepare('PRAGMA table_info(company_key_results)').all().map((column) => column.name);
  if (!krColumns.includes('measurement_config_json')) db().exec("ALTER TABLE company_key_results ADD COLUMN measurement_config_json TEXT DEFAULT '{}'");
}

function scheduleSpec(cadenceValue) {
  const value = text(cadenceValue, 120).trim();
  const lower = value.toLowerCase();
  const time = value.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/)?.[0] || '09:00';
  if (lower.startsWith('weekdays')) return { cadence: 'weekdays', time_local: time };
  if (lower.startsWith('daily')) return { cadence: 'daily', time_local: time };
  if (lower.startsWith('weekly')) return { cadence: 'weekly', time_local: time, weekday: 1 };
  return null;
}

function initiativeState(objectiveStatus) {
  if (objectiveStatus === 'active') return 'active';
  if (objectiveStatus === 'completed') return 'completed';
  if (objectiveStatus === 'cancelled') return 'cancelled';
  return objectiveStatus === 'paused' ? 'paused' : 'draft';
}

function ownerCooAgentId(ownerUserId) {
  return db().prepare(`SELECT a.id FROM agents a JOIN user_agents ua ON ua.agent_id=a.id
    WHERE ua.user_id=? AND COALESCE(ua.enabled,1)=1 AND COALESCE(a.is_coo,0)=1 LIMIT 1`).get(ownerUserId)?.id
    || db().prepare('SELECT id FROM agents WHERE COALESCE(is_coo,0)=1 ORDER BY id LIMIT 1').get()?.id
    || 'coo';
}

/** Idempotently materialise recurring initiatives as native Scheduled Goals. */
export function ensureObjectiveOperatingModel(ownerUserId, objectiveId) {
  ensureCompanyObjectiveTables();
  const objective = db().prepare('SELECT * FROM company_objectives WHERE id=? AND owner_user_id=?').get(objectiveId, ownerUserId);
  if (!objective) throw Object.assign(new Error('Objective not found'), { status: 404 });
  const initiatives = db().prepare('SELECT * FROM company_initiatives WHERE objective_id=? AND owner_user_id=? ORDER BY ordinal,id').all(objectiveId, ownerUserId);
  const agentId = ownerCooAgentId(ownerUserId);
  const scheduleStatus = objective.status === 'active' ? 'active' : objective.status === 'completed' || objective.status === 'cancelled' ? 'deleted' : 'paused';
  const tx = db().transaction(() => {
    db().prepare('UPDATE company_initiatives SET status=?,updated_at=datetime(\'now\') WHERE objective_id=? AND owner_user_id=?').run(initiativeState(objective.status), objectiveId, ownerUserId);
    for (const initiative of initiatives) {
      const spec = scheduleSpec(initiative.cadence);
      if (!spec) continue;
      const scheduleId = `sg-obj-${createHash('sha256').update(`${ownerUserId}:${initiative.id}`).digest('hex').slice(0, 24)}`;
      db().prepare(`INSERT INTO scheduled_goals(id,owner_user_id,title,prompt,agent_id,cadence,weekday,time_local,timezone,ends_at,status,source,plan_status,deliver_to)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,prompt=excluded.prompt,cadence=excluded.cadence,weekday=excluded.weekday,time_local=excluded.time_local,ends_at=excluded.ends_at,status=excluded.status,updated_at=datetime('now')`).run(
        scheduleId, ownerUserId, initiative.name, initiative.prompt, agentId, spec.cadence, spec.weekday ?? null, spec.time_local, 'Asia/Singapore', `${objective.ends_on}T23:59:59.000Z`, scheduleStatus, 'company_objective', 'none', '["web"]'
      );
      db().prepare(`INSERT OR IGNORE INTO company_initiative_scheduled_goals(initiative_id,objective_id,scheduled_goal_id,owner_user_id) VALUES(?,?,?,?)`).run(initiative.id, objectiveId, scheduleId, ownerUserId);
    }
    db().prepare(`UPDATE scheduled_goals SET status=?,updated_at=datetime('now') WHERE owner_user_id=? AND id IN
      (SELECT scheduled_goal_id FROM company_initiative_scheduled_goals WHERE objective_id=? AND owner_user_id=?)`).run(scheduleStatus, ownerUserId, objectiveId, ownerUserId);
    const firstInitiative = initiatives[0]?.id;
    if (firstInitiative) db().prepare(`UPDATE company_objective_goal_runs SET initiative_id=? WHERE objective_id=? AND owner_user_id=? AND initiative_id IS NULL`).run(firstInitiative, objectiveId, ownerUserId);
  });
  tx();
  return serializeObjective(objective, true);
}

function validatePeriod(input) {
  const periodType = text(input.period_type || input.periodType, 32).toLowerCase();
  if (!PERIODS.has(periodType)) throw Object.assign(new Error('Period must be monthly, quarterly, half_yearly or annual'), { status: 400 });
  const startsOn = text(input.starts_on || input.startsOn, 10);
  const endsOn = text(input.ends_on || input.endsOn, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || startsOn > endsOn) {
    throw Object.assign(new Error('Valid starts_on and ends_on are required'), { status: 400 });
  }
  return { periodType, startsOn, endsOn, periodLabel: text(input.period_label || input.periodLabel, 80) || `${startsOn} to ${endsOn}` };
}

function serializeObjective(row, full = false) {
  if (!row) return null;
  const out = {
    ...row,
    authority: json(row.authority_json, {}), constraints: json(row.constraints_json, []), assumptions: json(row.assumptions_json, []),
    budget_amount: num(row.budget_amount), version: num(row.version, 1),
  };
  delete out.authority_json; delete out.constraints_json; delete out.assumptions_json;
  if (!full) return out;
  out.key_results = db().prepare('SELECT * FROM company_key_results WHERE objective_id=? AND owner_user_id=? ORDER BY ordinal,id').all(row.id, row.owner_user_id).map((kr) => { const result = { ...kr, measurement_config: json(kr.measurement_config_json, {}), baseline: num(kr.baseline), target: num(kr.target), current_value: num(kr.current_value), progress_pct: kr.target ? Math.max(0, Math.min(100, Math.round((num(kr.current_value) / num(kr.target)) * 1000) / 10)) : 0 }; delete result.measurement_config_json; return result; });
  out.initiatives = db().prepare('SELECT * FROM company_initiatives WHERE objective_id=? AND owner_user_id=? ORDER BY ordinal,id').all(row.id, row.owner_user_id).map((i) => {
    const schedules = db().prepare(`SELECT sg.* FROM company_initiative_scheduled_goals m JOIN scheduled_goals sg ON sg.id=m.scheduled_goal_id AND sg.owner_user_id=m.owner_user_id WHERE m.initiative_id=? AND m.owner_user_id=? ORDER BY sg.created_at`).all(i.id, row.owner_user_id).map((sg) => ({
      ...sg,
      goal_plan_runs: db().prepare(`SELECT id AS goal_run_id,title,status,created_at,completed_at FROM agent_goal_runs WHERE owner_user_id=? AND scheduled_goal_id=? ORDER BY created_at DESC LIMIT 20`).all(row.owner_user_id, sg.id),
    }));
    const adhocGoalPlans = db().prepare(`SELECT l.goal_run_id,g.title,g.status,g.created_at,g.completed_at FROM company_objective_goal_runs l JOIN agent_goal_runs g ON g.id=l.goal_run_id AND g.owner_user_id=l.owner_user_id WHERE l.objective_id=? AND l.initiative_id=? AND l.owner_user_id=? AND g.scheduled_goal_id IS NULL ORDER BY g.created_at DESC LIMIT 20`).all(row.id, i.id, row.owner_user_id);
    return { ...i, authority: json(i.authority_json, {}), budget_amount: num(i.budget_amount), scheduled_goals: schedules, adhoc_goal_plans: adhocGoalPlans };
  });
  out.goal_runs = db().prepare(`SELECT l.*,g.title,g.status,g.created_at AS goal_created_at,g.completed_at FROM company_objective_goal_runs l LEFT JOIN agent_goal_runs g ON g.id=l.goal_run_id AND g.owner_user_id=l.owner_user_id WHERE l.objective_id=? AND l.owner_user_id=? ORDER BY l.created_at DESC LIMIT 100`).all(row.id, row.owner_user_id);
  out.approvals = db().prepare('SELECT * FROM company_objective_approvals WHERE objective_id=? AND owner_user_id=? ORDER BY created_at DESC LIMIT 100').all(row.id, row.owner_user_id).map((a) => ({ ...a, recipients: json(a.recipients_json, []), max_uses: num(a.max_uses), used_count: num(a.used_count), recipients_json: undefined }));
  out.revenue = revenueSummary(row.owner_user_id, row.id);
  const allRuns = out.initiatives.flatMap((i) => [...i.scheduled_goals.flatMap((s) => s.goal_plan_runs), ...i.adhoc_goal_plans]);
  out.execution_summary = { goal_plan_runs: allRuns.length, completed_runs: allRuns.filter((r) => r.status === 'completed').length, scheduled_goals: out.initiatives.reduce((n, i) => n + i.scheduled_goals.length, 0), adhoc_goal_plans: out.initiatives.reduce((n, i) => n + i.adhoc_goal_plans.length, 0) };
  out.health = deriveHealth(out);
  return out;
}

function deriveHealth(objective) {
  if (objective.status === 'completed') return 'complete';
  if (objective.status !== 'active') return 'not_started';
  if (objective.revenue?.blockers > 0) return 'blocked';
  const progress = objective.key_results?.length ? objective.key_results.reduce((s, k) => s + k.progress_pct, 0) / objective.key_results.length : 0;
  const start = Date.parse(`${objective.starts_on}T00:00:00Z`), end = Date.parse(`${objective.ends_on}T23:59:59Z`);
  const elapsed = end > start ? Math.max(0, Math.min(100, ((Date.now() - start) / (end - start)) * 100)) : 0;
  if (progress + 20 < elapsed) return 'off_track';
  if (progress + 8 < elapsed) return 'at_risk';
  return 'on_track';
}

function snapshot(ownerUserId, objectiveId, reason, actorUserId) {
  const row = db().prepare('SELECT * FROM company_objectives WHERE id=? AND owner_user_id=?').get(objectiveId, ownerUserId);
  if (!row) return;
  const body = serializeObjective(row, true);
  db().prepare('INSERT OR REPLACE INTO company_objective_versions(id,objective_id,owner_user_id,version,snapshot_json,reason,actor_user_id) VALUES(?,?,?,?,?,?,?)').run(id('objv'), objectiveId, ownerUserId, row.version, JSON.stringify(body), text(reason, 500), text(actorUserId, 120));
}

export function listObjectives(ownerUserId, { limit = 20, offset = 0, periodType = null, status = null } = {}) {
  ensureCompanyObjectiveTables();
  const lim = Math.min(100, Math.max(1, num(limit, 20))), off = Math.max(0, num(offset));
  let where = 'owner_user_id=?', params = [ownerUserId];
  if (periodType) { where += ' AND period_type=?'; params.push(periodType); }
  if (status) { where += ' AND status=?'; params.push(status); }
  const total = db().prepare(`SELECT COUNT(*) AS n FROM company_objectives WHERE ${where}`).get(...params).n;
  const rows = db().prepare(`SELECT * FROM company_objectives WHERE ${where} ORDER BY starts_on DESC,created_at DESC LIMIT ? OFFSET ?`).all(...params, lim, off).map((r) => serializeObjective(r, true));
  return { objectives: rows, total, limit: lim, offset: off, has_more: off + rows.length < total };
}

export function getObjective(ownerUserId, objectiveId) {
  ensureCompanyObjectiveTables();
  return serializeObjective(db().prepare('SELECT * FROM company_objectives WHERE id=? AND owner_user_id=?').get(objectiveId, ownerUserId), true);
}

export function createObjective(ownerUserId, input = {}, actorUserId = null) {
  ensureCompanyObjectiveTables();
  const p = validatePeriod(input);
  const name = text(input.name, 180), outcome = text(input.outcome || input.prompt, 4000);
  if (!name || !outcome) throw Object.assign(new Error('Objective name and outcome are required'), { status: 400 });
  const objectiveId = input.id ? text(input.id, 120) : id('obj');
  const status = STATUSES.has(input.status) ? input.status : 'draft';
  const tx = db().transaction(() => {
    db().prepare(`INSERT INTO company_objectives(id,owner_user_id,name,outcome,period_type,period_label,starts_on,ends_on,status,owner_label,parent_objective_id,currency,budget_amount,authority_json,constraints_json,assumptions_json,approved_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(objectiveId, ownerUserId, name, outcome, p.periodType, p.periodLabel, p.startsOn, p.endsOn, status, text(input.owner_label, 120) || 'COO', text(input.parent_objective_id, 120) || null, text(input.currency, 8) || 'SGD', Math.max(0, num(input.budget_amount)), JSON.stringify(input.authority || {}), JSON.stringify(Array.isArray(input.constraints) ? input.constraints : []), JSON.stringify(Array.isArray(input.assumptions) ? input.assumptions : []), status === 'active' ? new Date().toISOString() : null);
    replaceChildren(ownerUserId, objectiveId, input.key_results, input.initiatives, status);
    snapshot(ownerUserId, objectiveId, 'Objective created', actorUserId);
  }); tx();
  if (status === 'active') ensureObjectiveOperatingModel(ownerUserId, objectiveId);
  return getObjective(ownerUserId, objectiveId);
}

function replaceChildren(ownerUserId, objectiveId, keyResults = [], initiatives = [], objectiveStatus = 'draft') {
  db().prepare('DELETE FROM company_key_results WHERE objective_id=? AND owner_user_id=?').run(objectiveId, ownerUserId);
  db().prepare('DELETE FROM company_initiatives WHERE objective_id=? AND owner_user_id=?').run(objectiveId, ownerUserId);
  const insKr = db().prepare(`INSERT INTO company_key_results(id,objective_id,owner_user_id,name,definition,baseline,target,current_value,unit,source_type,formula,confidence,owner_label,ordinal,measurement_config_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  (keyResults || []).forEach((k, index) => insKr.run(k.id || id('kr'), objectiveId, ownerUserId, text(k.name, 220) || `Key result ${index + 1}`, text(k.definition, 1000), num(k.baseline), num(k.target, 1), num(k.current_value), text(k.unit, 40) || 'count', text(k.source_type, 60) || 'manual', text(k.formula, 1000), text(k.confidence, 20) || 'medium', text(k.owner_label, 120) || 'COO', index, JSON.stringify(k.measurement_config || { window: 'objective_period', refresh: 'event_driven', provenance: true })));
  const insI = db().prepare(`INSERT INTO company_initiatives(id,objective_id,owner_user_id,name,owner_label,cadence,authority_json,budget_amount,status,prompt,next_run_at,ordinal) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  (initiatives || []).forEach((i, index) => insI.run(i.id || id('init'), objectiveId, ownerUserId, text(i.name, 220) || `Initiative ${index + 1}`, text(i.owner_label, 120) || 'COO', text(i.cadence, 120), JSON.stringify(i.authority || {}), Math.max(0, num(i.budget_amount)), initiativeState(objectiveStatus), text(i.prompt, 3000), i.next_run_at || null, index));
}

export function updateObjective(ownerUserId, objectiveId, patch = {}, actorUserId = null) {
  ensureCompanyObjectiveTables();
  const current = getObjective(ownerUserId, objectiveId);
  if (!current) throw Object.assign(new Error('Objective not found'), { status: 404 });
  const merged = { ...current, ...patch };
  const p = validatePeriod(merged);
  const status = STATUSES.has(merged.status) ? merged.status : current.status;
  const version = current.version + 1;
  const tx = db().transaction(() => {
    db().prepare(`UPDATE company_objectives SET name=?,outcome=?,period_type=?,period_label=?,starts_on=?,ends_on=?,status=?,owner_label=?,parent_objective_id=?,currency=?,budget_amount=?,authority_json=?,constraints_json=?,assumptions_json=?,version=?,approved_at=CASE WHEN ?='active' AND approved_at IS NULL THEN datetime('now') ELSE approved_at END,updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(text(merged.name, 180), text(merged.outcome, 4000), p.periodType, p.periodLabel, p.startsOn, p.endsOn, status, text(merged.owner_label, 120) || 'COO', text(merged.parent_objective_id, 120) || null, text(merged.currency, 8) || 'SGD', Math.max(0, num(merged.budget_amount)), JSON.stringify(merged.authority || {}), JSON.stringify(merged.constraints || []), JSON.stringify(merged.assumptions || []), version, status, objectiveId, ownerUserId);
    if (patch.key_results || patch.initiatives) replaceChildren(ownerUserId, objectiveId, patch.key_results || current.key_results, patch.initiatives || current.initiatives, status);
    snapshot(ownerUserId, objectiveId, patch.reason || `Objective updated to v${version}`, actorUserId);
  }); tx();
  ensureObjectiveOperatingModel(ownerUserId, objectiveId);
  return getObjective(ownerUserId, objectiveId);
}

export function measureKeyResult(ownerUserId, objectiveId, keyResultId, input = {}) {
  ensureCompanyObjectiveTables();
  const kr = db().prepare('SELECT * FROM company_key_results WHERE id=? AND objective_id=? AND owner_user_id=?').get(keyResultId, objectiveId, ownerUserId);
  if (!kr) throw Object.assign(new Error('Key result not found'), { status: 404 });
  const value = num(input.value), measurementId = id('measure');
  const sourceType = text(input.source_type, 80) || 'manual', sourceId = text(input.source_id, 160) || measurementId;
  const tx = db().transaction(() => {
    db().prepare(`INSERT INTO company_objective_measurements(id,objective_id,key_result_id,owner_user_id,value,delta,source_type,source_id,evidence_json,measured_at) VALUES(?,?,?,?,?,?,?,?,?,COALESCE(?,datetime('now'))) ON CONFLICT(key_result_id,source_type,source_id) DO UPDATE SET value=excluded.value,delta=excluded.delta,evidence_json=excluded.evidence_json,measured_at=excluded.measured_at`).run(measurementId, objectiveId, keyResultId, ownerUserId, value, value - num(kr.current_value), sourceType, sourceId, JSON.stringify(input.evidence || []), input.measured_at || null);
    db().prepare(`UPDATE company_key_results SET current_value=?,confidence=?,updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(value, text(input.confidence, 20) || kr.confidence, keyResultId, ownerUserId);
  }); tx();
  return getObjective(ownerUserId, objectiveId);
}

export function linkGoalRun(ownerUserId, objectiveId, input = {}) {
  ensureCompanyObjectiveTables();
  if (!getObjective(ownerUserId, objectiveId)) throw Object.assign(new Error('Objective not found'), { status: 404 });
  const goalRunId = text(input.goal_run_id, 160);
  const goal = db().prepare('SELECT id FROM agent_goal_runs WHERE id=? AND owner_user_id=?').get(goalRunId, ownerUserId);
  if (!goal) throw Object.assign(new Error('Owner-scoped Goal Plan not found'), { status: 404 });
  db().prepare(`INSERT INTO company_objective_goal_runs(objective_id,initiative_id,key_result_id,goal_run_id,owner_user_id) VALUES(?,?,?,?,?) ON CONFLICT(objective_id,goal_run_id) DO UPDATE SET initiative_id=excluded.initiative_id,key_result_id=excluded.key_result_id`).run(objectiveId, text(input.initiative_id, 160) || null, text(input.key_result_id, 160) || null, goalRunId, ownerUserId);
  return getObjective(ownerUserId, objectiveId);
}

export function upsertRevenueEvidence(ownerUserId, objectiveId, input = {}) {
  ensureCompanyObjectiveTables();
  if (!getObjective(ownerUserId, objectiveId)) throw Object.assign(new Error('Objective not found'), { status: 404 });
  const recordType = text(input.record_type, 60), externalId = text(input.external_id, 180) || id('rev');
  if (!recordType) throw Object.assign(new Error('record_type is required'), { status: 400 });
  db().transaction(() => {
    if (recordType === 'send' && text(input.status, 80) === 'sent') consumeApprovalForSend(ownerUserId, objectiveId, input);
    db().prepare(`INSERT INTO company_revenue_evidence(id,objective_id,owner_user_id,record_type,external_id,account_name,status,amount,probability,cost,evidence_json,metadata_json,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,datetime('now'))) ON CONFLICT(owner_user_id,objective_id,record_type,external_id) DO UPDATE SET account_name=excluded.account_name,status=excluded.status,amount=excluded.amount,probability=excluded.probability,cost=excluded.cost,evidence_json=excluded.evidence_json,metadata_json=excluded.metadata_json,occurred_at=excluded.occurred_at`).run(id('rev'), objectiveId, ownerUserId, recordType, externalId, text(input.account_name, 240), text(input.status, 80), num(input.amount), num(input.probability), num(input.cost), JSON.stringify(input.evidence || []), JSON.stringify(input.metadata || {}), input.occurred_at || null);
  })();
  refreshRevenueMeasurements(ownerUserId, objectiveId);
  return getObjective(ownerUserId, objectiveId);
}

export function createObjectiveApproval(ownerUserId, objectiveId, input = {}) {
  ensureCompanyObjectiveTables();
  if (!getObjective(ownerUserId, objectiveId)) throw Object.assign(new Error('Objective not found'), { status: 404 });
  const channel = text(input.channel, 40), contentHash = text(input.content_hash, 128) || createHash('sha256').update(text(input.content, 20000)).digest('hex');
  const recipients = [...new Set((Array.isArray(input.recipients) ? input.recipients : []).map((r) => text(r, 320)).filter(Boolean))];
  if (!channel || !contentHash || !recipients.length) throw Object.assign(new Error('channel, content/content_hash and recipients are required'), { status: 400 });
  const expires = input.expires_at ? new Date(input.expires_at) : new Date(Date.now() + 48 * 3600 * 1000);
  if (!Number.isFinite(expires.getTime()) || expires <= new Date()) throw Object.assign(new Error('Approval expiry must be in the future'), { status: 400 });
  const approvalId = id('approval');
  db().prepare('INSERT INTO company_objective_approvals(id,objective_id,owner_user_id,channel,content_hash,recipients_json,expires_at,max_uses) VALUES(?,?,?,?,?,?,?,?)').run(approvalId, objectiveId, ownerUserId, channel, contentHash, JSON.stringify(recipients), expires.toISOString(), Math.min(1000, Math.max(1, num(input.max_uses, recipients.length))));
  return getObjective(ownerUserId, objectiveId).approvals.find((a) => a.id === approvalId);
}

export function decideObjectiveApproval(ownerUserId, objectiveId, approvalId, decision, actorUserId) {
  ensureCompanyObjectiveTables();
  const next = text(decision, 20).toLowerCase();
  if (!['approved', 'rejected'].includes(next)) throw Object.assign(new Error('Decision must be approved or rejected'), { status: 400 });
  const changed = db().prepare("UPDATE company_objective_approvals SET status=?,decided_by=?,decided_at=datetime('now') WHERE id=? AND objective_id=? AND owner_user_id=? AND status='pending'").run(next, text(actorUserId, 120), approvalId, objectiveId, ownerUserId);
  if (!changed.changes) throw Object.assign(new Error('Pending approval not found'), { status: 404 });
  return getObjective(ownerUserId, objectiveId).approvals.find((a) => a.id === approvalId);
}

function consumeApprovalForSend(ownerUserId, objectiveId, input) {
  const metadata = input.metadata || {};
  const approvalId = text(metadata.approval_id || input.approval_id, 160);
  const recipient = text(metadata.recipient || input.recipient, 320);
  const channel = text(metadata.channel || input.channel, 40);
  const contentHash = text(metadata.content_hash || input.content_hash, 128);
  const approval = db().prepare("SELECT * FROM company_objective_approvals WHERE id=? AND objective_id=? AND owner_user_id=? AND status='approved'").get(approvalId, objectiveId, ownerUserId);
  if (!approval) throw Object.assign(new Error('Exact approved grant required before recording an external send'), { status: 403 });
  if (Date.parse(approval.expires_at) <= Date.now() || approval.used_count >= approval.max_uses) throw Object.assign(new Error('Approval grant expired or exhausted'), { status: 403 });
  if (approval.channel !== channel || approval.content_hash !== contentHash || !json(approval.recipients_json, []).includes(recipient)) throw Object.assign(new Error('Send does not match approved channel, content and recipient'), { status: 403 });
  db().prepare('UPDATE company_objective_approvals SET used_count=used_count+1 WHERE id=?').run(approval.id);
}

export function listRevenueEvidence(ownerUserId, objectiveId, { limit = 50, offset = 0, recordType = null } = {}) {
  ensureCompanyObjectiveTables();
  const lim = Math.min(100, Math.max(1, num(limit, 50))), off = Math.max(0, num(offset));
  let where = 'objective_id=? AND owner_user_id=?', args = [objectiveId, ownerUserId];
  if (recordType) { where += ' AND record_type=?'; args.push(recordType); }
  const total = db().prepare(`SELECT COUNT(*) AS n FROM company_revenue_evidence WHERE ${where}`).get(...args).n;
  const evidence = db().prepare(`SELECT * FROM company_revenue_evidence WHERE ${where} ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?`).all(...args, lim, off).map((r) => ({ ...r, evidence: json(r.evidence_json, []), metadata: json(r.metadata_json, {}), evidence_json: undefined, metadata_json: undefined }));
  return { evidence, total, limit: lim, offset: off, has_more: off + evidence.length < total };
}

export function revenueSummary(ownerUserId, objectiveId, { from = null, to = null } = {}) {
  ensureCompanyObjectiveTables();
  let where = 'owner_user_id=? AND objective_id=?', args = [ownerUserId, objectiveId];
  if (from) { where += ' AND date(occurred_at)>=date(?)'; args.push(from); }
  if (to) { where += ' AND date(occurred_at)<=date(?)'; args.push(to); }
  const rows = db().prepare(`SELECT record_type,status,amount,probability,cost,metadata_json FROM company_revenue_evidence WHERE ${where}`).all(...args);
  const count = (type, status = null) => rows.filter((r) => r.record_type === type && (!status || r.status === status)).length;
  const opportunities = rows.filter((r) => r.record_type === 'opportunity' && ['qualified', 'discovery', 'solution_fit', 'proposal'].includes(r.status));
  return {
    researched: count('candidate'), qualified: count('qualification', 'qualified'), rejected: count('qualification', 'rejected'),
    drafts: count('outreach_draft'), awaiting_approval: rows.filter((r) => r.record_type === 'outreach_draft' && r.status === 'awaiting_approval').length,
    approved_sends: count('send', 'sent'), positive_responses: count('response', 'positive'), blockers: count('exception', 'open'),
    face_pipeline: opportunities.reduce((s, r) => s + num(r.amount), 0),
    weighted_pipeline: opportunities.reduce((s, r) => s + num(r.amount) * Math.max(0, Math.min(1, num(r.probability))), 0),
    cost: rows.reduce((s, r) => s + num(r.cost), 0), evidence_records: rows.length,
  };
}

function refreshRevenueMeasurements(ownerUserId, objectiveId) {
  const summary = revenueSummary(ownerUserId, objectiveId);
  const map = { researched: summary.researched, qualified: summary.qualified, rejected: summary.rejected, drafts: summary.drafts, weighted_pipeline: summary.weighted_pipeline, cost: summary.cost, positive_responses: summary.positive_responses };
  const rows = db().prepare('SELECT * FROM company_key_results WHERE objective_id=? AND owner_user_id=?').all(objectiveId, ownerUserId);
  for (const kr of rows) {
    const formula = text(kr.formula, 100).toLowerCase();
    if (Object.hasOwn(map, formula)) db().prepare('UPDATE company_key_results SET current_value=?,confidence=?,updated_at=datetime(\'now\') WHERE id=?').run(map[formula], 'high', kr.id);
  }
}

function defaultProposal(input = {}) {
  const outcome = text(input.outcome || input.prompt, 4000);
  const targetMatch = outcome.match(/(?:s\$|sgd\s*)\s*([\d,.]+)\s*k?/i);
  let pipelineTarget = targetMatch ? Number(targetMatch[1].replace(/,/g, '')) : 100000;
  if (/\d(?:\.\d+)?\s*k\b/i.test(targetMatch?.[0] || '')) pipelineTarget *= 1000;
  const p = validatePeriod(input);
  return {
    name: text(input.name, 180) || `${p.periodLabel} qualified pipeline`, outcome,
    ...p, currency: text(input.currency, 8) || 'SGD', budget_amount: Math.max(0, num(input.budget_amount, 450)), owner_label: 'COO',
    authority: { internal_research: 'allowed', reversible_crm_writes: 'allowed', external_communications: 'approval_required' },
    constraints: ['Do not invent contact data or personalisation claims.', 'Do not send external communications without a matching approval.', 'Keep all records company-scoped.'],
    assumptions: ['Pipeline progress uses probability-weighted accepted CRM opportunities.', 'The CRM and at least one research source must be connected before activation.'],
    key_results: [
      { name: `Create ${pipelineTarget.toLocaleString('en-SG')} SGD qualified pipeline`, target: pipelineTarget, unit: 'SGD', source_type: 'flolah_crm', formula: 'weighted_pipeline', definition: 'Probability-weighted accepted CRM opportunities.' },
      { name: 'Research target accounts', target: 240, unit: 'accounts', source_type: 'business_events', formula: 'researched' },
      { name: 'Qualify accounts with evidence', target: 90, unit: 'accounts', source_type: 'business_events', formula: 'qualified' },
      { name: 'Prepare personalised outreach', target: 50, unit: 'drafts', source_type: 'business_events', formula: 'drafts' },
      { name: 'Positive responses', target: 12, unit: 'responses', source_type: 'business_events', formula: 'positive_responses' },
      { name: 'Stay within AI/tool budget', target: Math.max(0, num(input.budget_amount, 450)), unit: 'SGD cost ceiling', source_type: 'llmops', formula: 'cost' },
    ],
    initiatives: [
      { name: 'Discover target accounts', owner_label: 'Research Analyst', cadence: 'Weekdays 09:00', prompt: 'Find target accounts matching the approved ICP and retain public evidence.' },
      { name: 'Validate ICP fit', owner_label: 'Lead QA', cadence: 'After discovery', prompt: 'Qualify candidates against the current ICP; unknown stays unknown.' },
      { name: 'Create and verify CRM opportunities', owner_label: 'CRM Maker / Checker', cadence: 'After qualification', prompt: 'Create deduplicated CRM records and verify read-back evidence.' },
      { name: 'Prepare outreach', owner_label: 'Outreach Drafter', cadence: 'After CRM acceptance', prompt: 'Draft evidence-grounded outreach; do not send.' },
      { name: 'Approve and execute outreach', owner_label: 'CEO / Outreach Executor', cadence: 'On approval', prompt: 'Execute only exact approved content and recipients; retain receipts.' },
      { name: 'Monitor responses and update CRM', owner_label: 'Response Monitor', cadence: 'Event driven', prompt: 'Classify inbound responses and update CRM only within policy.' },
    ],
  };
}

export async function ideateObjective(ownerUserId, input = {}, { callModel = chatCompletions } = {}) {
  const fallback = defaultProposal(input);
  if (input.use_llm === false) return { proposal: fallback, model_used: 'deterministic-template', fallback: false };
  try {
    const result = await callModel({ ownerUserId, toolName: 'objective_studio', temperature: 0.2, messages: [
      { role: 'system', content: 'You design bounded company objectives. Return JSON only with name, outcome, assumptions[], constraints[], key_results[] and initiatives[]. Preserve the supplied period exactly. Key results require name,target,unit,source_type,formula,definition and should retain the source_type/formula pairs in the deterministic baseline unless the requested outcome clearly requires a different registered measurement. Initiatives require name,owner_label,cadence,prompt. Never grant external communication authority; it remains approval_required.' },
      { role: 'user', content: JSON.stringify({ request: input.outcome || input.prompt, period: { type: fallback.periodType, label: fallback.periodLabel, starts_on: fallback.startsOn, ends_on: fallback.endsOn }, currency: fallback.currency, budget: fallback.budget_amount, deterministic_baseline: fallback }) },
    ] });
    const raw = String(result?.content || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(raw);
    const registered = measurementRegistry().sources;
    const keyResults = (Array.isArray(parsed.key_results) ? parsed.key_results : fallback.key_results).map((kr) => {
      const knownSource = registered.find((source) => source.id === kr.source_type && source.formulas.some((item) => item.id === kr.formula));
      const source = knownSource || registered.find((candidate) => candidate.formulas.some((item) => item.id === kr.formula)) || registered.find((candidate) => candidate.id === 'manual');
      const selectedFormula = source.formulas.some((item) => item.id === kr.formula) ? kr.formula : source.formulas[0].id;
      return { ...kr, source_type: source.id, formula: selectedFormula, measurement_config: { provider: source.provider, window: 'objective_period', refresh: 'event_driven', provenance: true } };
    });
    return { proposal: { ...fallback, ...parsed, key_results: keyResults, periodType: fallback.periodType, periodLabel: fallback.periodLabel, startsOn: fallback.startsOn, endsOn: fallback.endsOn, authority: fallback.authority, budget_amount: fallback.budget_amount, currency: fallback.currency }, model_used: result?.modelUsed || 'configured-model', fallback: false };
  } catch (error) {
    return { proposal: fallback, model_used: 'deterministic-template', fallback: true, note: text(error.message, 300) };
  }
}

export function objectiveDigest(ownerUserId, { from = null, to = null, limit = 10 } = {}) {
  ensureCompanyObjectiveTables();
  let where = `owner_user_id=? AND status IN ('active','paused')`, args = [ownerUserId];
  if (from) { where += ' AND ends_on>=?'; args.push(from); }
  if (to) { where += ' AND starts_on<=?'; args.push(to); }
  const objectives = db().prepare(`SELECT * FROM company_objectives WHERE ${where} ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,ends_on LIMIT ?`).all(...args, Math.min(50, Math.max(1, num(limit, 10)))).map((r) => serializeObjective(r, true));
  return {
    objectives,
    summary: { active: objectives.filter((o) => o.status === 'active').length, off_track: objectives.filter((o) => ['off_track', 'at_risk'].includes(o.health)).length, blocked: objectives.filter((o) => o.health === 'blocked').length, awaiting_approval: objectives.reduce((s, o) => s + num(o.revenue.awaiting_approval), 0), weighted_pipeline: objectives.reduce((s, o) => s + num(o.revenue.weighted_pipeline), 0), cost: objectives.reduce((s, o) => s + num(o.revenue.cost), 0) },
  };
}

export function bootstrapNorthstarDemo(ownerUserId, actorUserId = null) {
  ensureCompanyObjectiveTables();
  const existing = db().prepare("SELECT id FROM company_objectives WHERE owner_user_id=? AND id LIKE 'obj-demo-northstar-%'").all(ownerUserId);
  if (existing.length) return { created: false, objectives: existing.map((r) => ensureObjectiveOperatingModel(ownerUserId, r.id)) };
  const specs = [
    ['obj-demo-northstar-month-2026-09','Prove the Singapore SME revenue engine','monthly','September 2026','2026-09-01','2026-09-30',25000,100,60,24,12,'active'],
    ['obj-demo-northstar-q4-2026','Generate S$100k qualified pipeline in Singapore','quarterly','Q4 2026','2026-10-01','2026-12-31',100000,450,240,90,50,'draft'],
    ['obj-demo-northstar-h2-2026','Establish a repeatable founder-supervised revenue operation','half_yearly','H2 2026','2026-07-01','2026-12-31',300000,900,360,120,80,'active'],
    ['obj-demo-northstar-fy2027','Make AI-assisted revenue operations dependable','annual','FY2027','2027-01-01','2027-12-31',750000,3600,720,180,240,'draft'],
  ];
  const objectives = specs.map(([objectiveId,name,period_type,period_label,starts_on,ends_on,pipeline,budget,research,qualified,drafts,status]) => createObjective(ownerUserId, { id: objectiveId, name, outcome: `${name}. Target Singapore SMEs in approved industries. Do not send external communications without approval.`, period_type, period_label, starts_on, ends_on, currency: 'SGD', budget_amount: budget, status, authority: { internal_research: 'allowed', reversible_crm_writes: 'allowed', external_communications: 'approval_required' }, constraints: ['Never invent contact data.', 'No external send without exact approval.', 'Do not double-count CRM opportunities across aligned objectives.'], key_results: [
    { name: `Qualified pipeline ${pipeline.toLocaleString('en-SG')} SGD`, target: pipeline, unit: 'SGD', source_type: 'flolah_crm', formula: 'weighted_pipeline' },
    { name: `Research ${research} accounts`, target: research, unit: 'accounts', source_type: 'business_events', formula: 'researched' },
    { name: `Qualify ${qualified} accounts`, target: qualified, unit: 'accounts', source_type: 'business_events', formula: 'qualified' },
    { name: `Prepare ${drafts} outreach drafts`, target: drafts, unit: 'drafts', source_type: 'business_events', formula: 'drafts' },
    { name: `Stay within S$${budget} AI/tool cost`, target: budget, unit: 'SGD cost ceiling', source_type: 'llmops', formula: 'cost' },
  ], initiatives: defaultProposal({ outcome: name, period_type, period_label, starts_on, ends_on, budget_amount: budget }).initiatives }, actorUserId));
  return { created: true, company: { name: 'Northstar Growth Systems Pte. Ltd.', slug: 'demo-northstar-growth', reference_ceo_user_id: 'ceo-demo-northstar' }, objectives };
}

export function listObjectiveVersions(ownerUserId, objectiveId) {
  ensureCompanyObjectiveTables();
  return db().prepare('SELECT id,objective_id,version,reason,actor_user_id,created_at FROM company_objective_versions WHERE owner_user_id=? AND objective_id=? ORDER BY version DESC LIMIT 100').all(ownerUserId, objectiveId);
}
