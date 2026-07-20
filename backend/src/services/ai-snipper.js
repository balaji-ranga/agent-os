/**
 * AI Snipper — CEO usage summary (prompts, agents, tokens) over 7/14/30 days.
 * Aggregates chat_turns + workflow chat + tool logs.
 * Tokens are estimated from content length (~4 chars/token) until real usage metering is persisted.
 */
import { getDb } from '../db/schema.js';
import { chatOwnerIdsForRead } from './agent-chat-scope.js';
import { listAgentsForUser } from './users.js';

function clampDays(days) {
  const n = Number(days);
  if (n === 30) return 30;
  if (n === 14) return 14;
  if (n === 7) return 7;
  if (Number.isFinite(n) && n >= 1 && n <= 90) return Math.floor(n);
  return 7;
}

/** Local calendar YYYY-MM-DD keys for the window (oldest → today). */
function dayKeys(days) {
  const keys = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    keys.push(`${yyyy}-${mm}-${dd}`);
  }
  return keys;
}

function ownerPlaceholders(ids) {
  return ids.map(() => '?').join(',');
}

function charsToTokens(chars) {
  return Math.ceil(Math.max(0, Number(chars) || 0) / 4);
}

function sumField(rows, field) {
  return rows.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
}

/**
 * @param {string} ownerUserId
 * @param {{ days?: number }} [opts]
 */
export function getAiSnipperSummary(ownerUserId, { days = 7 } = {}) {
  const windowDays = clampDays(days);
  const keys = dayKeys(windowDays);
  const startDay = keys[0];
  const endDay = keys[keys.length - 1];
  const ownerIds = chatOwnerIdsForRead(ownerUserId);
  const db = getDb();
  const ph = ownerPlaceholders(ownerIds);

  // Calendar-day filter so SQL day buckets always align with timeline keys (no dropped edge rows).
  const dayFilter = `date(created_at, 'localtime') >= ? AND date(created_at, 'localtime') <= ?`;

  const chatPromptRows = db
    .prepare(
      `SELECT date(created_at, 'localtime') AS day, COUNT(*) AS prompts
       FROM chat_turns
       WHERE role = 'user'
         AND owner_user_id IN (${ph})
         AND ${dayFilter}
       GROUP BY date(created_at, 'localtime')`
    )
    .all(...ownerIds, startDay, endDay);

  const chatTokenRows = db
    .prepare(
      `SELECT date(created_at, 'localtime') AS day, SUM(LENGTH(COALESCE(content, ''))) AS chars
       FROM chat_turns
       WHERE owner_user_id IN (${ph})
         AND ${dayFilter}
       GROUP BY date(created_at, 'localtime')`
    )
    .all(...ownerIds, startDay, endDay);

  const agentsPerDay = db
    .prepare(
      `SELECT date(created_at, 'localtime') AS day, COUNT(DISTINCT agent_id) AS agents
       FROM chat_turns
       WHERE role = 'user'
         AND owner_user_id IN (${ph})
         AND ${dayFilter}
       GROUP BY date(created_at, 'localtime')`
    )
    .all(...ownerIds, startDay, endDay);

  const agentsActiveRow = db
    .prepare(
      `SELECT COUNT(DISTINCT agent_id) AS c
       FROM chat_turns
       WHERE role = 'user'
         AND owner_user_id IN (${ph})
         AND ${dayFilter}`
    )
    .get(...ownerIds, startDay, endDay);

  const wfPromptRows = db
    .prepare(
      `SELECT date(created_at, 'localtime') AS day, COUNT(*) AS prompts
       FROM agent_workflow_chat_turns
       WHERE role = 'user'
         AND owner_user_id IN (${ph})
         AND ${dayFilter}
       GROUP BY date(created_at, 'localtime')`
    )
    .all(...ownerIds, startDay, endDay);

  const wfTokenRows = db
    .prepare(
      `SELECT date(created_at, 'localtime') AS day, SUM(LENGTH(COALESCE(content, ''))) AS chars
       FROM agent_workflow_chat_turns
       WHERE owner_user_id IN (${ph})
         AND ${dayFilter}
       GROUP BY date(created_at, 'localtime')`
    )
    .all(...ownerIds, startDay, endDay);

  // Include legacy owner ids (e.g. Bala → default) so tool counts match Content Tools logs.
  const toolRows = db
    .prepare(
      `SELECT date(created_at, 'localtime') AS day, COUNT(*) AS tool_calls
       FROM content_tool_logs
       WHERE owner_user_id IN (${ph})
         AND ${dayFilter}
       GROUP BY date(created_at, 'localtime')`
    )
    .all(...ownerIds, startDay, endDay);

  const agentsEntitled = listAgentsForUser(ownerUserId).length;
  const agentsActive = Number(agentsActiveRow?.c) || 0;

  const byDay = new Map();
  for (const key of keys) {
    byDay.set(key, {
      date: key,
      prompts: 0,
      agents_active: 0,
      tokens: 0,
      tool_calls: 0,
    });
  }

  const apply = (rows, fn) => {
    for (const r of rows) {
      const day = String(r.day || '').slice(0, 10);
      if (!byDay.has(day)) continue;
      fn(byDay.get(day), r);
    }
  };

  apply(chatPromptRows, (slot, r) => {
    slot.prompts += Number(r.prompts) || 0;
  });
  apply(wfPromptRows, (slot, r) => {
    slot.prompts += Number(r.prompts) || 0;
  });
  apply(chatTokenRows, (slot, r) => {
    slot.tokens += charsToTokens(r.chars);
  });
  apply(wfTokenRows, (slot, r) => {
    slot.tokens += charsToTokens(r.chars);
  });
  apply(agentsPerDay, (slot, r) => {
    slot.agents_active = Number(r.agents) || 0;
  });
  apply(toolRows, (slot, r) => {
    slot.tool_calls += Number(r.tool_calls) || 0;
  });

  const timeline = [...byDay.values()];

  // Totals from source rows (not only timeline) so a bucket mismatch cannot zero the summary.
  const totals = {
    prompts: sumField(chatPromptRows, 'prompts') + sumField(wfPromptRows, 'prompts'),
    agents: agentsEntitled,
    agents_entitled: agentsEntitled,
    agents_active: agentsActive,
    tokens:
      chatTokenRows.reduce((acc, r) => acc + charsToTokens(r.chars), 0) +
      wfTokenRows.reduce((acc, r) => acc + charsToTokens(r.chars), 0),
    tool_calls: sumField(toolRows, 'tool_calls'),
  };

  return {
    days: windowDays,
    owner_user_id: ownerUserId,
    owner_ids: ownerIds,
    since: startDay,
    until: endDay,
    tokens_estimated: true,
    totals,
    timeline,
  };
}
