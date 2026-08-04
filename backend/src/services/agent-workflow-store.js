/**
 * Agent workflow definitions: draft/publish, audit trail, run listing.
 */
import { randomBytes } from 'crypto';
import { getDb } from '../db/schema.js';
import { validateWorkflowBrainCredentials } from './agent-workflow-brain-providers.js';
import {
  extractInputSchemaFromGraph,
  normalizeInputSchema,
  parseInputSchemaJson,
} from './workflow-input-schema.js';

function db() {
  return getDb();
}

function slugify(name) {
  const base = String(name || 'workflow')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `${base || 'workflow'}-${Date.now().toString(36)}`;
}

function parseGraph(json) {
  try {
    const g = typeof json === 'string' ? JSON.parse(json) : json;
    return {
      nodes: Array.isArray(g?.nodes) ? g.nodes : [],
      edges: Array.isArray(g?.edges) ? g.edges : [],
      viewport: g?.viewport || { x: 0, y: 0, zoom: 1 },
    };
  } catch {
    return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  }
}

function parseVariables(json) {
  try {
    const v = typeof json === 'string' ? JSON.parse(json || '{}') : json;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function rowToDefinition(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    owner_user_id: row.owner_user_id,
    status: row.status,
    draft_graph: parseGraph(row.draft_graph_json),
    published_graph: row.published_graph_json ? parseGraph(row.published_graph_json) : null,
    schedule_cron: row.schedule_cron || '',
    chat_trigger_phrase: row.chat_trigger_phrase || '',
    trigger_modes: (row.trigger_modes || 'manual').split(',').map((s) => s.trim()).filter(Boolean),
    paused: !!row.paused,
    webhook_secret: row.webhook_secret || '',
    variables: parseVariables(row.variables_json),
    input_schema: parseInputSchemaJson(row.input_schema_json),
    certify_state: row.certify_state || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Normalize workflow-level static variables (plain JSON object). */
export function normalizeWorkflowVariables(input) {
  if (input == null) return {};
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof input === 'object' && !Array.isArray(input)) return { ...input };
  return {};
}

export function appendAudit(definitionId, { action, summary, changedBy, changedByName, diff = null }) {
  db()
    .prepare(
      `INSERT INTO agent_workflow_audit (definition_id, action, summary, changed_by, changed_by_name, diff_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      definitionId,
      action,
      summary || '',
      changedBy || null,
      changedByName || null,
      diff ? JSON.stringify(diff) : null
    );
}

function rowToDefinitionSummary(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    owner_user_id: row.owner_user_id,
    status: row.status,
    schedule_cron: row.schedule_cron || '',
    chat_trigger_phrase: row.chat_trigger_phrase || '',
    trigger_modes: (row.trigger_modes || 'manual').split(',').map((s) => s.trim()).filter(Boolean),
    paused: !!row.paused,
    certify_state: row.certify_state || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    /** Graph payload omitted on list — load via GET /agent-workflows/:id */
    draft_graph: null,
    published_graph: null,
    variables: {},
    input_schema: null,
    webhook_secret: '',
  };
}

export function listDefinitions(ownerUserId, { search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase();
  if (!q) {
    const rows = db()
      .prepare(`SELECT * FROM agent_workflow_definitions WHERE owner_user_id = ? ORDER BY updated_at DESC`)
      .all(ownerUserId);
    return rows.map(rowToDefinition);
  }
  const like = `%${q}%`;
  const rows = db()
    .prepare(
      `SELECT * FROM agent_workflow_definitions
       WHERE owner_user_id = ?
         AND (LOWER(name) LIKE ? OR LOWER(id) LIKE ?)
       ORDER BY updated_at DESC`
    )
    .all(ownerUserId, like, like);
  return rows.map(rowToDefinition);
}

/**
 * Paginated definition list for CEO UI (no draft/published graph JSON in rows).
 * @returns {{ workflows: object[], total: number, limit: number, offset: number, has_more: boolean }}
 */
export function listDefinitionsPaginated(ownerUserId, { search = '', limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const q = String(search || '').trim().toLowerCase();
  const selectCols = `id, name, description, owner_user_id, status, schedule_cron, chat_trigger_phrase,
       trigger_modes, paused, certify_state, created_at, updated_at`;

  let where = 'WHERE owner_user_id = ?';
  const params = [ownerUserId];
  if (q) {
    where += ' AND (LOWER(name) LIKE ? OR LOWER(id) LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like);
  }

  const total = db().prepare(`SELECT COUNT(*) AS n FROM agent_workflow_definitions ${where}`).get(...params)?.n ?? 0;
  const rows = db()
    .prepare(
      `SELECT ${selectCols} FROM agent_workflow_definitions ${where}
       ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, safeLimit, safeOffset);

  const workflows = rows.map(rowToDefinitionSummary);
  return {
    workflows,
    total,
    limit: safeLimit,
    offset: safeOffset,
    has_more: safeOffset + workflows.length < total,
  };
}

export function getDefinition(id, ownerUserId = null) {
  const row = ownerUserId
    ? db().prepare('SELECT * FROM agent_workflow_definitions WHERE id = ? AND owner_user_id = ?').get(id, ownerUserId)
    : db().prepare('SELECT * FROM agent_workflow_definitions WHERE id = ?').get(id);
  return rowToDefinition(row);
}

export function createDefinition({
  name,
  description,
  ownerUserId,
  actor,
  graph = null,
  trigger_modes = ['manual'],
  schedule_cron = '',
  chat_trigger_phrase = '',
  variables = {},
  input_schema = undefined,
  id: forcedId = null,
}) {
  const id = forcedId || slugify(name);
  const normalized = normalizeTriggerSettings(trigger_modes, schedule_cron, chat_trigger_phrase);
  let inputSchema = null;
  if (input_schema !== undefined) {
    inputSchema = normalizeInputSchema(input_schema);
  } else {
    inputSchema = extractInputSchemaFromGraph(graph);
  }
  const draftGraph = syncTriggerNodeInGraph(
    graph || { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    { ...normalized, input_schema: inputSchema }
  );
  const varsJson = JSON.stringify(normalizeWorkflowVariables(variables));
  db()
    .prepare(
      `INSERT INTO agent_workflow_definitions (id, name, description, owner_user_id, draft_graph_json, status, schedule_cron, chat_trigger_phrase, trigger_modes, variables_json, input_schema_json)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      name.trim(),
      (description || '').trim(),
      ownerUserId,
      JSON.stringify(draftGraph),
      normalized.schedule_cron,
      normalized.chat_trigger_phrase,
      normalized.trigger_modes.join(','),
      varsJson,
      inputSchema ? JSON.stringify(inputSchema) : null
    );
  appendAudit(id, {
    action: 'created',
    summary: `Created workflow "${name}"`,
    changedBy: actor?.id,
    changedByName: actor?.name,
  });
  return getDefinition(id, ownerUserId);
}

export function updateDraft(id, ownerUserId, patch, actor) {
  const existing = getDefinition(id, ownerUserId);
  if (!existing) return null;

  const name = patch.name != null ? String(patch.name).trim() : existing.name;
  const description = patch.description != null ? String(patch.description).trim() : existing.description;
  const draftGraph = patch.graph != null ? patch.graph : existing.draft_graph;
  const normalized = normalizeTriggerSettings(
    patch.trigger_modes != null ? patch.trigger_modes : existing.trigger_modes,
    patch.schedule_cron != null ? patch.schedule_cron : existing.schedule_cron,
    patch.chat_trigger_phrase != null ? patch.chat_trigger_phrase : existing.chat_trigger_phrase
  );
  const { trigger_modes, schedule_cron, chat_trigger_phrase } = normalized;
  const variables =
    patch.variables != null ? normalizeWorkflowVariables(patch.variables) : existing.variables || {};

  let inputSchema;
  if (patch.input_schema !== undefined) {
    inputSchema = normalizeInputSchema(patch.input_schema);
  } else if (patch.graph != null) {
    inputSchema = extractInputSchemaFromGraph(draftGraph) ?? existing.input_schema ?? null;
  } else {
    inputSchema = existing.input_schema ?? null;
  }

  const syncedGraph = syncTriggerNodeInGraph(draftGraph, { ...normalized, input_schema: inputSchema });

  db()
    .prepare(
      `UPDATE agent_workflow_definitions
       SET name = ?, description = ?, draft_graph_json = ?, schedule_cron = ?,
           chat_trigger_phrase = ?, trigger_modes = ?, variables_json = ?, input_schema_json = ?,
           updated_at = datetime('now')
       WHERE id = ? AND owner_user_id = ?`
    )
    .run(
      name,
      description,
      JSON.stringify(syncedGraph),
      schedule_cron,
      chat_trigger_phrase,
      trigger_modes.join(','),
      JSON.stringify(variables),
      inputSchema ? JSON.stringify(inputSchema) : null,
      id,
      ownerUserId
    );

  appendAudit(id, {
    action: 'updated_draft',
    summary: `Updated draft for "${name}"`,
    changedBy: actor?.id,
    changedByName: actor?.name,
    diff: { fields: Object.keys(patch) },
  });
  if (existing.status === 'published') syncWorkflowScheduleRegistry(id);
  if (trigger_modes.includes('event')) ensureWebhookSecret(id);
  return getDefinition(id, ownerUserId);
}

export function publishDefinition(id, ownerUserId, actor) {
  const def = getDefinition(id, ownerUserId);
  if (!def) return null;
  if (!def.draft_graph?.nodes?.length) {
    throw new Error('Workflow must have at least one node before publishing');
  }
  const hasTrigger = def.draft_graph.nodes.some((n) => n.type === 'trigger');
  if (!hasTrigger) throw new Error('Workflow must include a Trigger node');

  const brainErrors = validateWorkflowBrainCredentials(def.draft_graph, ownerUserId);
  if (brainErrors.length) {
    throw new Error(`Cannot publish: ${brainErrors.join('; ')}`);
  }

  const inputSchema =
    extractInputSchemaFromGraph(def.draft_graph) ?? def.input_schema ?? null;
  const syncedDraft = syncTriggerNodeInGraph(def.draft_graph, {
    trigger_modes: def.trigger_modes,
    schedule_cron: def.schedule_cron,
    chat_trigger_phrase: def.chat_trigger_phrase,
    input_schema: inputSchema,
  });

  db()
    .prepare(
      `UPDATE agent_workflow_definitions
       SET status = 'published',
           draft_graph_json = ?,
           published_graph_json = ?,
           input_schema_json = ?,
           updated_at = datetime('now')
       WHERE id = ? AND owner_user_id = ?`
    )
    .run(
      JSON.stringify(syncedDraft),
      JSON.stringify(syncedDraft),
      inputSchema ? JSON.stringify(inputSchema) : null,
      id,
      ownerUserId
    );

  appendAudit(id, {
    action: 'published',
    summary: `Published workflow "${def.name}" (replaces previous published version)`,
    changedBy: actor?.id,
    changedByName: actor?.name,
    diff: { node_count: def.draft_graph.nodes.length, edge_count: def.draft_graph.edges.length },
  });
  syncWorkflowScheduleRegistry(id);
  return getDefinition(id, ownerUserId);
}

/** Revert a published workflow to draft (unpublish). Stops schedules; draft graph remains editable. */
export function unpublishDefinition(id, ownerUserId, actor) {
  const def = getDefinition(id, ownerUserId);
  if (!def) return null;
  if (def.status === 'draft') return def;

  db()
    .prepare(
      `UPDATE agent_workflow_definitions SET status = 'draft', updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`
    )
    .run(id, ownerUserId);

  removeWorkflowSchedule(id);
  appendAudit(id, {
    action: 'unpublished',
    summary: `Reverted workflow "${def.name}" to draft (unpublished)`,
    changedBy: actor?.id,
    changedByName: actor?.name,
  });
  return getDefinition(id, ownerUserId);
}

export function listAudit(definitionId, ownerUserId, limit = 50) {
  const def = getDefinition(definitionId, ownerUserId);
  if (!def) return [];
  return db()
    .prepare(
      `SELECT id, action, summary, changed_by, changed_by_name, diff_json, created_at
       FROM agent_workflow_audit WHERE definition_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(definitionId, limit)
    .map((r) => ({
      ...r,
      diff: r.diff_json ? JSON.parse(r.diff_json) : null,
    }));
}

export function listRuns(definitionId, ownerUserId, limit = 30) {
  const def = getDefinition(definitionId, ownerUserId);
  if (!def) return [];
  return db()
    .prepare(
      `SELECT * FROM agent_workflow_runs WHERE definition_id = ? AND owner_user_id = ?
       ORDER BY started_at DESC LIMIT ?`
    )
    .all(definitionId, ownerUserId, limit)
    .map(formatRunRow);
}

export function listAllRuns(ownerUserId, limit = 50) {
  return listAllRunsPaginated(ownerUserId, { page: 1, limit }).runs;
}

export function listAllRunsPaginated(ownerUserId, { page = 1, limit = 20, search = '' } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const q = String(search || '').trim().toLowerCase();

  let where = 'WHERE r.owner_user_id = ?';
  const params = [ownerUserId];
  if (q) {
    const like = `%${q}%`;
    where += ` AND (
      LOWER(d.name) LIKE ? OR
      LOWER(r.definition_id) LIKE ? OR
      CAST(r.id AS TEXT) LIKE ? OR
      CAST(r.run_number AS TEXT) LIKE ?
    )`;
    params.push(like, like, like, like);
  }

  const total =
    db()
      .prepare(
        `SELECT COUNT(*) AS n
         FROM agent_workflow_runs r
         JOIN agent_workflow_definitions d ON d.id = r.definition_id
         ${where}`
      )
      .get(...params)?.n ?? 0;

  const rows = db()
    .prepare(
      `SELECT r.*, d.name AS definition_name
       FROM agent_workflow_runs r
       JOIN agent_workflow_definitions d ON d.id = r.definition_id
       ${where}
       ORDER BY r.started_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, safeLimit, offset)
    .map((row) => ({ ...formatRunRow(row), definition_name: row.definition_name }));

  return {
    runs: rows,
    total,
    page: safePage,
    limit: safeLimit,
    pages: total > 0 ? Math.ceil(total / safeLimit) : 0,
  };
}

function formatRunRow(row) {
  let context = {};
  try {
    context = JSON.parse(row.context_json || '{}');
  } catch (_) {}
  let graph = null;
  if (row.graph_json) {
    try {
      graph = JSON.parse(row.graph_json);
    } catch (_) {
      graph = null;
    }
  }
  return {
    id: row.id,
    run_number: row.run_number,
    definition_id: row.definition_id,
    owner_user_id: row.owner_user_id,
    status: row.status,
    trigger: row.trigger,
    progress_pct: row.progress_pct ?? 0,
    context,
    graph,
    standup_id: row.standup_id,
    started_at: row.started_at,
    completed_at: row.completed_at,
    error_message: row.error_message,
    updated_at: row.updated_at,
  };
}

export function getRun(runId, ownerUserId = null, { stepsLimit = null, stepsOffset = 0 } = {}) {
  const row = ownerUserId
    ? db().prepare('SELECT * FROM agent_workflow_runs WHERE id = ? AND owner_user_id = ?').get(runId, ownerUserId)
    : db().prepare('SELECT * FROM agent_workflow_runs WHERE id = ?').get(runId);
  if (!row) return null;
  const allSteps = db()
    .prepare('SELECT * FROM agent_workflow_run_steps WHERE run_id = ? ORDER BY id ASC')
    .all(runId)
    .map((s) => ({
      ...s,
      input: s.input_json ? JSON.parse(s.input_json) : null,
      output: s.output_json ? JSON.parse(s.output_json) : null,
    }));
  const stepsTotal = allSteps.length;
  let steps = allSteps;
  let meta = {
    steps_total: stepsTotal,
    steps_limit: stepsTotal,
    steps_offset: 0,
    steps_has_more: false,
  };
  if (stepsLimit != null) {
    const lim = Math.min(Math.max(Number(stepsLimit) || 100, 1), 500);
    const off = Math.max(Number(stepsOffset) || 0, 0);
    steps = allSteps.slice(off, off + lim);
    meta = {
      steps_total: stepsTotal,
      steps_limit: lim,
      steps_offset: off,
      steps_has_more: off + steps.length < stepsTotal,
    };
  }
  const def = getDefinition(row.definition_id);
  const formatted = formatRunRow(row);
  if (!formatted.graph) {
    formatted.graph = def?.published_graph || def?.draft_graph || null;
  }
  return {
    ...formatted,
    definition_name: def?.name,
    steps,
    ...meta,
  };
}

export function deleteDefinition(id, ownerUserId, actor) {
  const def = getDefinition(id, ownerUserId);
  if (!def) return false;
  db().prepare('DELETE FROM agent_workflow_run_steps WHERE run_id IN (SELECT id FROM agent_workflow_runs WHERE definition_id = ?)').run(id);
  db().prepare('DELETE FROM agent_workflow_runs WHERE definition_id = ?').run(id);
  db().prepare('DELETE FROM agent_workflow_audit WHERE definition_id = ?').run(id);
  db().prepare('DELETE FROM agent_workflow_definitions WHERE id = ? AND owner_user_id = ?').run(id, ownerUserId);
  removeWorkflowSchedule(id);
  return true;
}

export function setPaused(id, ownerUserId, paused, actor) {
  const def = getDefinition(id, ownerUserId);
  if (!def) return null;
  db()
    .prepare(`UPDATE agent_workflow_definitions SET paused = ?, updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`)
    .run(paused ? 1 : 0, id, ownerUserId);
  if (paused) removeWorkflowSchedule(id);
  else syncWorkflowScheduleRegistry(id);
  appendAudit(id, {
    action: paused ? 'paused' : 'resumed',
    summary: paused ? `Workflow "${def.name}" paused — all triggers disabled` : `Workflow "${def.name}" resumed`,
    changedBy: actor?.id,
    changedByName: actor?.name,
  });
  return getDefinition(id, ownerUserId);
}

function syncTriggerNodeInGraph(graph, { trigger_modes, schedule_cron, chat_trigger_phrase, input_schema }) {
  if (!graph?.nodes?.length) return graph;
  const schema =
    input_schema === undefined
      ? undefined
      : input_schema
        ? normalizeInputSchema(input_schema)
        : null;
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.type !== 'trigger') return n;
      const data = {
        ...n.data,
        triggerModes: trigger_modes,
        scheduleCron: schedule_cron,
        chatPhrase: chat_trigger_phrase,
      };
      if (schema !== undefined) {
        data.inputSchema = schema;
      }
      return { ...n, data };
    }),
  };
}

/** Clear cron/chat when their trigger mode is disabled — prevents stale scheduled runs. */
export function normalizeTriggerSettings(triggerModesInput, scheduleCron = '', chatPhrase = '') {
  const trigger_modes = (Array.isArray(triggerModesInput) ? triggerModesInput : String(triggerModesInput || 'manual').split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  if (!trigger_modes.length) trigger_modes.push('manual');
  const schedule_cron = trigger_modes.includes('schedule') ? String(scheduleCron || '').trim() : '';
  const chat_trigger_phrase = trigger_modes.includes('chat') ? String(chatPhrase || '').trim() : '';
  return { trigger_modes, schedule_cron, chat_trigger_phrase };
}

/** DB rows where schedule_cron remains after schedule mode removed. */
export function repairStaleScheduleCrons() {
  const result = db()
    .prepare(
      `UPDATE agent_workflow_definitions
       SET schedule_cron = '', updated_at = datetime('now')
       WHERE (trigger_modes NOT LIKE '%schedule%' OR trigger_modes IS NULL)
         AND schedule_cron IS NOT NULL AND schedule_cron != ''`
    )
    .run();
  return result.changes || 0;
}

/** Apply trigger mode / schedule changes immediately on published workflow. */
export function updateTriggers(id, ownerUserId, patch, actor) {
  const def = getDefinition(id, ownerUserId);
  if (!def) return null;

  const normalized = normalizeTriggerSettings(
    patch.trigger_modes != null ? patch.trigger_modes : def.trigger_modes,
    patch.schedule_cron != null ? patch.schedule_cron : def.schedule_cron,
    patch.chat_trigger_phrase != null ? patch.chat_trigger_phrase : def.chat_trigger_phrase
  );
  const { trigger_modes, schedule_cron, chat_trigger_phrase } = normalized;
  const inputSchema =
    patch.input_schema !== undefined
      ? normalizeInputSchema(patch.input_schema)
      : def.input_schema ?? extractInputSchemaFromGraph(def.draft_graph);

  const draftGraph = syncTriggerNodeInGraph(def.draft_graph, {
    ...normalized,
    input_schema: inputSchema,
  });
  const publishedGraph = def.published_graph
    ? syncTriggerNodeInGraph(def.published_graph, { ...normalized, input_schema: inputSchema })
    : null;

  db()
    .prepare(
      `UPDATE agent_workflow_definitions
       SET trigger_modes = ?, schedule_cron = ?, chat_trigger_phrase = ?,
           draft_graph_json = ?, published_graph_json = COALESCE(?, published_graph_json),
           input_schema_json = ?, updated_at = datetime('now')
       WHERE id = ? AND owner_user_id = ?`
    )
    .run(
      trigger_modes.join(','),
      schedule_cron,
      chat_trigger_phrase,
      JSON.stringify(draftGraph),
      publishedGraph ? JSON.stringify(publishedGraph) : null,
      inputSchema ? JSON.stringify(inputSchema) : null,
      id,
      ownerUserId
    );

  appendAudit(id, {
    action: 'triggers_updated',
    summary: `Triggers updated: ${trigger_modes.join(', ')}${schedule_cron ? ` cron=${schedule_cron}` : ''}`,
    changedBy: actor?.id,
    changedByName: actor?.name,
    diff: { trigger_modes, schedule_cron, chat_trigger_phrase, input_schema: !!inputSchema },
  });
  syncWorkflowScheduleRegistry(id);
  if (trigger_modes.includes('event')) ensureWebhookSecret(id);
  return getDefinition(id, ownerUserId);
}

export function generateWebhookSecret() {
  return randomBytes(24).toString('hex');
}

export function ensureWebhookSecret(definitionId) {
  const row = db().prepare('SELECT webhook_secret FROM agent_workflow_definitions WHERE id = ?').get(definitionId);
  if (!row) return null;
  if (row.webhook_secret) return row.webhook_secret;
  const secret = generateWebhookSecret();
  db()
    .prepare(`UPDATE agent_workflow_definitions SET webhook_secret = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(secret, definitionId);
  return secret;
}

/** Force a new webhook secret (owner-entitled callers only). */
export function regenerateWebhookSecret(definitionId, ownerUserId, actor = null) {
  const def = getDefinition(definitionId, ownerUserId);
  if (!def) return null;
  const secret = generateWebhookSecret();
  db()
    .prepare(`UPDATE agent_workflow_definitions SET webhook_secret = ?, updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`)
    .run(secret, definitionId, ownerUserId);
  appendAudit(definitionId, {
    action: 'webhook_secret_regenerated',
    summary: 'Webhook secret regenerated',
    changedBy: actor?.id || ownerUserId,
    changedByName: actor?.name || 'user',
  });
  return secret;
}

export function isWorkflowTriggerable(def) {
  if (!def || def.paused) return false;
  if (def.status !== 'published') return false;
  return true;
}

export function findPublishedByChatPhrase(ownerUserId, message) {
  const msg = String(message || '').trim().toLowerCase();
  if (!msg) return null;
  const rows = db()
    .prepare(
      `SELECT * FROM agent_workflow_definitions
       WHERE owner_user_id = ? AND status = 'published' AND chat_trigger_phrase != ''
       AND (paused IS NULL OR paused = 0)`
    )
    .all(ownerUserId);
  for (const row of rows) {
    const phrase = String(row.chat_trigger_phrase || '').trim().toLowerCase();
    if (phrase && msg.includes(phrase)) return rowToDefinition(row);
  }
  return null;
}

export function listScheduledPublished() {
  return listScheduledFromRegistry();
}

/** Central schedule registry — sole source for the workflow scheduler tick. */
export function listScheduledFromRegistry() {
  const rows = db()
    .prepare(
      `SELECT s.definition_id, s.owner_user_id, s.schedule_cron, s.workflow_name, s.enabled,
              d.status, d.paused, d.trigger_modes, d.chat_trigger_phrase
       FROM agent_workflow_schedules s
       INNER JOIN agent_workflow_definitions d ON d.id = s.definition_id
       INNER JOIN platform_users u ON u.id = s.owner_user_id AND u.enabled = 1
       WHERE s.enabled = 1
         AND (d.paused IS NULL OR d.paused = 0)
         AND d.status = 'published'
         AND d.trigger_modes LIKE '%schedule%'
         AND s.schedule_cron IS NOT NULL AND s.schedule_cron != ''`
    )
    .all();
  return rows.map((row) => {
    const def = getDefinition(row.definition_id, row.owner_user_id);
    return def || rowToDefinition(db().prepare('SELECT * FROM agent_workflow_definitions WHERE id = ?').get(row.definition_id));
  }).filter(Boolean);
}

export function listScheduleRegistryRows() {
  return db()
    .prepare(
      `SELECT s.*, d.paused, d.status, d.trigger_modes
       FROM agent_workflow_schedules s
       LEFT JOIN agent_workflow_definitions d ON d.id = s.definition_id
       ORDER BY s.updated_at DESC`
    )
    .all();
}

/** Remove one workflow from the central schedule registry (pause / manual-only / delete). */
export function removeWorkflowSchedule(definitionId) {
  const result = db().prepare('DELETE FROM agent_workflow_schedules WHERE definition_id = ?').run(definitionId);
  return result.changes || 0;
}

/** Remove all scheduled workflows for a CEO (e.g. when Admin disables the user). */
export function removeWorkflowSchedulesForOwner(ownerUserId) {
  if (!ownerUserId) return 0;
  const result = db()
    .prepare('DELETE FROM agent_workflow_schedules WHERE owner_user_id = ?')
    .run(ownerUserId);
  return result.changes || 0;
}

/**
 * Rebuild central schedule registry from workflow definitions.
 * Call on backend startup and after any trigger/publish/pause change.
 */
export function syncWorkflowScheduleRegistry(definitionId = null) {
  repairStaleScheduleCrons();

  const syncOne = (id) => {
    const row = db().prepare('SELECT * FROM agent_workflow_definitions WHERE id = ?').get(id);
    if (!row) {
      removeWorkflowSchedule(id);
      return;
    }
    const def = rowToDefinition(row);
    const ownerEnabled = db()
      .prepare(`SELECT enabled FROM platform_users WHERE id = ?`)
      .get(def.owner_user_id)?.enabled;
    const cronExpr = String(def.schedule_cron || '').trim();
    const shouldRegister =
      !!ownerEnabled &&
      def.status === 'published' &&
      !def.paused &&
      def.trigger_modes.includes('schedule') &&
      cronExpr.length > 0;

    if (!shouldRegister) {
      removeWorkflowSchedule(id);
      return;
    }

    db()
      .prepare(
        `INSERT INTO agent_workflow_schedules (definition_id, owner_user_id, workflow_name, schedule_cron, enabled, updated_at)
         VALUES (?, ?, ?, ?, 1, datetime('now'))
         ON CONFLICT(definition_id) DO UPDATE SET
           owner_user_id = excluded.owner_user_id,
           workflow_name = excluded.workflow_name,
           schedule_cron = excluded.schedule_cron,
           enabled = 1,
           updated_at = datetime('now')`
      )
      .run(id, def.owner_user_id, def.name, cronExpr);
  };

  if (definitionId) {
    syncOne(definitionId);
    return;
  }

  const published = db().prepare(`SELECT id FROM agent_workflow_definitions WHERE status = 'published'`).all();
  const keep = new Set();
  for (const { id } of published) {
    syncOne(id);
    const still = db().prepare('SELECT 1 FROM agent_workflow_schedules WHERE definition_id = ?').get(id);
    if (still) keep.add(id);
  }
  const allReg = db().prepare('SELECT definition_id FROM agent_workflow_schedules').all();
  for (const { definition_id } of allReg) {
    if (!keep.has(definition_id)) removeWorkflowSchedule(definition_id);
  }
}

export function isWorkflowInScheduleRegistry(definitionId) {
  const row = db()
    .prepare(
      `SELECT s.definition_id FROM agent_workflow_schedules s
       INNER JOIN agent_workflow_definitions d ON d.id = s.definition_id
       INNER JOIN platform_users u ON u.id = s.owner_user_id AND u.enabled = 1
       WHERE s.definition_id = ? AND s.enabled = 1
         AND (d.paused IS NULL OR d.paused = 0)
         AND d.status = 'published'
         AND d.trigger_modes LIKE '%schedule%'`
    )
    .get(definitionId);
  return !!row;
}

/** Cross-process dedupe: only one scheduled fire per workflow per minute. */
export function claimScheduleFire(definitionId, tickMinute) {
  try {
    db()
      .prepare(
        `INSERT INTO agent_workflow_schedule_ticks (definition_id, tick_minute) VALUES (?, ?)`
      )
      .run(definitionId, tickMinute);
    return true;
  } catch {
    return false;
  }
}
