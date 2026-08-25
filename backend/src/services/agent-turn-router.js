/**
 * Semantic chat-turn routing shared by every Dashboard agent.
 * The model selects an explicit work unit and execution mode from meaning; the
 * platform then enforces that selection. No domain or phrase keyword matching.
 */
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { getDb } from '../db/schema.js';
import { chatCompletions } from '../config/llm.js';

const MODES = new Set(['chat', 'direct_tool', 'delegate', 'goal_plan']);
const RELATIONS = new Set(['new_work', 'follow_up', 'correction', 'conversation']);

function db() {
  ensureAgentTurnRouterSchema();
  return getDb();
}

export function ensureAgentTurnRouterSchema() {
  const conn = getDb();
  conn.exec(`
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
    )
  `);
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_chat_work_units_session ON chat_work_units(owner_user_id, agent_id, session_id, created_at DESC)`);
  try { conn.exec(`ALTER TABLE chat_turns ADD COLUMN work_unit_id TEXT`); } catch (_) {}
  try { conn.exec(`ALTER TABLE agent_delegation_tasks ADD COLUMN parent_work_unit_id TEXT`); } catch (_) {}
  try { conn.exec(`ALTER TABLE agent_delegation_tasks ADD COLUMN parent_agent_id TEXT`); } catch (_) {}
  try { conn.exec(`ALTER TABLE agent_delegation_tasks ADD COLUMN callback_delivered_at TEXT`); } catch (_) {}
}

function extractJson(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') depth -= 1;
    if (depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function compactTurns(turns = []) {
  const compact = turns.slice(-12).map((t) => ({
    id: Number(t.id),
    role: String(t.role || ''),
    content: String(t.content || '').replace(/\s+/g, ' ').slice(0, 900),
    work_unit_id: t.work_unit_id || null,
  }));
  const ids = [...new Set(compact.map((t) => t.work_unit_id).filter(Boolean))];
  const states = new Map();
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    for (const row of db().prepare(`SELECT id,status,execution_ref FROM chat_work_units WHERE id IN (${placeholders})`).all(...ids)) {
      states.set(row.id, { status: row.status, execution_ref: row.execution_ref });
    }
  }
  return compact.map((turn) => ({ ...turn, ...(states.get(turn.work_unit_id) || {}) }));
}

const ROUTER_SYSTEM = `You are Flolah's control-plane router for an AI employee chat.
Classify the current user message by meaning, not by matching isolated words.

Return JSON only:
{
  "relation":"new_work|follow_up|correction|conversation",
  "execution_mode":"chat|direct_tool|delegate|goal_plan",
  "relevant_turn_ids":[integer ids],
  "parent_work_unit_id":"id or null",
  "resolved_request":"standalone request preserving every user constraint",
  "restart_requested":false,
  "confidence":0.0
}

Rules:
- new_work: a self-contained request independent of earlier work. Select no prior turns.
- follow_up: the user intentionally continues, retries, answers, or modifies a specific earlier work unit. Select only turns needed for that unit.
- correction: the user rejects or corrects a prior response. Select only the corrected unit, never unrelated work.
- conversation: greeting, acknowledgement, explanation, or ordinary dialogue that needs no executable work.
- goal_plan: substantial durable execution with multiple meaningful stages, dependencies, agents, tools, workflows, asynchronous work, tracking, retry, or a composite final deliverable.
- delegate: one specialist deliverable best owned by another employee.
- direct_tool: one bounded action or lookup.
- chat: answer/explain/converse without durable execution.
- Do not classify a detailed standalone specification as follow_up merely because its prose contains pronouns.
- A terminal execution is historical evidence, not permission to restart it. Only select it when the current message semantically requests continuation/retry/status.
- restart_requested is true only when the user explicitly asks to retry, rerun, resume, or repeat terminal work; it is false for a status question or a new request.
- resolved_request must be self-contained and must not add requirements.
- relevant_turn_ids must come only from the supplied candidate list.`;

export async function routeAgentTurn({
  ownerUserId,
  agent,
  sessionId,
  message,
  history = [],
  semanticDecision = null,
}) {
  ensureAgentTurnRouterSchema();
  const candidates = compactTurns(history);
  let parsed = semanticDecision && typeof semanticDecision === 'object' ? semanticDecision : null;
  try {
    if (!parsed) {
    const { content } = await chatCompletions({
      ownerUserId,
      toolName: 'agent_turn_router',
      maxTokens: 500,
      temperature: 0,
      responseFormat: 'json_object',
      messages: [
        { role: 'system', content: ROUTER_SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({
            agent: { id: agent?.id, name: agent?.name, role: agent?.role, is_coo: !!agent?.is_coo },
            current_message: String(message || ''),
            candidate_turns: candidates,
          }),
        },
      ],
    });
    parsed = extractJson(content);
    }
  } catch (e) {
    console.warn('[agent-turn-router] semantic route failed; safe clean-context fallback', e?.message || e);
  }

  const relation = RELATIONS.has(String(parsed?.relation)) ? String(parsed.relation) : 'new_work';
  let executionMode = MODES.has(String(parsed?.execution_mode)) ? String(parsed.execution_mode) : 'chat';
  const allowedIds = new Set(candidates.map((t) => t.id));
  const selectedIds = relation === 'new_work' || relation === 'conversation'
    ? []
    : [...new Set((Array.isArray(parsed?.relevant_turn_ids) ? parsed.relevant_turn_ids : [])
        .map(Number).filter((id) => Number.isFinite(id) && allowedIds.has(id)))];
  const selectedTurns = history.filter((t) => selectedIds.includes(Number(t.id)));
  const resolvedRequest = String(parsed?.resolved_request || message || '').trim() || String(message || '').trim();
  const parentWorkUnitId = selectedTurns.map((t) => t.work_unit_id).find(Boolean) || null;
  const parent = parentWorkUnitId ? db().prepare('SELECT status FROM chat_work_units WHERE id=? AND owner_user_id=?').get(parentWorkUnitId, ownerUserId) : null;
  const terminalParent = ['completed', 'failed', 'cancelled'].includes(String(parent?.status || '').toLowerCase());
  const restartRequested = parsed?.restart_requested === true;
  // The semantic router, not a phrase matcher, decides whether the CEO asked to
  // restart. Executable modes cannot silently relaunch terminal work.
  if (terminalParent && !restartRequested && executionMode !== 'chat') executionMode = 'chat';
  const id = `wu-${randomUUID()}`;
  const fingerprint = createHash('sha256')
    .update(`${ownerUserId}\n${agent?.id}\n${sessionId}\n${String(message || '').trim()}`)
    .digest('hex');
  const route = {
    id,
    relation,
    execution_mode: executionMode,
    relevant_turn_ids: selectedIds,
    selected_turns: selectedTurns,
    parent_work_unit_id: parentWorkUnitId,
    resolved_request: resolvedRequest,
    confidence: Number(parsed?.confidence) || 0,
    restart_requested: restartRequested,
    terminal_parent_guarded: terminalParent && !restartRequested,
    request_fingerprint: fingerprint,
  };
  db().prepare(`
    INSERT INTO chat_work_units
      (id,owner_user_id,agent_id,session_id,relation,execution_mode,resolved_request,parent_work_unit_id,request_fingerprint,route_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(id, ownerUserId, agent.id, sessionId, relation, executionMode, resolvedRequest, parentWorkUnitId, fingerprint, JSON.stringify(route, (key, value) => key === 'selected_turns' ? undefined : value));
  return route;
}

export function bindWorkUnitExecution(workUnitId, executionRef, status = 'running') {
  if (!workUnitId) return;
  db().prepare(`UPDATE chat_work_units SET execution_ref=?, status=?, updated_at=datetime('now') WHERE id=?`)
    .run(executionRef || null, status, workUnitId);
}

export function getWorkUnit(workUnitId) {
  return workUnitId ? db().prepare('SELECT * FROM chat_work_units WHERE id=?').get(workUnitId) || null : null;
}
