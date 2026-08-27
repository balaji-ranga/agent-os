import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { getCachedLearningsSummary, listFeedback, listKanbanLearningActions, summarizeLearnings } from './agent-feedback.js';
import { shouldUseEfficiencyOllama } from './llm-efficiency-mode.js';

let ready = false;
const ACTIVE_DESTINATIONS = new Set(['agent_playbook', 'working_memory']);
const PROMPT_MAX_RULES = Math.max(1, Math.min(10, Number(process.env.AGENT_LEARNING_PROMPT_MAX_RULES) || 5));
const PROMPT_MAX_CHARS = Math.max(1200, Math.min(12000, Number(process.env.AGENT_LEARNING_PROMPT_MAX_CHARS) || 4800));

function db() { return getDb(); }
function parse(value, fallback = {}) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function id(prefix) { return `${prefix}-${randomUUID().replaceAll('-', '').slice(0, 16)}`; }

export function ensureAgentLearningRolloutTables() {
  if (ready) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS agent_learning_versions (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      review_id TEXT NOT NULL,
      improvement_id TEXT NOT NULL,
      destination TEXT NOT NULL,
      version INTEGER NOT NULL,
      instruction TEXT NOT NULL,
      scope_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      previous_version_id TEXT,
      activated_at TEXT,
      expires_at TEXT,
      rolled_back_at TEXT,
      tombstone_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(owner_user_id, agent_id, improvement_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_learning_versions_active ON agent_learning_versions(owner_user_id, agent_id, status, destination);
    CREATE TABLE IF NOT EXISTS agent_execution_learning_versions (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      execution_type TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      learning_version_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(owner_user_id, execution_type, execution_id, learning_version_id)
    );
    CREATE INDEX IF NOT EXISTS idx_execution_learning_owner ON agent_execution_learning_versions(owner_user_id, execution_type, execution_id);
  `);
  ready = true;
}

function requireOwnedAgent(ownerUserId, agentId) {
  const owned = db().prepare('SELECT 1 FROM user_agents WHERE user_id=? AND agent_id=? AND enabled=1').get(ownerUserId, agentId);
  if (!owned) throw Object.assign(new Error('Agent not found'), { status: 404 });
}

export function activateImprovementLearning({ ownerUserId, improvement }) {
  ensureAgentLearningRolloutTables();
  const agents = parse(improvement.scope_json, []).length ? parse(improvement.scope_json, []) : [improvement.owner_agent_id].filter(Boolean);
  if (!agents.length) throw Object.assign(new Error('At least one owned agent must be selected'), { status: 400 });
  const created = [];
  const status = ACTIVE_DESTINATIONS.has(improvement.destination) ? 'active' : 'draft';
  const tx = db().transaction(() => {
    for (const agentId of agents) {
      requireOwnedAgent(ownerUserId, agentId);
      const previous = db().prepare(`SELECT * FROM agent_learning_versions WHERE owner_user_id=? AND agent_id=? AND improvement_id=? AND status='active' ORDER BY version DESC LIMIT 1`).get(ownerUserId, agentId, improvement.id);
      const version = Number(db().prepare('SELECT MAX(version) version FROM agent_learning_versions WHERE owner_user_id=? AND agent_id=? AND improvement_id=?').get(ownerUserId, agentId, improvement.id)?.version || 0) + 1;
      const learningId = id('learning');
      const scope = { evidence: parse(improvement.evidence_json, []), success_metric: improvement.success_metric || '', validation_test: improvement.validation_test || '' };
      if (status === 'active' && previous) db().prepare("UPDATE agent_learning_versions SET status='superseded',updated_at=datetime('now') WHERE id=? AND owner_user_id=?").run(previous.id, ownerUserId);
      db().prepare(`INSERT INTO agent_learning_versions (id,owner_user_id,agent_id,review_id,improvement_id,destination,version,instruction,scope_json,status,previous_version_id,activated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='active' THEN datetime('now') ELSE NULL END)`).run(learningId, ownerUserId, agentId, improvement.review_id, improvement.id, improvement.destination, version, improvement.proposed_change, JSON.stringify(scope), status, previous?.id || null, status);
      created.push({ id: learningId, agent_id: agentId, version, status, destination: improvement.destination });
    }
  });
  tx();
  return created;
}

export function rollbackImprovementLearning({ ownerUserId, improvementId, userId }) {
  ensureAgentLearningRolloutTables();
  const rows = db().prepare('SELECT * FROM agent_learning_versions WHERE owner_user_id=? AND improvement_id=? AND status IN (\'active\',\'draft\')').all(ownerUserId, improvementId);
  const tx = db().transaction(() => {
    for (const row of rows) {
      db().prepare(`UPDATE agent_learning_versions SET status='rolled_back',rolled_back_at=datetime('now'),tombstone_json=?,updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(JSON.stringify({ rolled_back_by: userId, reason: 'CEO review rollback', previous_version_id: row.previous_version_id }), row.id, ownerUserId);
      if (row.previous_version_id) db().prepare(`UPDATE agent_learning_versions SET status='active',activated_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND owner_user_id=? AND status='superseded'`).run(row.previous_version_id, ownerUserId);
    }
  });
  tx();
  return rows.map((row) => row.id);
}

export function listImprovementLearningVersions(ownerUserId, improvementId) {
  ensureAgentLearningRolloutTables();
  return db().prepare('SELECT * FROM agent_learning_versions WHERE owner_user_id=? AND improvement_id=? ORDER BY agent_id,version DESC').all(ownerUserId, improvementId).map((row) => ({ ...row, scope: parse(row.scope_json), tombstone: parse(row.tombstone_json) }));
}

export function listActiveAgentLearnings({ ownerUserId, agentId, goalRunId = '', sessionId = '' }) {
  ensureAgentLearningRolloutTables(); requireOwnedAgent(ownerUserId, agentId);
  return db().prepare(`SELECT * FROM agent_learning_versions WHERE owner_user_id=? AND agent_id=? AND status='active' AND (expires_at IS NULL OR datetime(expires_at)>datetime('now')) ORDER BY activated_at,version`).all(ownerUserId, agentId).filter((row) => {
    if (row.destination !== 'working_memory') return true;
    const scope = parse(row.scope_json, {}); const evidence = scope.evidence || [];
    return evidence.some((item) => item.id === goalRunId || item.session_id === sessionId);
  }).map((row) => ({ ...row, scope: parse(row.scope_json) }));
}

export function getActiveLearningPrompt(args) {
  const rows = listActiveAgentLearnings(args);
  if (!rows.length) return { text: '', version_ids: [] };
  const topicWords = new Set(String(args?.topic || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  const ranked = rows.map((row) => {
    const words = new Set(String(row.instruction || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []);
    let score = 0; for (const word of topicWords) if (words.has(word)) score += 1;
    return { row, score, time: Date.parse(row.activated_at || row.created_at || '') || 0 };
  }).sort((a, b) => b.score - a.score || b.time - a.time);
  const chosen = []; let chars = 0;
  for (const item of ranked) {
    if (chosen.length >= PROMPT_MAX_RULES) break;
    const rawLine = `- [${item.row.id} v${item.row.version}] ${item.row.instruction}`;
    const line = rawLine.length > PROMPT_MAX_CHARS ? `${rawLine.slice(0, PROMPT_MAX_CHARS - 1)}…` : rawLine;
    if (chosen.length && chars + line.length > PROMPT_MAX_CHARS) continue;
    chosen.push({ ...item.row, line }); chars += line.length;
  }
  return { text: `\n\nGOVERNED ACTIVE LEARNINGS (CEO-approved; apply when relevant):\n${chosen.map((row) => row.line).join('\n')}`, version_ids: chosen.map((row) => row.id), available_count: rows.length, selected_count: chosen.length, bounded_chars: chars };
}

export function getAgentLearningWorkspace({ ownerUserId, agentId }) {
  ensureAgentLearningRolloutTables(); requireOwnedAgent(ownerUserId, agentId);
  const versions = db().prepare(`SELECT v.*, i.title AS improvement_title FROM agent_learning_versions v LEFT JOIN company_review_improvements i ON i.id=v.improvement_id WHERE v.owner_user_id=? AND v.agent_id=? ORDER BY v.created_at DESC`).all(ownerUserId, agentId).map((row) => ({ ...row, scope: parse(row.scope_json), tombstone: parse(row.tombstone_json) }));
  const reviewFeedback = db().prepare(`SELECT f.*, r.cadence, r.period_start, r.period_end FROM company_review_feedback f LEFT JOIN company_reviews r ON r.id=f.review_id WHERE f.owner_user_id=? AND f.agent_id=? ORDER BY f.created_at DESC LIMIT 100`).all(ownerUserId, agentId).map((row) => ({ ...row, scope: parse(row.scope_json, []) }));
  const responseFeedback = listFeedback({ ownerUserId, agentId, days: 365, limit: 100 });
  const kanbanFeedback = listKanbanLearningActions({ ownerUserId, agentId, days: 365, limit: 100 });
  const cached = getCachedLearningsSummary({ ownerUserId, agentId });
  return { owner_user_id: ownerUserId, agent_id: agentId, summary: cached, summary_provider: shouldUseEfficiencyOllama(ownerUserId, 'learnings_summary') ? 'ollama_free' : 'configured_model', prompt_policy: { max_rules: PROMPT_MAX_RULES, max_chars: PROMPT_MAX_CHARS }, active_playbooks: versions.filter((row) => row.status === 'active'), version_history: versions, feedback_history: [...reviewFeedback.map((row) => ({ ...row, source: 'company_review' })), ...responseFeedback, ...kanbanFeedback].sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 200) };
}

export async function regenerateAgentLearningSummary({ ownerUserId, agentId, topic = '' }) {
  requireOwnedAgent(ownerUserId, agentId);
  await summarizeLearnings({ ownerUserId, agentId, topic, days: 365, force: true });
  return getAgentLearningWorkspace({ ownerUserId, agentId });
}

export function removeAgentLearningVersion({ ownerUserId, agentId, versionId, userId = '' }) {
  ensureAgentLearningRolloutTables(); requireOwnedAgent(ownerUserId, agentId);
  const row = db().prepare('SELECT * FROM agent_learning_versions WHERE id=? AND owner_user_id=? AND agent_id=?').get(versionId, ownerUserId, agentId);
  if (!row) throw Object.assign(new Error('Learning version not found'), { status: 404 });
  db().prepare(`UPDATE agent_learning_versions SET status='removed',rolled_back_at=datetime('now'),tombstone_json=?,updated_at=datetime('now') WHERE id=? AND owner_user_id=? AND agent_id=?`).run(JSON.stringify({ removed_by: userId, reason: 'CEO override removal' }), versionId, ownerUserId, agentId);
  return getAgentLearningWorkspace({ ownerUserId, agentId });
}

export function overrideAgentLearningVersion({ ownerUserId, agentId, versionId, instruction, userId = '' }) {
  ensureAgentLearningRolloutTables(); requireOwnedAgent(ownerUserId, agentId);
  const text = String(instruction || '').trim(); if (text.length < 20) throw Object.assign(new Error('Override instruction must be at least 20 characters'), { status: 400 });
  const row = db().prepare('SELECT * FROM agent_learning_versions WHERE id=? AND owner_user_id=? AND agent_id=?').get(versionId, ownerUserId, agentId);
  if (!row) throw Object.assign(new Error('Learning version not found'), { status: 404 });
  const version = Number(db().prepare('SELECT MAX(version) version FROM agent_learning_versions WHERE owner_user_id=? AND agent_id=? AND improvement_id=?').get(ownerUserId, agentId, row.improvement_id)?.version || 0) + 1;
  const newId = id('learning'); const scope = { ...parse(row.scope_json), overridden_by: userId, overridden_version_id: row.id };
  const tx = db().transaction(() => { db().prepare("UPDATE agent_learning_versions SET status='superseded',updated_at=datetime('now') WHERE id=? AND owner_user_id=?").run(row.id, ownerUserId); db().prepare(`INSERT INTO agent_learning_versions (id,owner_user_id,agent_id,review_id,improvement_id,destination,version,instruction,scope_json,status,previous_version_id,activated_at) VALUES (?,?,?,?,?,?,?,?,?,'active',?,datetime('now'))`).run(newId, ownerUserId, agentId, row.review_id, row.improvement_id, row.destination, version, text, JSON.stringify(scope), row.id); }); tx();
  return getAgentLearningWorkspace({ ownerUserId, agentId });
}

export function recordExecutionLearningVersions({ ownerUserId, agentId, executionType, executionId, sessionId = '', learningVersionIds = [] }) {
  ensureAgentLearningRolloutTables(); requireOwnedAgent(ownerUserId, agentId);
  const stmt = db().prepare('INSERT OR IGNORE INTO agent_execution_learning_versions (id,owner_user_id,agent_id,execution_type,execution_id,session_id,learning_version_id) VALUES (?,?,?,?,?,?,?)');
  for (const versionId of learningVersionIds) stmt.run(id('learning-use'), ownerUserId, agentId, executionType, executionId, sessionId, versionId);
}
