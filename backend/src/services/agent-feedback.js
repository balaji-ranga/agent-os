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
 * Summarize past feedback (+ kanban actions) for agent learnings.
 * @param {{ ownerUserId: string, agentId?: string, topic?: string, days?: number }}
 */
export async function summarizeLearnings({
  ownerUserId,
  agentId = null,
  topic = '',
  days = 30,
} = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id required');
  const dayWindow = Math.max(1, Math.min(Math.floor(Number(days) || 30), 365));
  const feedback = listFeedback({
    ownerUserId: owner,
    agentId,
    days: dayWindow,
    limit: 100,
  });
  const kanbanActions = listKanbanLearningActions({
    ownerUserId: owner,
    agentId,
    days: dayWindow,
    limit: 40,
  });

  const topicText = String(topic || '').trim() || 'general task quality and past mistakes';
  const feedbackLines = feedback.map(
    (f, i) =>
      `${i + 1}. [${f.rating}] agent=${f.agent_id} source=${f.source} at=${f.created_at}` +
      `\n   response: ${String(f.message_content || '').slice(0, 400)}` +
      (f.comment ? `\n   user comment: ${f.comment}` : '')
  );
  const kanbanLines = kanbanActions.map(
    (a, i) =>
      `${i + 1}. ${a.type} task=#${a.task_id} "${a.task_title}" agent=${a.agent_id || 'n/a'} at=${a.created_at}` +
      (a.comment ? `\n   note: ${a.comment}` : '')
  );

  if (!feedbackLines.length && !kanbanLines.length) {
    return {
      owner_user_id: owner,
      agent_id: agentId || null,
      days: dayWindow,
      topic: topicText,
      feedback_count: 0,
      kanban_action_count: 0,
      summary:
        'No stored user feedback or Kanban approve/reject/comment actions in the selected window. Proceed carefully and ask clarifying questions.',
      feedback_sample: [],
      kanban_actions_sample: [],
    };
  }

  const prompt = `You are summarizing user feedback so an AI agent can avoid past mistakes and repeat what worked.

Topic focus: ${topicText}
Owner (CEO) id: ${owner}
Agent filter: ${agentId || 'all agents for this user'}
Window: last ${dayWindow} days

## Response feedback (thumbs up/down)
${feedbackLines.join('\n') || '(none)'}

## Kanban CEO actions (approve / reject / comments)
${kanbanLines.join('\n') || '(none)'}

Write a concise learnings summary (bullets) covering:
1. What the user disliked / rejected — avoid these patterns.
2. What the user liked / approved — prefer these patterns.
3. Concrete do/don't guidance for the next task on this topic.
Keep under 400 words.`;

  let summary;
  try {
    const { content } = await chatCompletions({
      messages: [
        { role: 'system', content: 'Summarize agent learnings for improvement. Be specific and actionable.' },
        { role: 'user', content: prompt },
      ],
      maxTokens: 800,
      ownerUserId: owner,
    });
    summary = String(content || '').trim() || 'Unable to produce summary text.';
  } catch (e) {
    // Fallback without LLM
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
      topicText ? `- Topic focus: ${topicText}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return {
    owner_user_id: owner,
    agent_id: agentId || null,
    days: dayWindow,
    topic: topicText,
    feedback_count: feedback.length,
    kanban_action_count: kanbanActions.length,
    summary,
    feedback_sample: feedback.slice(0, 10),
    kanban_actions_sample: kanbanActions.slice(0, 10),
  };
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
