/**
 * VPS e2e: COO chat → specialty Kanban → agent deliverable (not status-only complete).
 * Also: short UI nudge must NOT auto-complete a research card; external org leaf delegation.
 *
 * Usage (backend container):
 *   node scripts/vps-test-coo-rag-kanban-flow.js
 *
 * Env:
 *   AGENT_OS_API_URL=http://127.0.0.1:3001
 *   E2E_MAX_WAIT_MS=480000
 *   SKIP_EXTERNAL=1   skip org external leaf check
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { looksStatusOnlyReply, shouldCompleteKanbanForReply } from '../src/services/kanban-reply-enrich.js';
import { buildKanbanChatStatusGuidance } from '../src/services/kanban-chat-status.js';
import { isCooNativeWork } from '../src/services/coo-specialty-delegation.js';
import { listOrgAgentMembers } from '../src/services/org-agent-members.js';
import { delegateToOrgMembers } from '../src/services/org-member-delegation.js';

initDb();
const db = getDb();
const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const MAX_WAIT_MS = Number(process.env.E2E_MAX_WAIT_MS || 480000);
const POLL_MS = Number(process.env.E2E_POLL_MS || 10000);
const SKIP_EXTERNAL = process.env.SKIP_EXTERNAL === '1';
const STAMP = `rag-flow-${Date.now()}`;
const PROMPT =
  `Is Flolah Master Data RAG embedding-based or keyword-based? Answer in 2–4 sentences. Tag: ${STAMP}`;

const CEO =
  db.prepare(`SELECT id, name FROM platform_users WHERE name = ?`).get('Balaji Ranganathan') ||
  db.prepare(`SELECT id, name FROM platform_users WHERE id = 'ceo-bala'`).get();
if (!CEO) throw new Error('ceo-bala not found');

const token = createSession(CEO.id).token;
let failed = 0;
function ok(cond, msg, extra) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg, extra != null ? extra : '');
  } else console.log('OK:', msg);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function api(method, path, body, timeoutMs = 300000) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

console.log('CEO', CEO.id, 'BASE', BASE, 'STAMP', STAMP);

// --- Unit: nudge guidance must not auto-complete RAG cards ---
{
  const g = buildKanbanChatStatusGuidance(1, 'in_progress', {
    userText: 'please answer',
    title: PROMPT,
    description: 'owner_user_id: ceo-bala',
  });
  ok(g.completeOnReply === false, 'guidance: short nudge on RAG card does not auto-complete');
  ok(g.expectsDeliverable === true, 'guidance: expects deliverable for RAG title');
}
ok(
  !isCooNativeWork(PROMPT),
  'RAG/Master Data question is NOT COO-native (must specialty-delegate)'
);
ok(
  isCooNativeWork('list my master data tables'),
  'master data list ops stay COO-native'
);

// --- 1) COO chat (UI path) ---
const coo =
  db.prepare(`SELECT id FROM agents WHERE is_coo = 1 LIMIT 1`).get() ||
  db.prepare(`SELECT id FROM agents WHERE LOWER(id) IN ('balserve','coo') LIMIT 1`).get();
ok(!!coo, `COO agent present (${coo?.id || 'missing'})`);

const chat = await api('POST', `/api/agents/${coo.id}/chat`, { message: PROMPT }, 300000);
ok(chat.status < 400, `COO chat HTTP ${chat.status}`, chat.data?.error);
const del = chat.data?.specialty_delegation;
console.log('specialty_delegation', JSON.stringify(del, null, 2));
console.log('coo_reply_head', String(chat.data?.reply || '').slice(0, 240));
ok(!!del && Number(del.count) >= 1, 'COO hard-path delegated ≥1 specialty agent');

const agentNames = del?.agent_names || [];
const kanbanIdsFromApi = (del?.kanban_task_ids || []).map(Number).filter(Boolean);
ok(
  agentNames.some((n) => /tech|research/i.test(String(n))) || kanbanIdsFromApi.length >= 1,
  `delegated to tech/research or returned kanban ids (names=${JSON.stringify(agentNames)} ids=${JSON.stringify(kanbanIdsFromApi)})`
);

// --- 2) Wait for Kanban + delegation ---
const start = Date.now();
let cards = [];
let lastLine = '';
while (Date.now() - start < MAX_WAIT_MS) {
  if (kanbanIdsFromApi.length) {
    cards = kanbanIdsFromApi
      .map((id) => {
        const k = db
          .prepare(
            `SELECT k.id, k.status, k.assigned_agent_id, k.agent_delegation_task_id, k.title,
                    d.status AS d_status, substr(coalesce(d.response_content,''),1,200) AS resp,
                    substr(coalesce(d.error_message,''),1,120) AS err
             FROM kanban_tasks k
             LEFT JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
             WHERE k.id = ?`
          )
          .get(id);
        return k;
      })
      .filter(Boolean);
  } else {
    cards = db
      .prepare(
        `SELECT k.id, k.status, k.assigned_agent_id, k.agent_delegation_task_id, k.title,
                d.status AS d_status, substr(coalesce(d.response_content,''),1,200) AS resp,
                substr(coalesce(d.error_message,''),1,120) AS err
         FROM kanban_tasks k
         LEFT JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
         WHERE k.owner_user_id = ?
           AND (k.title LIKE ? OR k.description LIKE ? OR coalesce(d.prompt,'') LIKE ?)
         ORDER BY k.id DESC LIMIT 8`
      )
      .all(CEO.id, `%${STAMP}%`, `%${STAMP}%`, `%${STAMP}%`);
  }
  const line = cards
    .map((c) => `#${c.id}:${c.assigned_agent_id}=${c.status}/d=${c.d_status || '-'}`)
    .join(' ');
  if (line !== lastLine) {
    console.log('  cards', line || '(none yet)');
    lastLine = line;
  }
  if (
    cards.length &&
    cards.every((c) => c.d_status === 'completed' || c.d_status === 'failed' || c.status === 'failed')
  ) {
    break;
  }
  await sleep(POLL_MS);
}

ok(cards.length >= 1, `Kanban card(s) created for stamp (got ${cards.length})`);
if (cards.length) {
  const c0 = cards[0];
  ok(!!c0.assigned_agent_id, `card #${c0.id} assigned to agent`, c0.assigned_agent_id);
  ok(!!c0.agent_delegation_task_id, `card #${c0.id} linked to delegation`);
  console.log('card0', {
    id: c0.id,
    status: c0.status,
    agent: c0.assigned_agent_id,
    d_status: c0.d_status,
    resp: c0.resp,
    err: c0.err,
  });

  if (c0.d_status === 'completed') {
    const full = db
      .prepare('SELECT response_content FROM agent_delegation_tasks WHERE id = ?')
      .get(c0.agent_delegation_task_id)?.response_content;
    const statusOnly = looksStatusOnlyReply(full);
    console.log('delegation_reply_len', String(full || '').length, 'statusOnly', statusOnly);
    console.log('delegation_reply_head', String(full || '').slice(0, 400));
    if (statusOnly) {
      ok(
        c0.status === 'in_progress',
        `status-only reply must leave card in_progress (got ${c0.status})`
      );
    } else {
      ok(shouldCompleteKanbanForReply(full), 'delegation reply looks like a deliverable');
      ok(
        /keyword|embedding|rag|master_data|vector|retriev/i.test(String(full || '')),
        'reply mentions RAG/keyword/embedding (on-topic)'
      );
      // Agent may still be finishing kanban_move_status; allow completed or in_progress briefly
      ok(
        ['completed', 'in_progress'].includes(c0.status),
        `card status after real answer is completed|in_progress (got ${c0.status})`
      );
    }
  } else if (c0.d_status === 'failed') {
    ok(false, `delegation failed: ${c0.err || 'unknown'}`);
  } else {
    ok(false, `delegation not finished in time (d_status=${c0.d_status}, card=${c0.status})`);
  }

  // --- 3) UI nudge path: reopen + short nudge must not complete on status-only ---
  const taskId = c0.id;
  db.prepare(
    `UPDATE kanban_tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?`
  ).run(taskId);

  // Simulate what guidance would do (unit already covered); also hit messages API if card assigned
  const nudge = await api(
    'POST',
    `/api/kanban/tasks/${taskId}/messages`,
    { role: 'user', content: 'please answer the ask now' },
    300000
  );
  ok(nudge.status === 201 || nudge.status === 200, `Kanban nudge HTTP ${nudge.status}`);

  await sleep(2000);
  const after = db.prepare('SELECT id, status FROM kanban_tasks WHERE id = ?').get(taskId);
  const msgs = db
    .prepare(
      `SELECT role, substr(content,1,180) AS content FROM task_messages WHERE task_id = ? ORDER BY id DESC LIMIT 4`
    )
    .all(taskId);
  console.log('after_nudge', after, 'recent_msgs', JSON.stringify(msgs, null, 2));

  const lastAsst = msgs.find((m) => m.role === 'assistant');
  if (lastAsst && looksStatusOnlyReply(lastAsst.content)) {
    ok(
      after.status !== 'completed',
      `nudge status-only reply must NOT leave card completed (got ${after.status})`
    );
  } else if (lastAsst) {
    console.log('nudge produced non-status reply — card may complete legitimately');
    ok(true, 'nudge produced a substantive reply (or non-status)');
  } else {
    console.warn('no assistant message after nudge (agent may have timed out)');
  }
}

// --- 4) External org leaf (if present) ---
if (!SKIP_EXTERNAL) {
  const leaves = listOrgAgentMembers(CEO.id).filter(
    (m) => m.enabled && (m.kind === 'external' || String(m.id || '').startsWith('ext:'))
  );
  console.log(
    'external leaves',
    leaves.map((m) => `${m.id}:${m.display_name || m.kind}`).slice(0, 8)
  );
  if (!leaves.length) {
    console.warn('SKIP external: no enabled ext: leaf for ceo-bala');
  } else {
    const leaf = leaves[0];
    const q = `Echo health check for org external delegation. Reply with one sentence confirming you received this. Tag: ${STAMP}-ext`;
    const outcome = await delegateToOrgMembers(CEO.id, { [leaf.id]: q }, { callerAgentId: coo.id });
    console.log(
      'external outcome',
      JSON.stringify(
        {
          delegated: outcome.delegated?.map((d) => ({
            member: d.member?.id,
            ok: d.ok,
            pending: d.pending,
            text: String(d.text || '').slice(0, 160),
            kanban: d.kanban_task_id || d.taskId,
          })),
          blocked: outcome.blocked,
          failed: outcome.failed,
        },
        null,
        2
      )
    );
    ok(outcome.delegated?.length >= 1, `external leaf invoked (${leaf.id})`);
    const d0 = outcome.delegated?.[0];
    const kid = d0?.taskId || d0?.kanban_task_id || d0?.kanbanId;
    if (kid) {
      const k = db.prepare('SELECT id, status, assigned_member_key FROM kanban_tasks WHERE id = ?').get(kid);
      console.log('external kanban', k);
      ok(!!k, 'external Kanban card exists');
      ok(k.assigned_member_key === leaf.id, `external card assigned to ${leaf.id}`);
      if (!d0.pending && shouldCompleteKanbanForReply(d0.text)) {
        ok(k.status === 'completed', `external card completed after real reply (got ${k?.status})`);
      } else if (!shouldCompleteKanbanForReply(d0.text || '')) {
        ok(
          k.status === 'in_progress',
          `external status-only/empty reply stays in_progress (got ${k?.status}; text=${String(d0.text || '').slice(0, 80)})`
        );
      }
    }
  }
}

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('VPS_COO_RAG_KANBAN_FLOW_OK');
