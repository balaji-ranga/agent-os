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
const FORMULA_EXPRESSIONS = {
  count: 'count(record_id)', sum: 'sum(value)', average: 'avg(value)', latest_value: 'latest(value, occurred_at)', change: 'latest(value) - baseline_value', percentage: '100 * matching_count / eligible_count', completion_rate: '100 * completed_count / eligible_count', success_rate: '100 * successful_count / completed_count', cycle_time: 'avg(completed_at - started_at)', error_rate: '100 * failed_count / completed_count', weighted_pipeline: 'sum(opportunity.amount * opportunity.probability)', pipeline_value: 'sum(opportunity.amount)', conversion_rate: '100 * converted_count / eligible_count', revenue: 'sum(posted_revenue)', expenses: 'sum(posted_expense)', gross_margin: '100 * (revenue - direct_cost) / revenue', invoice_count: 'count(invoice_id)', collection_rate: '100 * paid_value / due_value', researched: 'researched_count', qualified: 'qualified_count', drafts: 'draft_count', positive_responses: 'positive_response_count', evidence_count: 'count(evidence_id)', overdue_count: 'overdue_count', document_count: 'count(document_id)', indexed_count: 'indexed_count', activity_count: 'count(activity_id)', sent_count: 'sent_count', reply_count: 'reply_count', approval_queue: 'pending_approval_count', cost: 'sum(cost)', tokens: 'sum(input_tokens + output_tokens)', latency: 'avg(duration_ms)', freshness: 'now() - max(evidence_at)', positive_response_rate: '100 * positive_reply_count / classified_reply_count', retrieval_success_rate: '100 * sufficient_evidence_queries / all_queries',
};
const formula = (id, label = null, description = null, expression = null) => { const common = COMMON_FORMULAS[id]; return { id, label: label || common?.[1] || id, expression: expression || FORMULA_EXPRESSIONS[id] || id, description: description || common?.[2] || '' }; };

const attribute = (id, label, dataType, description) => ({ id, label, data_type: dataType, description });
const SOURCE_ATTRIBUTES = {
  flolah_crm: [attribute('record_id','Record ID','string','Stable CRM record identifier'),attribute('opportunity.amount','Opportunity amount','currency','Opportunity amount in company currency'),attribute('opportunity.probability','Opportunity probability','decimal','Probability from 0 to 1'),attribute('converted_count','Converted records','integer','Records converted in the objective window'),attribute('eligible_count','Eligible records','integer','Records eligible for conversion'),attribute('started_at','Started at','datetime','Lifecycle start time'),attribute('completed_at','Completed at','datetime','Lifecycle completion time')],
  flolah_erp: [attribute('invoice_id','Invoice ID','string','Posted invoice identifier'),attribute('posted_revenue','Posted revenue','currency','Recognised posted revenue'),attribute('posted_expense','Posted expense','currency','Posted expense amount'),attribute('revenue','Revenue','currency','Revenue used for margin calculation'),attribute('direct_cost','Direct cost','currency','Direct cost used for margin calculation'),attribute('paid_value','Paid value','currency','Value collected'),attribute('due_value','Due value','currency','Value due'),attribute('value','Numeric value','number','Configured ERP numeric measure')],
  business_events: [attribute('researched_count','Researched count','integer','Unique researched accounts'),attribute('qualified_count','Qualified count','integer','Evidence-qualified accounts'),attribute('draft_count','Draft count','integer','Evidence-backed draft artifacts'),attribute('positive_response_count','Positive response count','integer','Positively classified responses'),attribute('opportunity.amount','Opportunity amount','currency','Accepted opportunity amount'),attribute('opportunity.probability','Opportunity probability','decimal','Accepted probability from 0 to 1'),attribute('cost','Recorded cost','currency','Evidence-linked cost')],
  goal_plans: [attribute('record_id','Goal Plan ID','string','Goal Plan run identifier'),attribute('completed_count','Completed runs','integer','Completed eligible runs'),attribute('eligible_count','Eligible runs','integer','Runs in the measurement window'),attribute('successful_count','Successful runs','integer','Successfully completed runs'),attribute('started_at','Started at','datetime','Run start'),attribute('completed_at','Completed at','datetime','Run completion'),attribute('evidence_id','Evidence ID','string','Durable evidence identifier')],
  workflows: [attribute('record_id','Workflow run ID','string','Workflow run identifier'),attribute('completed_count','Completed runs','integer','Completed workflow runs'),attribute('eligible_count','Eligible runs','integer','Eligible workflow runs'),attribute('successful_count','Successful runs','integer','Successful workflow runs'),attribute('failed_count','Failed runs','integer','Failed workflow runs'),attribute('started_at','Started at','datetime','Run start'),attribute('completed_at','Completed at','datetime','Run completion')],
  tasks: [attribute('record_id','Task ID','string','Task identifier'),attribute('completed_count','Completed tasks','integer','Completed tasks'),attribute('eligible_count','Eligible tasks','integer','Eligible tasks'),attribute('overdue_count','Overdue tasks','integer','Unfinished tasks past due'),attribute('started_at','Started at','datetime','Task start'),attribute('completed_at','Completed at','datetime','Task completion')],
  knowledge: [attribute('document_id','Document ID','string','Owner-scoped document identifier'),attribute('indexed_count','Indexed documents','integer','Documents available to retrieval'),attribute('sufficient_evidence_queries','Supported queries','integer','Queries with sufficient evidence'),attribute('all_queries','All queries','integer','All evaluated retrieval queries'),attribute('evidence_at','Evidence timestamp','datetime','Evidence creation or refresh time')],
  agents: [attribute('activity_id','Activity ID','string','Agent activity identifier'),attribute('successful_count','Successful activities','integer','Successful completed activities'),attribute('completed_count','Completed activities','integer','Completed activities'),attribute('failed_count','Failed activities','integer','Failed activities'),attribute('started_at','Started at','datetime','Activity start'),attribute('completed_at','Completed at','datetime','Activity completion')],
  communications: [attribute('sent_count','Sent count','integer','Receipt-backed sends'),attribute('reply_count','Reply count','integer','Correlated replies'),attribute('positive_reply_count','Positive replies','integer','Positively classified replies'),attribute('classified_reply_count','Classified replies','integer','All classified replies'),attribute('pending_approval_count','Pending approvals','integer','External actions awaiting approval')],
  llmops: [attribute('cost','Cost','currency','Model and tool cost'),attribute('input_tokens','Input tokens','integer','Input token usage'),attribute('output_tokens','Output tokens','integer','Output token usage'),attribute('failed_count','Failed calls','integer','Failed completed calls'),attribute('completed_count','Completed calls','integer','Completed calls'),attribute('duration_ms','Duration','duration_ms','Execution duration in milliseconds')],
  events: [attribute('record_id','Event ID','string','Registered event identifier'),attribute('value','Value','number','Configured numeric event value'),attribute('occurred_at','Occurred at','datetime','Event occurrence time'),attribute('baseline_value','Baseline value','number','Value at the measurement baseline'),attribute('matching_count','Matching count','integer','Events matching configured filters'),attribute('eligible_count','Eligible count','integer','Eligible events')],
  custom_api: [attribute('record_id','Record ID','string','Adapter-provided record identifier'),attribute('value','Value','number','Adapter-provided numeric value'),attribute('occurred_at','Occurred at','datetime','Adapter-provided occurrence time'),attribute('baseline_value','Baseline value','number','Adapter-provided baseline'),attribute('matching_count','Matching count','integer','Records matching adapter filters'),attribute('eligible_count','Eligible count','integer','Eligible adapter records')],
  documents: [attribute('document_id','Document ID','string','Evidence document identifier'),attribute('record_id','Record ID','string','Evidence record identifier'),attribute('value','Extracted value','number','Validated value extracted from evidence'),attribute('occurred_at','Evidence time','datetime','Evidence timestamp'),attribute('matching_count','Matching count','integer','Matching evidence records'),attribute('eligible_count','Eligible count','integer','Eligible evidence records')],
  manual: [attribute('record_id','Attestation ID','string','Human attestation identifier'),attribute('value','Attested value','number','Human-attested numeric value'),attribute('occurred_at','Attested at','datetime','Attestation time'),attribute('baseline_value','Baseline value','number','Attested baseline'),attribute('matching_count','Matching count','integer','Matching attestations'),attribute('eligible_count','Eligible count','integer','Eligible attestations')],
};
const ALLOWED_FORMULA_FUNCTIONS = new Set(['sum','avg','count','latest','min','max','now']);
export function validateFormulaExpression(source, expression) {
  const formulaText = text(expression, 1000);
  if (!formulaText) return { valid: false, unknown_attributes: [], unsupported_functions: [], error: 'Formula expression is required' };
  const scrubbed = formulaText.replace(/(['"]).*?\1/g, '');
  const functionNames = [...scrubbed.matchAll(/\b([A-Za-z_][\w]*)\s*\(/g)].map((match) => match[1]);
  const unsupportedFunctions = [...new Set(functionNames.filter((name) => !ALLOWED_FORMULA_FUNCTIONS.has(name)))];
  const attributes = new Set((source?.attributes || []).map((item) => item.id));
  const tokens = [...scrubbed.matchAll(/\b[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*\b/g)].map((match) => match[0]);
  const ignored = new Set([...functionNames, 'true', 'false', 'null']);
  const unknownAttributes = [...new Set(tokens.filter((token) => !ignored.has(token) && !attributes.has(token)))];
  return { valid: !unsupportedFunctions.length && !unknownAttributes.length, unknown_attributes: unknownAttributes, unsupported_functions: unsupportedFunctions, error: unsupportedFunctions.length || unknownAttributes.length ? 'Formula references unsupported functions or attributes' : null };
}

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
  for (const source of sources) {
    source.attributes = SOURCE_ATTRIBUTES[source.id] || [];
    source.formulas = source.formulas.map((item) => ({ ...item, validation: validateFormulaExpression(source, item.expression) }));
    const invalid = source.formulas.find((item) => !item.validation.valid);
    if (invalid) throw new Error(`Invalid platform formula ${source.id}.${invalid.id}: ${invalid.validation.unknown_attributes.join(', ') || invalid.validation.unsupported_functions.join(', ')}`);
  }
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
  const overrides = safeAll('SELECT * FROM company_measurement_registry WHERE owner_user_id=? ORDER BY kind,label', ownerUserId);
  const customSources = overrides.filter((row) => row.kind === 'source').map((row) => { const attributes = overrides.filter((attributeRow) => attributeRow.kind === 'attribute' && attributeRow.source_id === row.id && attributeRow.enabled).map((attributeRow) => attribute(attributeRow.id, attributeRow.label, attributeRow.data_type || 'number', attributeRow.description)); return { id: row.id, label: row.label, category: row.category || 'Company configured', provider: row.provider || 'Company configured', availability: row.enabled ? 'available' : 'disabled', attributes, formulas: overrides.filter((formulaRow) => formulaRow.kind === 'formula' && formulaRow.source_id === row.id && formulaRow.enabled).map((formulaRow) => { const item = { ...formula(formulaRow.id, formulaRow.label, formulaRow.description, formulaRow.expression), company_managed: true }; return { ...item, validation: validateFormulaExpression({ attributes }, item.expression) }; }), instances: row.enabled ? [{ id: `${row.id}:company`, label: row.label }] : [], company_managed: true }; });
  const sourceOverrides = new Map(overrides.filter((row) => row.kind === 'source_override').map((row) => [row.source_id, row]));
  return { version: 1, scope: 'company', owner_user_id: ownerUserId, sources: [...sources.map((source) => {
    const bound = instances[source.id] || [];
    const nativeWithoutBinding = ['goal_plans','tasks','knowledge','llmops','documents','business_events','manual'].includes(source.id);
    const override = sourceOverrides.get(source.id);
    const companyAttributes = overrides.filter((row) => row.kind === 'attribute' && row.source_id === source.id && row.enabled).map((row) => ({ ...attribute(row.id, row.label, row.data_type || 'number', row.description), company_managed: true }));
    const attributes = [...source.attributes, ...companyAttributes];
    const companyFormulas = overrides.filter((row) => row.kind === 'formula' && row.source_id === source.id && row.enabled).map((row) => { const item = { ...formula(row.id, row.label, row.description, row.expression), company_managed: true }; return { ...item, validation: validateFormulaExpression({ attributes }, item.expression) }; });
    return { ...source, label: override?.label || source.label, attributes, formulas: [...source.formulas, ...companyFormulas], enabled: override ? Boolean(override.enabled) : true, instances: bound, availability: override && !override.enabled ? 'disabled' : bound.length || nativeWithoutBinding ? 'available' : 'configuration_required', system_managed: true };
  }), ...customSources] };
}

export function upsertMeasurementRegistryEntry(ownerUserId, input = {}) {
  ensureCompanyObjectiveTables();
  const kind = ['formula','attribute','source_override'].includes(input.kind) ? input.kind : 'source';
  const entryId = text(input.id, 120) || id(kind === 'formula' ? 'formula' : 'source');
  if (!/^[a-zA-Z0-9:_-]+$/.test(entryId)) throw Object.assign(new Error('Registry id may contain only letters, numbers, colon, underscore and dash'), { status: 400 });
  const label = text(input.label, 160);
  if (!label) throw Object.assign(new Error('Registry label is required'), { status: 400 });
  const sourceId = text(input.source_id, 120);
  if (['formula','attribute'].includes(kind) && !sourceId) throw Object.assign(new Error(`${kind === 'formula' ? 'Formula' : 'Attribute'} source is required`), { status: 400 });
  if (kind === 'formula') {
    const source = measurementRegistry(ownerUserId).sources.find((item) => item.id === sourceId);
    if (!source) throw Object.assign(new Error('Formula source is not registered'), { status: 400 });
    const validation = validateFormulaExpression(source, input.expression);
    if (!validation.valid) throw Object.assign(new Error(`Unsupported formula reference: ${[...validation.unknown_attributes, ...validation.unsupported_functions].join(', ') || validation.error}`), { status: 400 });
  }
  db().prepare(`INSERT INTO company_measurement_registry(id,owner_user_id,kind,source_id,label,category,provider,data_type,expression,description,enabled,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(owner_user_id,kind,id) DO UPDATE SET source_id=excluded.source_id,label=excluded.label,category=excluded.category,provider=excluded.provider,data_type=excluded.data_type,expression=excluded.expression,description=excluded.description,enabled=excluded.enabled,updated_at=datetime('now')`).run(entryId, ownerUserId, kind, sourceId || null, label, text(input.category, 120), text(input.provider, 200), text(input.data_type, 40), text(input.expression, 1000), text(input.description, 1000), input.enabled === false ? 0 : 1);
  return measurementRegistry(ownerUserId);
}

export function deleteMeasurementRegistryEntry(ownerUserId, kind, entryId) {
  ensureCompanyObjectiveTables();
  const safeKind = ['formula','attribute','source_override'].includes(kind) ? kind : 'source';
  db().prepare('DELETE FROM company_measurement_registry WHERE owner_user_id=? AND kind=? AND id=?').run(ownerUserId, safeKind, text(entryId, 120));
  if (safeKind === 'source') db().prepare("DELETE FROM company_measurement_registry WHERE owner_user_id=? AND kind IN ('formula','attribute') AND source_id=?").run(ownerUserId, text(entryId, 120));
  return measurementRegistry(ownerUserId);
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
    CREATE TABLE IF NOT EXISTS company_measurement_registry (
      id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_id TEXT,
      label TEXT NOT NULL,
      category TEXT DEFAULT '',
      provider TEXT DEFAULT '',
      data_type TEXT DEFAULT '',
      expression TEXT DEFAULT '',
      description TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY(owner_user_id,kind,id)
    );
    CREATE TABLE IF NOT EXISTS company_initiative_scheduled_goals (
      initiative_id TEXT NOT NULL,
      objective_id TEXT NOT NULL,
      initiative_goal_id TEXT,
      scheduled_goal_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY(initiative_id, scheduled_goal_id)
    );
    CREATE TABLE IF NOT EXISTS company_initiative_goals (
      id TEXT PRIMARY KEY,
      initiative_id TEXT NOT NULL,
      objective_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      goal_type TEXT NOT NULL DEFAULT 'scheduled',
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      owner_label TEXT DEFAULT 'COO',
      agent_id TEXT,
      cadence TEXT DEFAULT '',
      weekday INTEGER,
      time_local TEXT DEFAULT '09:00',
      timezone TEXT DEFAULT 'Asia/Singapore',
      linked_key_result_ids_json TEXT DEFAULT '[]',
      authority_json TEXT DEFAULT '{}',
      approval_required INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      ordinal INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_company_initiative_goals_initiative
      ON company_initiative_goals(initiative_id, owner_user_id, ordinal);
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
  const initiativeColumns = db().prepare('PRAGMA table_info(company_initiatives)').all().map((column) => column.name);
  const initiativeAdditions = [['schedule_enabled','INTEGER DEFAULT 0'],['scheduled_goal_title',"TEXT DEFAULT ''"],['scheduled_goal_prompt',"TEXT DEFAULT ''"],['scheduled_goal_cadence',"TEXT DEFAULT ''"],['scheduled_goal_time_local',"TEXT DEFAULT '09:00'"],['scheduled_goal_timezone',"TEXT DEFAULT 'Asia/Singapore'"]];
  for (const [column,type] of initiativeAdditions) if (!initiativeColumns.includes(column)) db().exec(`ALTER TABLE company_initiatives ADD COLUMN ${column} ${type}`);
  const mappingColumns = db().prepare('PRAGMA table_info(company_initiative_scheduled_goals)').all().map((column) => column.name);
  if (!mappingColumns.includes('initiative_goal_id')) db().exec('ALTER TABLE company_initiative_scheduled_goals ADD COLUMN initiative_goal_id TEXT');
  const registryColumns = db().prepare('PRAGMA table_info(company_measurement_registry)').all().map((column) => column.name);
  if (!registryColumns.includes('expression')) db().exec("ALTER TABLE company_measurement_registry ADD COLUMN expression TEXT DEFAULT ''");
  if (!registryColumns.includes('data_type')) db().exec("ALTER TABLE company_measurement_registry ADD COLUMN data_type TEXT DEFAULT ''");
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
      let goals = db().prepare(`SELECT * FROM company_initiative_goals WHERE initiative_id=? AND owner_user_id=? AND enabled=1 ORDER BY ordinal,id`).all(initiative.id, ownerUserId);
      if (!goals.length && (initiative.schedule_enabled || scheduleSpec(initiative.cadence))) {
        const legacyGoalId = `ig-${createHash('sha256').update(`${ownerUserId}:${initiative.id}:legacy`).digest('hex').slice(0, 24)}`;
        db().prepare(`INSERT OR IGNORE INTO company_initiative_goals(id,initiative_id,objective_id,owner_user_id,goal_type,title,prompt,owner_label,cadence,time_local,timezone,enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`).run(legacyGoalId, initiative.id, objectiveId, ownerUserId, 'scheduled', initiative.scheduled_goal_title || initiative.name, initiative.scheduled_goal_prompt || initiative.prompt, initiative.owner_label, initiative.scheduled_goal_cadence || scheduleSpec(initiative.cadence)?.cadence || 'weekdays', initiative.scheduled_goal_time_local || scheduleSpec(initiative.cadence)?.time_local || '09:00', initiative.scheduled_goal_timezone || 'Asia/Singapore');
        goals = db().prepare(`SELECT * FROM company_initiative_goals WHERE initiative_id=? AND owner_user_id=? AND enabled=1 ORDER BY ordinal,id`).all(initiative.id, ownerUserId);
      }
      for (const goal of goals.filter((item) => item.goal_type === 'scheduled')) {
      const spec = scheduleSpec(`${goal.cadence} ${goal.time_local}`);
      if (!spec) continue;
      const scheduleId = `sg-obj-${createHash('sha256').update(`${ownerUserId}:${goal.id}`).digest('hex').slice(0, 24)}`;
      db().prepare(`INSERT INTO scheduled_goals(id,owner_user_id,title,prompt,agent_id,cadence,weekday,time_local,timezone,ends_at,status,source,plan_status,deliver_to)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,prompt=excluded.prompt,cadence=excluded.cadence,weekday=excluded.weekday,time_local=excluded.time_local,ends_at=excluded.ends_at,status=excluded.status,updated_at=datetime('now')`).run(
        scheduleId, ownerUserId, goal.title, goal.prompt, goal.agent_id || agentId, spec.cadence, goal.weekday ?? spec.weekday ?? null, goal.time_local || spec.time_local, goal.timezone || 'Asia/Singapore', `${objective.ends_on}T23:59:59.000Z`, scheduleStatus, 'company_objective', 'none', '["web"]'
      );
      db().prepare(`INSERT INTO company_initiative_scheduled_goals(initiative_id,objective_id,initiative_goal_id,scheduled_goal_id,owner_user_id) VALUES(?,?,?,?,?) ON CONFLICT(initiative_id,scheduled_goal_id) DO UPDATE SET initiative_goal_id=excluded.initiative_goal_id`).run(initiative.id, objectiveId, goal.id, scheduleId, ownerUserId);
      }
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
    const goals = db().prepare(`SELECT * FROM company_initiative_goals WHERE initiative_id=? AND owner_user_id=? ORDER BY ordinal,id`).all(i.id, row.owner_user_id).map((goal) => ({ ...goal, enabled: Boolean(goal.enabled), approval_required: Boolean(goal.approval_required), linked_key_result_ids: json(goal.linked_key_result_ids_json, []), authority: json(goal.authority_json, {}), linked_key_result_ids_json: undefined, authority_json: undefined }));
    const schedules = db().prepare(`SELECT m.initiative_goal_id,sg.* FROM company_initiative_scheduled_goals m JOIN scheduled_goals sg ON sg.id=m.scheduled_goal_id AND sg.owner_user_id=m.owner_user_id WHERE m.initiative_id=? AND m.owner_user_id=? ORDER BY sg.created_at`).all(i.id, row.owner_user_id).map((sg) => ({
      ...sg,
      goal_plan_runs: db().prepare(`SELECT id AS goal_run_id,title,status,created_at,completed_at FROM agent_goal_runs WHERE owner_user_id=? AND scheduled_goal_id=? ORDER BY created_at DESC LIMIT 20`).all(row.owner_user_id, sg.id),
    }));
    const adhocGoalPlans = db().prepare(`SELECT l.goal_run_id,g.title,g.status,g.created_at,g.completed_at FROM company_objective_goal_runs l JOIN agent_goal_runs g ON g.id=l.goal_run_id AND g.owner_user_id=l.owner_user_id WHERE l.objective_id=? AND l.initiative_id=? AND l.owner_user_id=? AND g.scheduled_goal_id IS NULL ORDER BY g.created_at DESC LIMIT 20`).all(row.id, i.id, row.owner_user_id);
    return { ...i, schedule_enabled: Boolean(i.schedule_enabled), goals, authority: json(i.authority_json, {}), budget_amount: num(i.budget_amount), scheduled_goals: schedules, adhoc_goal_plans: adhocGoalPlans };
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
  db().prepare(`UPDATE scheduled_goals SET status='deleted',updated_at=datetime('now') WHERE owner_user_id=? AND id IN (SELECT scheduled_goal_id FROM company_initiative_scheduled_goals WHERE objective_id=? AND owner_user_id=?)`).run(ownerUserId, objectiveId, ownerUserId);
  db().prepare('DELETE FROM company_initiative_scheduled_goals WHERE objective_id=? AND owner_user_id=?').run(objectiveId, ownerUserId);
  db().prepare('DELETE FROM company_initiative_goals WHERE objective_id=? AND owner_user_id=?').run(objectiveId, ownerUserId);
  db().prepare('DELETE FROM company_key_results WHERE objective_id=? AND owner_user_id=?').run(objectiveId, ownerUserId);
  db().prepare('DELETE FROM company_initiatives WHERE objective_id=? AND owner_user_id=?').run(objectiveId, ownerUserId);
  const insKr = db().prepare(`INSERT INTO company_key_results(id,objective_id,owner_user_id,name,definition,baseline,target,current_value,unit,source_type,formula,confidence,owner_label,ordinal,measurement_config_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  (keyResults || []).forEach((k, index) => insKr.run(k.id || id('kr'), objectiveId, ownerUserId, text(k.name, 220) || `Key result ${index + 1}`, text(k.definition, 1000), num(k.baseline), num(k.target, 1), num(k.current_value), text(k.unit, 40) || 'count', text(k.source_type, 60) || 'manual', text(k.formula, 1000), text(k.confidence, 20) || 'medium', text(k.owner_label, 120) || 'COO', index, JSON.stringify(k.measurement_config || { window: 'objective_period', refresh: 'event_driven', provenance: true })));
  const insI = db().prepare(`INSERT INTO company_initiatives(id,objective_id,owner_user_id,name,owner_label,cadence,authority_json,budget_amount,status,prompt,next_run_at,ordinal,schedule_enabled,scheduled_goal_title,scheduled_goal_prompt,scheduled_goal_cadence,scheduled_goal_time_local,scheduled_goal_timezone) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insGoal = db().prepare(`INSERT INTO company_initiative_goals(id,initiative_id,objective_id,owner_user_id,goal_type,title,prompt,owner_label,agent_id,cadence,weekday,time_local,timezone,linked_key_result_ids_json,authority_json,approval_required,enabled,ordinal) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  (initiatives || []).forEach((i, index) => { const initiativeId = i.id || id('init'), legacy = i.scheduled_goal || i.scheduled_goal_definition || {}; insI.run(initiativeId, objectiveId, ownerUserId, text(i.name, 220) || `Initiative ${index + 1}`, text(i.owner_label, 120) || 'COO', text(i.cadence, 120), JSON.stringify(i.authority || {}), Math.max(0, num(i.budget_amount)), initiativeState(objectiveStatus), text(i.prompt, 3000), i.next_run_at || null, index, 0, '', '', '', '09:00', 'Asia/Singapore'); const goals = Array.isArray(i.goals) ? i.goals : legacy.enabled ? [{ ...legacy, goal_type: 'scheduled' }] : []; goals.forEach((goal, goalIndex) => insGoal.run(goal.id || id('ig'), initiativeId, objectiveId, ownerUserId, goal.goal_type === 'adhoc' ? 'adhoc' : 'scheduled', text(goal.title, 220) || `${i.name} goal`, text(goal.prompt, 3000) || text(i.prompt, 3000), text(goal.owner_label, 120) || text(i.owner_label, 120) || 'COO', text(goal.agent_id, 160) || null, text(goal.cadence, 30), Number.isInteger(goal.weekday) ? goal.weekday : null, text(goal.time_local, 5) || '09:00', text(goal.timezone, 80) || 'Asia/Singapore', JSON.stringify(Array.isArray(goal.linked_key_result_ids) ? goal.linked_key_result_ids : []), JSON.stringify(goal.authority || {}), goal.approval_required ? 1 : 0, goal.enabled === false ? 0 : 1, goalIndex)); });
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
  const identify = (proposal) => ({ ...proposal, key_results: (proposal.key_results || []).map((kr) => ({ ...kr, id: kr.id || id('kr') })), initiatives: (proposal.initiatives || []).map((initiative) => ({ ...initiative, id: initiative.id || id('init'), goals: Array.isArray(initiative.goals) ? initiative.goals.map((goal) => ({ ...goal, id: goal.id || id('ig') })) : [] })) });
  if (input.use_llm === false) return { proposal: identify(fallback), model_used: 'deterministic-template', fallback: false };
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
    return { proposal: identify({ ...fallback, ...parsed, key_results: keyResults, periodType: fallback.periodType, periodLabel: fallback.periodLabel, startsOn: fallback.startsOn, endsOn: fallback.endsOn, authority: fallback.authority, budget_amount: fallback.budget_amount, currency: fallback.currency }), model_used: result?.modelUsed || 'configured-model', fallback: false };
  } catch (error) {
    return { proposal: identify(fallback), model_used: 'deterministic-template', fallback: true, note: text(error.message, 300) };
  }
}

export async function ideateInitiativeGoals(ownerUserId, input = {}, { callModel = chatCompletions } = {}) {
  ensureCompanyObjectiveTables();
  const objective = input.objective || {}, initiative = input.initiative || {}, keyResults = Array.isArray(input.key_results) ? input.key_results : [];
  if (!text(objective.outcome, 4000) || !text(initiative.name, 220)) throw Object.assign(new Error('Objective outcome and initiative are required'), { status: 400 });
  const preferred = input.preferences || {};
  const linkedIds = keyResults.map((kr) => kr.id).filter(Boolean);
  const fallback = [
    { id: id('ig'), goal_type: 'scheduled', title: `${initiative.name} operating cycle`, prompt: `${initiative.prompt || initiative.name}. Produce durable evidence, update only authorised systems, report measurable outcomes against the linked Key Results, and surface exceptions without inventing facts.`, owner_label: initiative.owner_label || 'COO', cadence: preferred.cadence || 'weekdays', time_local: preferred.time_local || '09:00', timezone: preferred.timezone || 'Asia/Singapore', linked_key_result_ids: linkedIds, approval_required: false, enabled: true },
    { id: id('ig'), goal_type: 'adhoc', title: `${initiative.name} one-off sprint`, prompt: `Execute a bounded one-off request within ${initiative.name}. Confirm scope, retain source evidence, update the linked Key Results only from authoritative records, and return unresolved exceptions to the accountable owner.`, owner_label: initiative.owner_label || 'COO', cadence: '', time_local: '', timezone: preferred.timezone || 'Asia/Singapore', linked_key_result_ids: linkedIds, approval_required: false, enabled: true },
  ];
  if (input.use_llm === false) return { goals: fallback, model_used: 'deterministic-template', fallback: false };
  const availableAgents = measurementRegistry(ownerUserId).sources.find((source) => source.id === 'agents')?.instances || [];
  try {
    const result = await callModel({ ownerUserId, toolName: 'objective_goal_designer', temperature: 0.15, messages: [
      { role: 'system', content: 'Design 1-4 executable goals for one initiative. Return a JSON array only. Each item requires goal_type scheduled|adhoc, title, prompt, owner_label, cadence daily|weekdays|weekly or empty for adhoc, time_local HH:MM, timezone, linked_key_result_ids[], approval_required, enabled. A goal is an executable outcome, not an individual workflow step. Use scheduled only for stable recurring work; use adhoc for bounded one-off work. Prompts must state done criteria, evidence/provenance, target KR links, allowed writes, approval gates, and exception behavior. Avoid duplicate goals and never widen objective/company authority.' },
      { role: 'user', content: JSON.stringify({ objective: { name: objective.name, outcome: objective.outcome, period: objective.period_label, starts_on: objective.starts_on, ends_on: objective.ends_on, budget_amount: objective.budget_amount, authority: objective.authority, constraints: objective.constraints }, initiative, key_results: keyResults.map((kr) => ({ id: kr.id, name: kr.name, target: kr.target, unit: kr.unit, source_type: kr.source_type, formula: kr.formula })), existing_goals: initiative.goals || [], available_agents: availableAgents, preferences: preferred }) },
    ] });
    const raw = String(result?.content || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) throw new Error('Goal designer returned no goals');
    const goals = parsed.slice(0, 4).map((goal) => ({ id: id('ig'), goal_type: goal.goal_type === 'adhoc' ? 'adhoc' : 'scheduled', title: text(goal.title, 220), prompt: text(goal.prompt, 3000), owner_label: text(goal.owner_label, 120) || initiative.owner_label || 'COO', agent_id: availableAgents.some((agent) => agent.id === goal.agent_id) ? goal.agent_id : null, cadence: ['daily','weekdays','weekly'].includes(goal.cadence) ? goal.cadence : goal.goal_type === 'adhoc' ? '' : preferred.cadence || 'weekdays', time_local: /^\d{2}:\d{2}$/.test(goal.time_local || '') ? goal.time_local : preferred.time_local || '09:00', timezone: text(goal.timezone, 80) || preferred.timezone || 'Asia/Singapore', linked_key_result_ids: (Array.isArray(goal.linked_key_result_ids) ? goal.linked_key_result_ids : []).filter((krId) => linkedIds.includes(krId)), approval_required: Boolean(goal.approval_required), enabled: goal.enabled !== false }));
    return { goals, model_used: result?.modelUsed || 'configured-model', fallback: false };
  } catch (error) {
    return { goals: fallback, model_used: 'deterministic-template', fallback: true, note: text(error.message, 300) };
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
