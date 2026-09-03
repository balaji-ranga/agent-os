/**
 * Semantic chat-turn routing shared by every Dashboard agent.
 * The model selects an explicit work unit and execution mode from meaning; the
 * platform then enforces that selection. No domain or phrase keyword matching.
 */
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { getDb } from '../db/schema.js';
import { chatCompletions } from '../config/llm.js';
import { getPlatformTimeoutMs } from './platform-timeout-settings.js';

const MODES = new Set(['chat', 'direct_tool', 'delegate', 'goal_plan']);
const RELATIONS = new Set(['new_work', 'follow_up', 'correction', 'conversation']);
const ROUTING_GENERIC_TOOLS = new Set([
  'analyze_image', 'ceo_profile', 'company_communications_history', 'email_send',
  'kanban_create_task', 'kanban_get_task', 'kanban_move_status', 'kanban_reassign_to_coo',
  'learnings_summary', 'list_inbound_attachments', 'notify_ceo', 'summarize_url',
  'voice_call_invite',
]);

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
  "target_agent_id":"exact roster agent id or null",
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
- delegate: one specialist deliverable that the user assigns to, or that is best owned by, a different employee in the supplied organization roster. An explicit request for another named employee to do the work is delegate, not direct_tool.
- When execution_mode is delegate, target_agent_id is required and must be an exact id from the supplied organization roster. For every other mode it must be null.
- An orchestrator coordinates work; it does not own every capability exposed anywhere in the company. If a roster employee's declared role or granted capabilities are a closer semantic fit than the current agent's declared role/capabilities, choose delegate even when the request has only one bounded deliverable.
- direct_tool: one bounded action or lookup clearly owned by the current agent's declared role or granted capabilities. Do not choose it merely because some other employee has the needed tool.
- chat: answer/explain/converse without durable execution.
- Do not classify a detailed standalone specification as follow_up merely because its prose contains pronouns.
- A terminal execution is historical evidence, not permission to restart it. Only select it when the current message semantically requests continuation/retry/status.
- restart_requested is true only when the user explicitly asks to retry, rerun, resume, or repeat terminal work; it is false for a status question or a new request.
- resolved_request must be self-contained and must not add requirements.
- relevant_turn_ids must come only from the supplied candidate list.`;

const DURABLE_GOAL_ADJUDICATOR = `Decide the execution boundary for the supplied request.
Judge its meaning, current agent, available organization, and execution structure; never isolated keywords.
Return JSON only: {"durable_goal":true|false,"stage_count":integer,"execution_mode":"direct_tool|delegate|goal_plan","target_agent_id":"exact roster agent id or null"}.
durable_goal is true when completion requires two or more independently verifiable stages or outputs, dependencies, multiple agents/systems, asynchronous work, tracked retry, or a composite final deliverable.
A bounded request handled by the current agent using its own tools is one deliverable and is direct_tool, even if it reads several records or returns several sections.
Choose delegate when one bounded deliverable is best owned by a different employee in the supplied organization. When delegating, target_agent_id is required and must exactly match that roster employee. An orchestrator's coordination role does not make it the owner of every company capability. The current agent must not substitute an unrelated tool when a roster specialist's role or granted capabilities are the closer semantic fit. Choose direct_tool only when the current agent's own declared role or capabilities clearly own the action. Choose goal_plan only for durable_goal=true; target_agent_id must be null for direct_tool and goal_plan.
A requested state change across a collection may be durable when it necessarily requires separately tracked discovery, decision, and mutation stages; a read-only review plus summary is not durable by itself.
A long explanation with only one answer is not a durable goal. A detailed specification remains durable even when formatted as one paragraph.`;

export function validateRouteDecision(value, candidateTurnIds = [], rosterAgentIds = []) {
  const errors = [];
  const allowedIds = new Set(candidateTurnIds.map(Number));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['response is not a JSON object'] };
  if (!RELATIONS.has(String(value.relation || ''))) errors.push('relation is missing or invalid');
  if (!MODES.has(String(value.execution_mode || ''))) errors.push('execution_mode is missing or invalid');
  if (!Array.isArray(value.relevant_turn_ids)) errors.push('relevant_turn_ids must be an array');
  else if (value.relevant_turn_ids.some((id) => !Number.isInteger(Number(id)) || !allowedIds.has(Number(id)))) errors.push('relevant_turn_ids contains an unknown turn');
  if (!String(value.resolved_request || '').trim()) errors.push('resolved_request is empty');
  if (typeof value.restart_requested !== 'boolean') errors.push('restart_requested must be boolean');
  const target = value.target_agent_id == null ? null : String(value.target_agent_id).trim();
  const allowedAgents = new Set(rosterAgentIds.map((id) => String(id).toLowerCase()));
  if (String(value.execution_mode || '') === 'delegate') {
    if (!target) errors.push('target_agent_id is required for delegate');
    else if (!allowedAgents.has(target.toLowerCase())) errors.push('target_agent_id is not in the organization roster');
  } else if (target) {
    errors.push('target_agent_id must be null unless execution_mode is delegate');
  }
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) errors.push('confidence must be between 0 and 1');
  return { ok: errors.length === 0, errors };
}

function compactAgentCapabilities(agentId, limit = 18) {
  try {
    return db().prepare('SELECT tool_name FROM agent_tool_grants WHERE agent_id=? ORDER BY tool_name')
      .all(agentId || '')
      .map((row) => String(row.tool_name || ''))
      .filter((name) => name && !ROUTING_GENERIC_TOOLS.has(name) && !name.startsWith('master_data_'))
      .slice(0, limit);
  } catch (_) {
    return [];
  }
}

function validateDurableDecision(value, rosterAgentIds = []) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['response is not a JSON object'] };
  if (typeof value.durable_goal !== 'boolean') errors.push('durable_goal must be boolean');
  if (!Number.isInteger(Number(value.stage_count)) || Number(value.stage_count) < 0) errors.push('stage_count must be a non-negative integer');
  if (!new Set(['direct_tool', 'delegate', 'goal_plan']).has(String(value.execution_mode || ''))) {
    errors.push('execution_mode is missing or invalid');
  }
  if (value?.durable_goal === true && value?.execution_mode !== 'goal_plan') errors.push('durable goal must use goal_plan');
  if (value?.durable_goal === false && value?.execution_mode === 'goal_plan') errors.push('non-durable work cannot use goal_plan');
  const target = value?.target_agent_id == null ? null : String(value.target_agent_id).trim();
  const allowedAgents = new Set(rosterAgentIds.map((id) => String(id).toLowerCase()));
  if (String(value?.execution_mode || '') === 'delegate') {
    if (!target) errors.push('target_agent_id is required for delegate');
    else if (!allowedAgents.has(target.toLowerCase())) errors.push('target_agent_id is not in the organization roster');
  } else if (target) {
    errors.push('target_agent_id must be null unless execution_mode is delegate');
  }
  return { ok: errors.length === 0, errors };
}

export function applyDurableAdjudication(route, durable) {
  if (!route || !durable) return route;
  if (durable.durable_goal === true && Number(durable.stage_count) >= 2) {
    return { ...route, execution_mode: 'goal_plan', target_agent_id: null, confidence: Math.max(Number(route.confidence) || 0, 0.8) };
  }
  if (durable.durable_goal === false && ['direct_tool', 'delegate'].includes(String(durable.execution_mode))) {
    // The adjudicator is a safeguard for under-routed or ambiguous work. It
    // must not overrule a confident, schema-valid goal decision from the main
    // semantic router; doing so made identical requests randomly become a
    // delegation whenever the two model calls disagreed.
    if (String(route.execution_mode || '') === 'goal_plan' && Number(route.confidence) >= 0.8) {
      return route;
    }
    return {
      ...route,
      execution_mode: durable.execution_mode,
      target_agent_id: durable.execution_mode === 'delegate' ? durable.target_agent_id : null,
      confidence: Math.max(Number(route.confidence) || 0, 0.8),
    };
  }
  return route;
}

export function needsRouteAdjudication(routeValidation, route, threshold = 0.75) {
  return !routeValidation?.ok || Number(route?.confidence) < threshold;
}

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
  let organization = [];
  try {
    organization = db().prepare(`
      SELECT a.id,a.name,a.role,a.department,COALESCE(a.is_orchestrator,0) AS is_orchestrator,
             COALESCE(GROUP_CONCAT(atg.tool_name, '|'),'') AS granted_tools
      FROM user_agents ua JOIN agents a ON a.id=ua.agent_id
      LEFT JOIN agent_tool_grants atg ON atg.agent_id=a.id
      WHERE ua.user_id=? AND ua.enabled=1 AND a.id<>?
        AND (?=0 OR lower(COALESCE(a.parent_id,''))=lower(?))
      GROUP BY a.id,a.name,a.role,a.department,a.is_orchestrator
      ORDER BY a.name LIMIT 80
    `).all(ownerUserId, agent?.id || '', agent?.is_coo ? 1 : 0, agent?.id || '');
    organization = organization.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role || '',
      department: member.department || '',
      is_orchestrator: !!member.is_orchestrator,
      capabilities: String(member.granted_tools || '').split('|')
        .filter((name) => name && !ROUTING_GENERIC_TOOLS.has(name) && !name.startsWith('master_data_'))
        .slice(0, 18),
    }));
  } catch (_) {
    organization = [];
  }
  let parsed = semanticDecision && typeof semanticDecision === 'object' ? semanticDecision : null;
  const routeAttempts = [];
  let routeValidation = parsed ? { ok: true, errors: [] } : { ok: false, errors: ['router has not run'] };
  try {
    if (!parsed) {
      for (let attempt = 1; attempt <= 1; attempt += 1) {
        const { content } = await chatCompletions({
          ownerUserId,
          toolName: 'agent_turn_router',
          // Reasoning-capable providers count hidden analysis against this
          // budget even for response_format=json_object. Leave enough room for
          // the final contract instead of receiving reasoning_content only.
          maxTokens: 5200,
          temperature: 0,
          responseFormat: 'json_object',
          thinkingMode: 'disabled',
          timeoutMs: getPlatformTimeoutMs('semantic_router'),
          messages: [
            { role: 'system', content: ROUTER_SYSTEM },
            {
              role: 'user',
              content: JSON.stringify({
                agent: {
                  id: agent?.id,
                  name: agent?.name,
                  role: agent?.role,
                  is_coo: !!agent?.is_coo,
                  is_orchestrator: !!agent?.is_orchestrator,
                  capabilities: compactAgentCapabilities(agent?.id),
                },
                organization,
                current_message: String(message || ''),
                candidate_turns: candidates,
                ...(attempt > 1 ? { repair_errors: routeValidation.errors, previous_response: routeAttempts.at(-1)?.raw } : {}),
              }),
            },
          ],
        });
        parsed = extractJson(content);
        routeValidation = validateRouteDecision(parsed, candidates.map((turn) => turn.id), organization.map((member) => member.id));
        routeAttempts.push({ attempt, raw: String(content || '').slice(0, 4000), errors: routeValidation.errors });
        if (routeValidation.ok && Number(parsed.confidence) >= 0.75) break;
        if (routeValidation.ok) routeValidation = { ok: false, errors: [`confidence ${Number(parsed.confidence)} is below 0.75`] };
      }
    }
  } catch (e) {
    routeValidation = { ok: false, errors: [String(e?.message || e)] };
    console.warn('[agent-turn-router] semantic route failed', e?.message || e);
  }

  // Large specifications are vulnerable to formatting-dependent under-routing
  // (the same request as bullets vs one paragraph). A separate semantic judge
  // resolves execution structure without any domain or phrase rules.
  if (
    !semanticDecision &&
    needsRouteAdjudication(routeValidation, parsed)
  ) {
    try {
      let durable = null;
      let durableValidation = { ok: false, errors: ['adjudicator has not run'] };
      for (let attempt = 1; attempt <= 1; attempt += 1) {
        const { content } = await chatCompletions({
          ownerUserId,
          toolName: 'agent_turn_goal_adjudicator',
          maxTokens: 5200,
          temperature: 0,
          responseFormat: 'json_object',
          thinkingMode: 'disabled',
          timeoutMs: getPlatformTimeoutMs('goal_adjudicator'),
          endpointPreference: 'secondary',
          messages: [
            { role: 'system', content: DURABLE_GOAL_ADJUDICATOR },
            { role: 'user', content: JSON.stringify({
              current_agent: {
                id: agent?.id,
                name: agent?.name,
                role: agent?.role,
                is_coo: !!agent?.is_coo,
                is_orchestrator: !!agent?.is_orchestrator,
                capabilities: compactAgentCapabilities(agent?.id),
              },
              organization,
              request: String(message || ''),
              ...(attempt > 1 ? { repair_errors: durableValidation.errors, previous_response: routeAttempts.at(-1)?.raw } : {}),
            }) },
          ],
        });
        durable = extractJson(content);
        durableValidation = validateDurableDecision(durable, organization.map((member) => member.id));
        routeAttempts.push({ attempt, judge: true, raw: String(content || '').slice(0, 2000), errors: durableValidation.errors });
        if (durableValidation.ok) break;
      }
      if (durableValidation.ok) {
        parsed = applyDurableAdjudication({
          ...(parsed || {}),
          relation: 'new_work',
          relevant_turn_ids: [],
          resolved_request: String(parsed?.resolved_request || message || '').trim(),
          restart_requested: false,
        }, durable);
        routeValidation = validateRouteDecision(parsed, candidates.map((turn) => turn.id), organization.map((member) => member.id));
      }
    } catch (e) {
      routeAttempts.push({ judge: true, error: String(e?.message || e).slice(0, 1000) });
      console.warn('[agent-turn-router] durable-goal adjudication failed', e?.message || e);
    }
  }

  if (!semanticDecision && !routeValidation.ok) {
    const error = new Error(`Unable to obtain a valid semantic route: ${routeValidation.errors.join('; ')}`);
    error.code = 'ROUTER_DECISION_INVALID';
    error.status = 503;
    error.details = { attempts: routeAttempts };
    throw error;
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
  const terminalParent = ['completed', 'partial_success', 'failed', 'cancelled'].includes(String(parent?.status || '').toLowerCase());
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
    target_agent_id: executionMode === 'delegate' ? String(parsed?.target_agent_id || '').trim() || null : null,
    terminal_parent_guarded: terminalParent && !restartRequested,
    request_fingerprint: fingerprint,
    decision_attempts: routeAttempts,
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
