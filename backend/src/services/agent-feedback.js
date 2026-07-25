/**
 * Per-user + per-agent response feedback and learnings summary.
 * Stored in the CEO's pointed SQLite (tenant ceo.db or shared platform DB).
 */
import { getDbForCeo } from '../db/request-db.js';
import { getDb } from '../db/schema.js';
import { chatCompletions } from '../config/llm.js';

export const FEEDBACK_RATINGS = Object.freeze(['up', 'down']);
export const FEEDBACK_SOURCES = Object.freeze([
  'chat',
  'kanban',
  'workflow_builder',
  'standup',
  'workspace',
  'other',
]);

const FEEDBACK_TABLE_SQL = `
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
  );
  CREATE INDEX IF NOT EXISTS idx_agent_feedback_owner_agent
    ON agent_response_feedback(owner_user_id, agent_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_agent_feedback_owner_created
    ON agent_response_feedback(owner_user_id, created_at DESC);
`;

export function ensureFeedbackTable(db) {
  if (!db) return;
  db.exec(FEEDBACK_TABLE_SQL);
}

function dbForOwner(ownerUserId) {
  const db = getDbForCeo(ownerUserId);
  ensureFeedbackTable(db);
  return db;
}

function normalizeRating(rating) {
  const r = String(rating || '')
    .trim()
    .toLowerCase();
  if (r === 'up' || r === 'positive' || r === 'good' || r === 'thumbsup' || r === '1') return 'up';
  if (r === 'down' || r === 'negative' || r === 'bad' || r === 'thumbsdown' || r === '0') return 'down';
  throw new Error('rating must be up or down');
}

function normalizeSource(source) {
  const s = String(source || 'chat')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (FEEDBACK_SOURCES.includes(s)) return s;
  return 'other';
}

/**
 * Persist user feedback against owner + agent (strict tenancy via ownerUserId).
 */
export function storeFeedback({
  ownerUserId,
  agentId,
  source = 'chat',
  messageId = null,
  messageRole = 'assistant',
  messageContent = '',
  rating,
  comment = '',
  context = {},
} = {}) {
  const owner = String(ownerUserId || '').trim();
  const agent = String(agentId || '').trim();
  if (!owner) throw new Error('owner_user_id required');
  if (!agent) throw new Error('agent_id required');
  const normalizedRating = normalizeRating(rating);
  const db = dbForOwner(owner);
  const info = db
    .prepare(
      `INSERT INTO agent_response_feedback
        (owner_user_id, agent_id, source, message_id, message_role, message_content, rating, comment, context_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      owner,
      agent,
      normalizeSource(source),
      messageId != null ? String(messageId) : null,
      String(messageRole || 'assistant'),
      String(messageContent || '').slice(0, 8000),
      normalizedRating,
      String(comment || '').slice(0, 4000),
      JSON.stringify(context && typeof context === 'object' ? context : {})
    );
  return getFeedbackById(owner, info.lastInsertRowid);
}

export function getFeedbackById(ownerUserId, id) {
  const owner = String(ownerUserId || '').trim();
  const db = dbForOwner(owner);
  const row = db
    .prepare(
      `SELECT * FROM agent_response_feedback WHERE id = ? AND owner_user_id = ?`
    )
    .get(Number(id), owner);
  return row ? mapFeedbackRow(row) : null;
}

function mapFeedbackRow(row) {
  let context = {};
  try {
    context = JSON.parse(row.context_json || '{}') || {};
  } catch {
    context = {};
  }
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    agent_id: row.agent_id,
    source: row.source,
    message_id: row.message_id,
    message_role: row.message_role,
    message_content: row.message_content,
    rating: row.rating,
    comment: row.comment || '',
    context,
    created_at: row.created_at,
  };
}

/**
 * List feedback for owner (+ optional agent). Strict owner filter.
 */
export function listFeedback({
  ownerUserId,
  agentId = null,
  limit = 50,
  days = null,
  rating = null,
  sinceId = null,
} = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id required');
  const db = dbForOwner(owner);
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const clauses = ['owner_user_id = ?'];
  const params = [owner];
  if (agentId) {
    clauses.push('agent_id = ?');
    params.push(String(agentId).trim());
  }
  if (days != null && Number(days) > 0) {
    clauses.push(`created_at >= datetime('now', ?)`);
    params.push(`-${Math.floor(Number(days))} days`);
  }
  if (rating) {
    clauses.push('rating = ?');
    params.push(normalizeRating(rating));
  }
  if (sinceId != null && Number(sinceId) > 0) {
    clauses.push('id > ?');
    params.push(Number(sinceId));
  }
  params.push(lim);
  const rows = db
    .prepare(
      `SELECT * FROM agent_response_feedback
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(...params);
  return rows.map(mapFeedbackRow);
}

/**
 * Collect Kanban approve/reject/comment actions for this owner (+ optional agent) in the window.
 * Uses task_messages content patterns written by workflow CEO approval.
 */
export function listKanbanLearningActions({ ownerUserId, agentId = null, days = 30, limit = 40 } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return [];
  const db = dbForOwner(owner);
  const dayWindow = Math.max(1, Math.floor(Number(days) || 30));
  const lim = Math.min(Math.max(Number(limit) || 40, 1), 100);

  let tasks;
  try {
    tasks = db
      .prepare(
        `SELECT id, title, description, status, assigned_agent_id, updated_at
         FROM kanban_tasks
         WHERE updated_at >= datetime('now', ?)
         ORDER BY updated_at DESC
         LIMIT 200`
      )
      .all(`-${dayWindow} days`);
  } catch {
    return [];
  }

  const ownerNeedle = owner.toLowerCase();
  const filtered = tasks.filter((t) => {
    const desc = String(t.description || '').toLowerCase();
    const owned =
      desc.includes(`owner_user_id:${ownerNeedle}`) ||
      desc.includes(`owner_user_id=${ownerNeedle}`) ||
      desc.includes(`ceo_user_id:${ownerNeedle}`) ||
      desc.includes(`ceo_user_id=${ownerNeedle}`) ||
      desc.includes(`"owner_user_id":"${ownerNeedle}"`) ||
      desc.includes(`"ceo_user_id":"${ownerNeedle}"`);
    // Shared-DB tenants without metadata: still include if assigned agent matches filter and we cannot prove foreign ownership
    if (!owned && !desc.includes('owner_user_id') && !desc.includes('ceo_user_id')) {
      // Legacy/shared tasks — include cautiously when agent filter matches
      if (agentId && String(t.assigned_agent_id || '').toLowerCase() === String(agentId).toLowerCase()) {
        return true;
      }
      return false;
    }
    if (agentId && t.assigned_agent_id && String(t.assigned_agent_id).toLowerCase() !== String(agentId).toLowerCase()) {
      return false;
    }
    return owned;
  });

  const out = [];
  for (const task of filtered.slice(0, lim)) {
    let messages = [];
    try {
      messages = db
        .prepare(
          `SELECT id, role, content, created_at FROM task_messages
           WHERE task_id = ? AND created_at >= datetime('now', ?)
           ORDER BY created_at DESC LIMIT 20`
        )
        .all(task.id, `-${dayWindow} days`);
    } catch {
      messages = [];
    }
    const decisions = messages.filter((m) =>
      /\[CEO (approved|rejected)\]/i.test(String(m.content || ''))
    );
    for (const m of decisions) {
      const approved = /\[CEO approved\]/i.test(m.content);
      out.push({
        type: approved ? 'kanban_approve' : 'kanban_reject',
        task_id: task.id,
        task_title: task.title,
        agent_id: task.assigned_agent_id,
        comment: String(m.content || '').replace(/\[CEO (approved|rejected)\]\s*/i, '').trim(),
        created_at: m.created_at,
      });
    }
    const comments = messages.filter(
      (m) => m.role === 'user' && !/\[CEO (approved|rejected)\]/i.test(String(m.content || ''))
    );
    for (const m of comments.slice(0, 3)) {
      out.push({
        type: 'kanban_comment',
        task_id: task.id,
        task_title: task.title,
        agent_id: task.assigned_agent_id,
        comment: String(m.content || '').slice(0, 500),
        created_at: m.created_at,
      });
    }
  }
  return out.slice(0, lim);
}

/**
 * Daily learnings cache (per CEO tenant DB). One row per (owner, agent).
 * Topic-agnostic base summary; a cheap topic note is appended at return time
 * (no extra LLM call). Rebuilt incrementally each new day, with a full rebuild
 * at most every LEARNINGS_FULL_REBUILD_DAYS to avoid rolling-summary drift.
 */
const LEARNINGS_CACHE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS agent_learnings_cache (
    owner_user_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    model TEXT DEFAULT '',
    last_feedback_id INTEGER DEFAULT 0,
    last_kanban_at TEXT DEFAULT '',
    feedback_count INTEGER DEFAULT 0,
    kanban_count INTEGER DEFAULT 0,
    base_generated_at TEXT DEFAULT '',
    valid_date TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (owner_user_id, agent_id)
  );
`;

const LEARNINGS_FULL_REBUILD_DAYS = Math.max(
  1,
  parseInt(process.env.LEARNINGS_FULL_REBUILD_DAYS || '7', 10) || 7
);

export function ensureLearningsCacheTable(db) {
  if (!db) return;
  db.exec(LEARNINGS_CACHE_TABLE_SQL);
}

function learningsAgentKey(agentId) {
  return String(agentId || '').trim() || '__all__';
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function ageInDays(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}

function readLearningsCache(db, owner, agentKey) {
  try {
    return (
      db
        .prepare(
          `SELECT * FROM agent_learnings_cache WHERE owner_user_id = ? AND agent_id = ?`
        )
        .get(owner, agentKey) || null
    );
  } catch {
    return null;
  }
}

function writeLearningsCache(db, row) {
  db.prepare(
    `INSERT INTO agent_learnings_cache
       (owner_user_id, agent_id, summary, model, last_feedback_id, last_kanban_at,
        feedback_count, kanban_count, base_generated_at, valid_date, updated_at)
     VALUES (@owner_user_id, @agent_id, @summary, @model, @last_feedback_id, @last_kanban_at,
        @feedback_count, @kanban_count, @base_generated_at, @valid_date, @updated_at)
     ON CONFLICT(owner_user_id, agent_id) DO UPDATE SET
        summary = excluded.summary,
        model = excluded.model,
        last_feedback_id = excluded.last_feedback_id,
        last_kanban_at = excluded.last_kanban_at,
        feedback_count = excluded.feedback_count,
        kanban_count = excluded.kanban_count,
        base_generated_at = excluded.base_generated_at,
        valid_date = excluded.valid_date,
        updated_at = excluded.updated_at`
  ).run(row);
}

function feedbackToLines(feedback) {
  return feedback.map(
    (f, i) =>
      `${i + 1}. [${f.rating}] agent=${f.agent_id} source=${f.source} at=${f.created_at}` +
      `\n   response: ${String(f.message_content || '').slice(0, 400)}` +
      (f.comment ? `\n   user comment: ${f.comment}` : '')
  );
}

function kanbanToLines(kanbanActions) {
  return kanbanActions.map(
    (a, i) =>
      `${i + 1}. ${a.type} task=#${a.task_id} "${a.task_title}" agent=${a.agent_id || 'n/a'} at=${a.created_at}` +
      (a.comment ? `\n   note: ${a.comment}` : '')
  );
}

/** Deterministic per-call topic note (no LLM). Hybrid: general cache + topic focus. */
function topicFocusNote(topic) {
  const t = String(topic || '').trim();
  if (!t) return '';
  return `\n\n---\nFocus for this request: "${t}". Apply the do/don't learnings above to this topic; prefer the "liked" patterns and avoid the "disliked" ones.`;
}

/**
 * Summarize past feedback (+ kanban actions) for agent learnings.
 *
 * Caching (per CEO tenant DB, keyed by owner+agent, topic-agnostic):
 *  - Cache hit (same UTC day): return cached summary, no LLM call.
 *  - New day + new feedback since watermark: incremental merge (prev summary + delta).
 *  - New day + no new feedback: bump valid_date, return cached summary (no LLM call).
 *  - No cache / stale base (> LEARNINGS_FULL_REBUILD_DAYS): full rebuild.
 *  - No stored feedback at all: cheap canned message (no LLM, not cached).
 *
 * @param {{ ownerUserId: string, agentId?: string, topic?: string, days?: number, force?: boolean }}
 */
export async function summarizeLearnings({
  ownerUserId,
  agentId = null,
  topic = '',
  days = 30,
  force = false,
} = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id required');
  const dayWindow = Math.max(1, Math.min(Math.floor(Number(days) || 30), 365));
  const agentKey = learningsAgentKey(agentId);
  const topicText = String(topic || '').trim() || 'general task quality and past mistakes';
  const note = topicFocusNote(topic);

  const db = dbForOwner(owner);
  ensureLearningsCacheTable(db);

  // Cheap DB reads (no LLM) — used for counts + samples on every path.
  const feedback = listFeedback({ ownerUserId: owner, agentId, days: dayWindow, limit: 100 });
  const kanbanActions = listKanbanLearningActions({
    ownerUserId: owner,
    agentId,
    days: dayWindow,
    limit: 40,
  });

  const baseResult = {
    owner_user_id: owner,
    agent_id: agentId || null,
    days: dayWindow,
    topic: topicText,
    feedback_count: feedback.length,
    kanban_action_count: kanbanActions.length,
    feedback_sample: feedback.slice(0, 10),
    kanban_actions_sample: kanbanActions.slice(0, 10),
  };

  // No data at all → cheap canned message, no LLM, not cached (so it refreshes
  // for free once feedback exists).
  if (!feedback.length && !kanbanActions.length) {
    return {
      ...baseResult,
      summary:
        'No stored user feedback or Kanban approve/reject/comment actions in the selected window. Proceed carefully and ask clarifying questions.',
      cached: false,
      mode: 'no_data',
    };
  }

  const today = todayUtc();
  const cache = readLearningsCache(db, owner, agentKey);

  // Daily-only cache hit: same UTC day → serve cached summary, no LLM.
  if (!force && cache && cache.valid_date === today && cache.summary) {
    return {
      ...baseResult,
      summary: cache.summary + note,
      cached: true,
      mode: 'cache_hit',
      generated_at: cache.base_generated_at || cache.updated_at || null,
    };
  }

  const maxFeedbackId = feedback.reduce((m, f) => Math.max(m, Number(f.id) || 0), 0);
  const maxKanbanAt = kanbanActions.reduce(
    (m, a) => (String(a.created_at || '') > m ? String(a.created_at) : m),
    ''
  );

  const needFull =
    force ||
    !cache ||
    !cache.summary ||
    !cache.base_generated_at ||
    ageInDays(cache.base_generated_at) >= LEARNINGS_FULL_REBUILD_DAYS;

  // Incremental path: new day, cache exists and base is fresh enough.
  if (!needFull) {
    const newFeedback = feedback.filter((f) => Number(f.id) > Number(cache.last_feedback_id || 0));
    const lastKanbanAt = String(cache.last_kanban_at || '');
    const newKanban = kanbanActions.filter((a) => String(a.created_at || '') > lastKanbanAt);

    if (!newFeedback.length && !newKanban.length) {
      // No new signal → just extend validity to today; no LLM call.
      writeLearningsCache(db, {
        owner_user_id: owner,
        agent_id: agentKey,
        summary: cache.summary,
        model: cache.model || '',
        last_feedback_id: cache.last_feedback_id || 0,
        last_kanban_at: cache.last_kanban_at || '',
        feedback_count: feedback.length,
        kanban_count: kanbanActions.length,
        base_generated_at: cache.base_generated_at,
        valid_date: today,
        updated_at: new Date().toISOString(),
      });
      return {
        ...baseResult,
        summary: cache.summary + note,
        cached: true,
        mode: 'no_new',
        generated_at: cache.base_generated_at || null,
      };
    }

    const prompt = `You are UPDATING an AI agent's learnings summary by merging new user feedback into the prior summary.

Owner (CEO) id: ${owner}
Agent: ${agentId || 'all agents for this user'}

## Prior learnings summary (keep still-relevant points)
${cache.summary}

## New response feedback since last update (thumbs up/down)
${feedbackToLines(newFeedback).join('\n') || '(none)'}

## New Kanban CEO actions since last update (approve / reject / comments)
${kanbanToLines(newKanban).join('\n') || '(none)'}

Produce an UPDATED concise learnings summary (bullets) with these sections:
1. What the user disliked / rejected — avoid these patterns.
2. What the user liked / approved — prefer these patterns. IMPORTANT: retain still-relevant liked/approved points from the prior summary even if recent feedback is mostly negative.
3. Concrete do/don't guidance for the next task.
Keep under 400 words.`;

    try {
      const { content, modelUsed } = await chatCompletions({
        messages: [
          { role: 'system', content: 'Update agent learnings for improvement. Be specific and actionable; preserve prior wins.' },
          { role: 'user', content: prompt },
        ],
        maxTokens: 800,
        ownerUserId: owner,
      });
      const summary = String(content || '').trim() || cache.summary;
      writeLearningsCache(db, {
        owner_user_id: owner,
        agent_id: agentKey,
        summary,
        model: modelUsed || cache.model || '',
        last_feedback_id: Math.max(maxFeedbackId, Number(cache.last_feedback_id || 0)),
        last_kanban_at: maxKanbanAt > lastKanbanAt ? maxKanbanAt : lastKanbanAt,
        feedback_count: feedback.length,
        kanban_count: kanbanActions.length,
        base_generated_at: cache.base_generated_at,
        valid_date: today,
        updated_at: new Date().toISOString(),
      });
      return { ...baseResult, summary: summary + note, cached: false, mode: 'incremental', generated_at: cache.base_generated_at };
    } catch (e) {
      // LLM unavailable → keep prior summary, extend validity (no drift).
      writeLearningsCache(db, {
        owner_user_id: owner,
        agent_id: agentKey,
        summary: cache.summary,
        model: cache.model || '',
        last_feedback_id: cache.last_feedback_id || 0,
        last_kanban_at: cache.last_kanban_at || '',
        feedback_count: feedback.length,
        kanban_count: kanbanActions.length,
        base_generated_at: cache.base_generated_at,
        valid_date: today,
        updated_at: new Date().toISOString(),
      });
      return { ...baseResult, summary: cache.summary + note, cached: true, mode: 'incremental_llm_error', generated_at: cache.base_generated_at };
    }
  }

  // Full rebuild path (first time, stale base, or forced).
  const feedbackLines = feedbackToLines(feedback);
  const kanbanLines = kanbanToLines(kanbanActions);
  const prompt = `You are summarizing user feedback so an AI agent can avoid past mistakes and repeat what worked.

Owner (CEO) id: ${owner}
Agent filter: ${agentId || 'all agents for this user'}
Window: last ${dayWindow} days

## Response feedback (thumbs up/down)
${feedbackLines.join('\n') || '(none)'}

## Kanban CEO actions (approve / reject / comments)
${kanbanLines.join('\n') || '(none)'}

Write a concise, topic-agnostic learnings summary (bullets) covering:
1. What the user disliked / rejected — avoid these patterns.
2. What the user liked / approved — prefer these patterns.
3. Concrete do/don't guidance for future tasks.
Keep under 400 words.`;

  let summary;
  let usedModel = '';
  try {
    const { content, modelUsed } = await chatCompletions({
      messages: [
        { role: 'system', content: 'Summarize agent learnings for improvement. Be specific and actionable.' },
        { role: 'user', content: prompt },
      ],
      maxTokens: 800,
      ownerUserId: owner,
    });
    summary = String(content || '').trim() || 'Unable to produce summary text.';
    usedModel = modelUsed || '';
  } catch (e) {
    const downs = feedback.filter((f) => f.rating === 'down').length;
    const ups = feedback.filter((f) => f.rating === 'up').length;
    const rejects = kanbanActions.filter((a) => a.type === 'kanban_reject').length;
    const approves = kanbanActions.filter((a) => a.type === 'kanban_approve').length;
    summary = [
      `Learnings (raw fallback; LLM unavailable: ${e.message}):`,
      `- Feedback: ${ups} up, ${downs} down over ${dayWindow} days.`,
      `- Kanban: ${approves} approvals, ${rejects} rejections.`,
      downs || rejects
        ? '- Prioritize fixing patterns that received thumbs-down or CEO rejects.'
        : '- No strong negative signal; keep asking clarifying questions.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // Only persist a stable (LLM or deterministic) summary to the daily cache.
  writeLearningsCache(db, {
    owner_user_id: owner,
    agent_id: agentKey,
    summary,
    model: usedModel,
    last_feedback_id: maxFeedbackId,
    last_kanban_at: maxKanbanAt,
    feedback_count: feedback.length,
    kanban_count: kanbanActions.length,
    base_generated_at: new Date().toISOString(),
    valid_date: today,
    updated_at: new Date().toISOString(),
  });

  return { ...baseResult, summary: summary + note, cached: false, mode: 'full', generated_at: new Date().toISOString() };
}

/** Grant learnings_summary to every agent that has any tool grants (or all agents). */
export function grantLearningsSummaryToAllAgents() {
  const db = getDb();
  const agents = db.prepare('SELECT id FROM agents').all();
  const ins = db.prepare(
    'INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)'
  );
  let n = 0;
  for (const a of agents) {
    const r = ins.run(a.id, 'learnings_summary');
    if (r.changes) n += 1;
  }
  return n;
}

export function grantEmailSendToAllAgents() {
  const db = getDb();
  const agents = db.prepare('SELECT id FROM agents').all();
  const ins = db.prepare(
    'INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)'
  );
  let n = 0;
  for (const a of agents) {
    const r = ins.run(a.id, 'email_send');
    if (r.changes) n += 1;
  }
  return n;
}

export function grantNotifyCeoToAllAgents() {
  const db = getDb();
  const agents = db.prepare('SELECT id FROM agents').all();
  const ins = db.prepare(
    'INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)'
  );
  let n = 0;
  for (const a of agents) {
    const r = ins.run(a.id, 'notify_ceo');
    if (r.changes) n += 1;
  }
  return n;
}

const KANBAN_TOOL_NAMES = [
  'kanban_create_task',
  'kanban_move_status',
  'kanban_reassign_to_coo',
];

/** Grant Kanban create/move/reassign tools to all agents (owner-scoped at invoke time). */
export function grantKanbanToolsToAllAgents() {
  const db = getDb();
  const agents = db.prepare('SELECT id FROM agents').all();
  const ins = db.prepare(
    'INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)'
  );
  let n = 0;
  for (const a of agents) {
    for (const tool of KANBAN_TOOL_NAMES) {
      const r = ins.run(a.id, tool);
      if (r.changes) n += 1;
    }
  }
  return n;
}

const MASTER_DATA_TOOL_NAMES = [
  'master_data_list_tables',
  'master_data_list_rows',
  'master_data_insert_row',
  'master_data_update_row',
  'master_data_delete_row',
  'master_data_list_documents',
  'master_data_rag',
];

/** Grant Master Data + RAG content tools to all agents (owner-scoped at invoke time). */
export function grantMasterDataToolsToAllAgents() {
  const db = getDb();
  const agents = db.prepare('SELECT id FROM agents').all();
  const ins = db.prepare(
    'INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)'
  );
  let n = 0;
  for (const a of agents) {
    for (const tool of MASTER_DATA_TOOL_NAMES) {
      const r = ins.run(a.id, tool);
      if (r.changes) n += 1;
    }
  }
  return n;
}
