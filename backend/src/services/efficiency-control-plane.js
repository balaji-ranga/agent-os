/** Efficiency controls never authorize tools or change the main agent/checker routes. */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/schema.js';
import { EFFICIENCY_MODE_TOOLS, getEfficiencyOllamaLlmConfig, getUserEfficiencyMode } from './llm-efficiency-mode.js';

const DEFAULT_POLICY = Object.freeze({ enabled: true, allow_cloud_fallback: true,
  default_model: 'ollama-efficiency', allowed_models: ['ollama-efficiency', 'ollama-reasoning'],
  workloads: [...EFFICIENCY_MODE_TOOLS], max_concurrency: 2, max_queue: 32,
  queue_timeout_ms: 15000, local_timeout_ms: 30000, observer_timeout_ms: 30000, validate_json: true });
const MODEL_IDS = ['ollama-efficiency', 'ollama-reasoning'];
const fail = message => Object.assign(new Error(message), { status: 400 });
const parse = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };

export function ensureEfficiencyControlTables() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS efficiency_control_settings (id TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS efficiency_preferences (owner_user_id TEXT PRIMARY KEY, fallback_mode TEXT NOT NULL DEFAULT 'inherit', model_id TEXT NOT NULL DEFAULT 'inherit', updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS efficiency_calls (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, tool_name TEXT NOT NULL, member_key TEXT,
      session_id TEXT, run_id TEXT, trace_id TEXT, status TEXT NOT NULL, requested_model TEXT,
      actual_model TEXT, endpoint_host TEXT, local INTEGER, fallback_reason TEXT,
      queue_ms INTEGER DEFAULT 0, latency_ms INTEGER DEFAULT 0, input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS efficiency_calls_owner_time ON efficiency_calls(owner_user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS efficiency_evaluations (id TEXT PRIMARY KEY, model_id TEXT NOT NULL, report_json TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
  `);
}

export function getEfficiencyPolicy() {
  ensureEfficiencyControlTables();
  const row = getDb().prepare("SELECT value_json FROM efficiency_control_settings WHERE id='policy'").get();
  const saved=parse(row?.value_json, {});
  // Upgrade the previous 'all utility workloads' policy once. Preserve custom
  // workload restrictions and every model/fallback/capacity preference.
  const migration='observer_workload_v1';
  if(!getDb().prepare('SELECT 1 FROM efficiency_control_settings WHERE id=?').get(migration)){
    getDb().transaction(()=>{
      if(Array.isArray(saved.workloads)&&EFFICIENCY_MODE_TOOLS.filter(t=>!['knowledge_mapping_advice','kanban_task_observer','floassist_source_assessment','floassist_notification_summary'].includes(t)).every(t=>saved.workloads.includes(t))){
        for(const tool of ['knowledge_mapping_advice','kanban_task_observer'])if(!saved.workloads.includes(tool))saved.workloads.push(tool);
        getDb().prepare("UPDATE efficiency_control_settings SET value_json=? WHERE id='policy'").run(JSON.stringify(saved));
      }
      getDb().prepare('INSERT OR IGNORE INTO efficiency_control_settings(id,value_json) VALUES (?,?)').run(migration,'true');
    })();
  }
  const assistanceMigration='floassist_local_assistance_v1';
  if(!getDb().prepare('SELECT 1 FROM efficiency_control_settings WHERE id=?').get(assistanceMigration)){
    getDb().transaction(()=>{
      const added=['floassist_source_assessment','floassist_notification_summary'];
      if(Array.isArray(saved.workloads)&&EFFICIENCY_MODE_TOOLS.filter(t=>!added.includes(t)).every(t=>saved.workloads.includes(t))){
        for(const tool of added)if(!saved.workloads.includes(tool))saved.workloads.push(tool);
        getDb().prepare("UPDATE efficiency_control_settings SET value_json=? WHERE id='policy'").run(JSON.stringify(saved));
      }
      getDb().prepare('INSERT OR IGNORE INTO efficiency_control_settings(id,value_json) VALUES (?,?)').run(assistanceMigration,'true');
    })();
  }
  return { ...DEFAULT_POLICY, ...saved };
}

export function saveEfficiencyPolicy(input) {
  const old = getEfficiencyPolicy();
  for (const key of Object.keys(input)) if (!Object.hasOwn(DEFAULT_POLICY, key)) throw fail(`Unknown efficiency policy field: ${key}`);
  const policy = { ...old, ...input };
  for (const key of ['enabled', 'allow_cloud_fallback', 'validate_json']) if (typeof policy[key] !== 'boolean') throw fail(`${key} must be boolean`);
  // JSON validation is a safety invariant, not a CEO/Admin bypass switch.
  if (!policy.validate_json) throw fail('JSON validation cannot be disabled');
  if (!Array.isArray(policy.allowed_models) || !policy.allowed_models.length || policy.allowed_models.some(id => !MODEL_IDS.includes(id))) throw fail('Only approved local model IDs are supported');
  if (!policy.allowed_models.includes(policy.default_model)) throw fail('Default model must be allowed');
  if (!Array.isArray(policy.workloads) || policy.workloads.some(name => !EFFICIENCY_MODE_TOOLS.includes(name))) throw fail('Protected or unknown workloads cannot join efficiency mode');
  for (const [key, min, max] of [['max_concurrency', 1, 16], ['max_queue', 0, 256], ['queue_timeout_ms', 10, 60000], ['local_timeout_ms', 100, 120000], ['observer_timeout_ms', 100, 120000]]) {
    if (!Number.isInteger(policy[key]) || policy[key] < min || policy[key] > max) throw fail(`${key} must be an integer from ${min} to ${max}`);
  }
  // Changes that widen routes require evidence for the exact configured model.
  if (policy.default_model !== old.default_model) requireApprovedEvaluation(policy.default_model);
  for (const id of policy.allowed_models.filter(id => !old.allowed_models.includes(id))) requireApprovedEvaluation(id);
  getDb().prepare("INSERT INTO efficiency_control_settings(id,value_json) VALUES ('policy',?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,updated_at=datetime('now')").run(JSON.stringify(policy));
  return policy;
}

export function localEfficiencyModel(modelId) {
  if (!MODEL_IDS.includes(modelId)) throw fail('Unknown local model');
  const cfg = getEfficiencyOllamaLlmConfig();
  const url = new URL(cfg.primary.baseUrl);
  if (!['ollama', 'localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) throw fail('Efficiency endpoint must be a private local Ollama service');
  const model = modelId === 'ollama-reasoning'
    ? String(process.env.DEEPSEEK_FALLBACK_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-r1:8b').trim()
    : cfg.primary.model;
  if (!model || /cloud/i.test(model)) throw fail('Cloud model tags are not local efficiency models');
  return { ...cfg.primary, model };
}

export function getEfficiencyPreferences(owner) {
  ensureEfficiencyControlTables();
  const row = getDb().prepare('SELECT fallback_mode,model_id FROM efficiency_preferences WHERE owner_user_id=?').get(owner);
  const policy = getEfficiencyPolicy();
  const preferences = row || { fallback_mode: 'inherit', model_id: 'inherit' };
  return { ...preferences, enabled: getUserEfficiencyMode(owner),
    effective_cloud_fallback: policy.allow_cloud_fallback && preferences.fallback_mode !== 'local_only',
    effective_model: policy.allowed_models.includes(preferences.model_id) ? preferences.model_id : policy.default_model,
    platform_enabled: policy.enabled, allowed_models: policy.allowed_models,
    platform_cloud_fallback: policy.allow_cloud_fallback };
}

export function saveEfficiencyPreferences(owner, input) {
  const allowed = ['fallback_mode', 'model_id'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw fail('Company preferences cannot modify platform policy');
  const old = getEfficiencyPreferences(owner);
  const mode = input.fallback_mode ?? old.fallback_mode;
  const model = input.model_id ?? old.model_id;
  if (!['inherit', 'local_only', 'allow_cloud'].includes(mode)) throw fail('Invalid fallback mode');
  if (model !== 'inherit' && !old.allowed_models.includes(model)) throw fail('Model is not allowed by Admin');
  if (model !== 'inherit' && model !== old.model_id && model !== getEfficiencyPolicy().default_model) requireApprovedEvaluation(model);
  getDb().prepare('INSERT INTO efficiency_preferences(owner_user_id,fallback_mode,model_id) VALUES (?,?,?) ON CONFLICT(owner_user_id) DO UPDATE SET fallback_mode=excluded.fallback_mode,model_id=excluded.model_id,updated_at=datetime(\'now\')').run(owner, mode, model);
  return getEfficiencyPreferences(owner);
}

export function effectiveEfficiencyPlan(owner, tool) {
  if (!owner || !EFFICIENCY_MODE_TOOLS.includes(tool) || !getUserEfficiencyMode(owner)) return null;
  const policy = getEfficiencyPolicy();
  const preferences = getEfficiencyPreferences(owner);
  if (!policy.enabled || !policy.workloads.includes(tool)) {
    if (preferences.fallback_mode === 'local_only') throw fail('Efficiency routing is disabled for this workload; local-only preference prevents hosted processing');
    return null;
  }
  if (preferences.effective_model === 'ollama-reasoning') requireApprovedEvaluation('ollama-reasoning');
  return { policy, endpoint: localEfficiencyModel(preferences.effective_model), modelId: preferences.effective_model,
    allowCloud: preferences.effective_cloud_fallback };
}

export function beginEfficiencyCall(input) {
  ensureEfficiencyControlTables();
  const id = randomUUID();
  getDb().prepare('INSERT INTO efficiency_calls(id,owner_user_id,tool_name,member_key,session_id,run_id,trace_id,status,requested_model) VALUES (?,?,?,?,?,?,?,\'queued\',?)').run(id, input.ownerUserId, input.toolName, input.memberKey || null, input.sessionId || null, input.runId || null, input.traceId || null, input.model || null);
  return id;
}

export function updateEfficiencyCall(id, patch) {
  const allowed = ['status','actual_model','endpoint_host','local','fallback_reason','queue_ms','latency_ms','input_tokens','output_tokens'];
  const keys = Object.keys(patch).filter(key => allowed.includes(key));
  if (!keys.length) return;
  getDb().prepare(`UPDATE efficiency_calls SET ${keys.map(key => `${key}=?`).join(',')},updated_at=datetime('now') WHERE id=?`).run(...keys.map(key => patch[key]), id);
}

export function efficiencyReport(owner = null, { sessionId = null, traceId = null, days = 30 } = {}) {
  ensureEfficiencyControlTables();
  const where = ["created_at >= datetime('now', ?)"];
  const args = [`-${Math.min(90,Math.max(1,Number(days)||30))} days`];
  if (owner) { where.push('owner_user_id=?'); args.push(owner); }
  if (sessionId) { where.push('session_id=?'); args.push(sessionId); }
  if (traceId) { where.push('trace_id=?'); args.push(traceId); }
  // Never return prompts, raw provider errors, secrets or owner IDs.
  const fields = 'id,tool_name,member_key,session_id,run_id,trace_id,status,requested_model,actual_model,endpoint_host,local,fallback_reason,queue_ms,latency_ms,input_tokens,output_tokens,created_at,updated_at';
  const events = getDb().prepare(`SELECT ${fields} FROM efficiency_calls WHERE ${where.join(' AND ')} ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(...args);
  const totals = getDb().prepare(`SELECT COUNT(*) calls,SUM(CASE WHEN status='success' AND local=1 THEN 1 ELSE 0 END) local_successes,SUM(CASE WHEN status='success' AND local=0 THEN 1 ELSE 0 END) hosted_successes,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failures,AVG(CASE WHEN status='success' THEN latency_ms END) average_latency_ms FROM efficiency_calls WHERE ${where.join(' AND ')}`).get(...args);
  return { events, totals, cost_note: 'No savings estimate: local infrastructure, hosted prices and a comparable baseline must be measured separately.' };
}

export function listEfficiencyEvaluations() {
  ensureEfficiencyControlTables();
  return getDb().prepare('SELECT * FROM efficiency_evaluations ORDER BY created_at DESC,rowid DESC LIMIT 20').all().map(row => ({ id: row.id, model_id: row.model_id, approved: !!row.approved, created_at: row.created_at, ...parse(row.report_json,{}) }));
}

export function storeEfficiencyEvaluation(modelId, report) {
  ensureEfficiencyControlTables();
  const id = randomUUID();
  getDb().prepare('INSERT INTO efficiency_evaluations(id,model_id,report_json) VALUES (?,?,?)').run(id, modelId, JSON.stringify(report));
  return { id, model_id: modelId, ...report, approved: false };
}

export function updateEfficiencyEvaluation(id, report) {
  getDb().prepare('UPDATE efficiency_evaluations SET report_json=? WHERE id=? AND approved=0').run(JSON.stringify(report), id);
}

function requireApprovedEvaluation(modelId) {
  const endpoint = localEfficiencyModel(modelId);
  const row = getDb().prepare('SELECT report_json,approved FROM efficiency_evaluations WHERE model_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(modelId);
  const report = parse(row?.report_json, {});
  if (!row?.approved || report.model !== endpoint.model || !report.passed) throw fail('Run and approve a passing evaluation for this exact local model first');
}

export function approveEfficiencyEvaluation(id) {
  ensureEfficiencyControlTables();
  const row = getDb().prepare('SELECT * FROM efficiency_evaluations WHERE id=?').get(id);
  const report = parse(row?.report_json, {});
  if (!row || !report.passed || report.model !== localEfficiencyModel(row.model_id).model) throw fail('Only passing evaluations for the current model may be approved');
  getDb().prepare('UPDATE efficiency_evaluations SET approved=1 WHERE id=?').run(id);
  return { ok: true };
}
