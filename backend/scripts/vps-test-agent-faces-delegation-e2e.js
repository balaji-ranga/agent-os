/**
 * VPS e2e: Balaji (ceo-bala) — COO multi-delegate + direct agent faces + trivial + Vedic.
 *
 * Usage (backend container):
 *   node scripts/vps-test-agent-faces-delegation-e2e.js
 *
 * Env:
 *   AGENT_OS_API_URL=http://127.0.0.1:3001
 *   E2E_MAX_WAIT_MS=600000   (default 10m for OpenClaw delegation)
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { ensureTenantOpenClawAgent } from '../src/services/openclaw-tenant.js';
import { registerOpenClawSessionOwner } from '../src/services/tool-owner-scope.js';
import * as openclaw from '../src/gateway/openclaw.js';

initDb();
const db = getDb();
const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const MAX_WAIT_MS = Number(process.env.E2E_MAX_WAIT_MS || 600000);
const POLL_MS = Number(process.env.E2E_POLL_MS || 12000);

const CEO =
  db.prepare(`SELECT id, name, email FROM platform_users WHERE name = ?`).get('Balaji Ranganathan') ||
  db.prepare(`SELECT id, name, email FROM platform_users WHERE id = 'ceo-bala'`).get();
if (!CEO) throw new Error('Balaji Ranganathan / ceo-bala not found');

const token = createSession(CEO.id).token;
console.log('CEO', CEO.id, CEO.name);
console.log('BASE', BASE, 'MAX_WAIT_MS', MAX_WAIT_MS);

let failed = 0;
const results = [];
function ok(cond, msg, extra) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg, extra != null ? extra : '');
    results.push({ ok: false, msg, extra });
  } else {
    console.log('OK:', msg);
    results.push({ ok: true, msg });
  }
}

async function api(method, path, body, headers = {}, timeoutMs = 300000) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function toolLogsSince(sinceIso, { agentKey = null, toolName = null } = {}) {
  const rows = db
    .prepare(
      `SELECT id, tool_name, source, status, substr(request_payload,1,120) AS req,
              substr(response_payload,1,160) AS resp, created_at
       FROM content_tool_logs
       WHERE owner_user_id = ?
         AND datetime(created_at) >= datetime(?)
       ORDER BY id ASC`
    )
    .all(CEO.id, sinceIso.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace(/Z$/, ''));
  return rows.filter((r) => {
    if (toolName && r.tool_name !== toolName) return false;
    if (agentKey) {
      const s = String(r.source || '').toLowerCase();
      if (!s.includes(String(agentKey).toLowerCase())) return false;
    }
    return true;
  });
}

function kanbanById(id) {
  return db.prepare(`SELECT * FROM kanban_tasks WHERE id = ?`).get(id);
}

function delegationById(id) {
  return db.prepare(`SELECT * FROM agent_delegation_tasks WHERE id = ?`).get(id);
}

async function waitKanbanTerminal(taskIds, label) {
  const ids = (taskIds || []).filter(Boolean);
  const start = Date.now();
  let last = '';
  while (Date.now() - start < MAX_WAIT_MS) {
    const rows = ids.map((id) => kanbanById(id)).filter(Boolean);
    const statusLine = rows.map((r) => `#${r.id}:${r.assigned_agent_id}=${r.status}`).join(' ');
    if (statusLine !== last) {
      console.log(`  [${label}] ${statusLine}`);
      last = statusLine;
    }
    const allDone =
      rows.length === ids.length &&
      rows.every((r) => r.status === 'completed' || r.status === 'failed');
    if (allDone) return rows;
    // Also check delegation completion (backend may complete card after cron)
    const dels = rows
      .map((r) => (r.agent_delegation_task_id ? delegationById(r.agent_delegation_task_id) : null))
      .filter(Boolean);
    if (
      dels.length === ids.length &&
      dels.every((d) => d.status === 'completed' || d.status === 'failed')
    ) {
      // heal sync lag
      await sleep(2000);
      return ids.map((id) => kanbanById(id)).filter(Boolean);
    }
    await sleep(POLL_MS);
  }
  return ids.map((id) => kanbanById(id)).filter(Boolean);
}

function agentToolHeaders(agentId) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  const ensured = ensureTenantOpenClawAgent(agent, CEO.id);
  const ocId = ensured.openclawAgentId;
  const sessionUser = openclaw.sessionUserFor(agentId, CEO.id);
  const sessionKey = openclaw.sessionKeyFor(ocId, sessionUser);
  registerOpenClawSessionOwner(sessionKey, CEO.id);
  return {
    'x-openclaw-agent-id': ocId,
    'x-openclaw-session-key': sessionKey,
    'x-ceo-user-id': CEO.id,
  };
}

async function createAssignedKanban(agentId, title, description) {
  const headers = agentToolHeaders(agentId);
  // Create as COO so assign works cleanly
  const coo = db.prepare(`SELECT * FROM agents WHERE is_coo = 1 LIMIT 1`).get();
  const cooEnsured = ensureTenantOpenClawAgent(coo, CEO.id);
  const cooSessionUser = openclaw.sessionUserFor(coo.id, CEO.id);
  const cooKey = openclaw.sessionKeyFor(cooEnsured.openclawAgentId, cooSessionUser);
  registerOpenClawSessionOwner(cooKey, CEO.id);
  const create = await api(
    'POST',
    '/api/tools/kanban-create-task',
    { title, description, assign_to: agentId },
    {
      'x-openclaw-agent-id': cooEnsured.openclawAgentId,
      'x-openclaw-session-key': cooKey,
      'x-ceo-user-id': CEO.id,
    },
    60000
  );
  const taskId = create.data?.task_id;
  if (taskId) {
    // Move to open if awaiting_confirmation so kanban chat promotes/completes rules apply
    await api(
      'POST',
      '/api/tools/kanban-move-status',
      { task_id: taskId, new_status: 'open' },
      {
        'x-openclaw-agent-id': cooEnsured.openclawAgentId,
        'x-openclaw-session-key': cooKey,
        'x-ceo-user-id': CEO.id,
      },
      30000
    );
  }
  return { create, taskId, headers };
}

async function kanbanChat(taskId, message) {
  return api('POST', `/api/kanban/tasks/${taskId}/messages`, { content: message }, {}, 420000);
}

async function agentDashboardChat(agentId, message, timeoutMs = 420000) {
  return api('POST', `/api/agents/${encodeURIComponent(agentId)}/chat`, { message, tz: 'Asia/Singapore' }, {}, timeoutMs);
}

const mark = new Date().toISOString();
const MULTI =
  'do a deep research on AI in India and generate Indian recipe with an image';
const RESEARCH =
  'Do deep research on AI adoption in India. Call learnings_summary first. Then summarize_url on these sources (retry other reputable URLs if any fail): https://en.wikipedia.org/wiki/Artificial_intelligence_in_India and https://www.meity.gov.in/ — Your reply MUST include the research brief body with citations (not only a status sentence). When the brief is in your reply, mark Kanban completed. Do not mark failed if you delivered a substantive brief.';
const RECIPE =
  'Create a detailed Indian cuisine recipe (chicken biryani for 4) and generate an image of the dish. Use learnings_summary first. Your reply MUST include the full Ingredients list, step-by-step Instructions, and the image markdown (not only a status sentence). Do NOT call master_data_* unless a recipes table already exists (list tables first). When recipe+image are in your reply, mark Kanban completed — do not mark failed for optional storage errors.';

console.log('\n========== 1) COO multi-intent delegation ==========');
{
  const beforeIds = new Set(
    db
      .prepare(`SELECT id FROM kanban_tasks WHERE owner_user_id = ? ORDER BY id DESC LIMIT 30`)
      .all(CEO.id)
      .map((r) => r.id)
  );
  const t0 = new Date().toISOString();
  const chat = await agentDashboardChat('balserve', MULTI, 240000);
  ok(chat.status < 400, `COO chat HTTP ${chat.status}`, chat.data?.error);
  const del = chat.data?.specialty_delegation;
  console.log('COO reply:', String(chat.data?.reply || '').slice(0, 280));
  console.log('specialty_delegation', JSON.stringify(del, null, 2));
  ok(!!del, 'specialty_delegation present');
  const names = (del?.agent_names || []).map(String);
  const count = Number(del?.count || 0);
  ok(count === 2, `delegated exactly 2 agents (got ${count}: ${names.join(', ')})`);
  ok(
    names.some((n) => /tech|research/i.test(n)) ||
      (del?.kanban_task_ids || []).some((id) => /techresearcher/i.test(kanbanById(id)?.assigned_agent_id || '')),
    'includes TechResearcher'
  );
  ok(
    names.some((n) => /social/i.test(n)) ||
      (del?.kanban_task_ids || []).some((id) => /socialasstant/i.test(kanbanById(id)?.assigned_agent_id || '')),
    'includes SocialAssistant'
  );

  let kanbanIds = (del?.kanban_task_ids || []).map(Number).filter(Boolean);
  if (!kanbanIds.length) {
    const fresh = db
      .prepare(
        `SELECT id, assigned_agent_id, title, status FROM kanban_tasks
         WHERE owner_user_id = ? AND id NOT IN (${[...beforeIds].map(() => '?').join(',') || '0'})
         ORDER BY id DESC LIMIT 10`
      )
      .all(CEO.id, ...[...beforeIds]);
    console.log('fresh kanban', fresh);
    kanbanIds = fresh
      .filter((t) => t.assigned_agent_id === 'techresearcher' || t.assigned_agent_id === 'socialasstant')
      .map((t) => t.id);
  }
  ok(kanbanIds.length >= 2, `kanban tasks created (${kanbanIds.join(',')})`);

  console.log('Waiting for OpenClaw delegation runs to finish…');
  const finalRows = await waitKanbanTerminal(kanbanIds, 'COO-delegated');
  for (const row of finalRows) {
    ok(
      row.status === 'completed',
      `kanban #${row.id} (${row.assigned_agent_id}) completed`,
      row.status
    );
  }

  const logs = toolLogsSince(t0);
  const learnings = logs.filter((l) => l.tool_name === 'learnings_summary' && String(l.status).toLowerCase() === 'ok');
  console.log(
    'tool log sample',
    logs.slice(-12).map((l) => `${l.tool_name}@${l.source}=${l.status}`)
  );
  // Soft prefer learnings — agents should call it; warn but still check at least some successful tools
  if (!learnings.length) {
    console.warn('WARN: no learnings_summary ok in window (agents may still have been instructed)');
  } else {
    ok(true, `learnings_summary used (${learnings.length})`);
  }
  const okTools = logs.filter((l) => String(l.status).toLowerCase() === 'ok');
  ok(okTools.length > 0, `at least one successful content tool in COO window (${okTools.length})`);
}

console.log('\n========== 2a) TechResearcher face (Kanban task chat) ==========');
{
  const t0 = new Date().toISOString();
  const { taskId, create } = await createAssignedKanban(
    'techresearcher',
    `E2E AI India research ${Date.now()}`,
    RESEARCH
  );
  ok(!!taskId, `created tech kanban task`, create.data?.error);
  if (taskId) {
    const msg = await kanbanChat(taskId, RESEARCH);
    ok(msg.status < 400, `tech kanban chat HTTP ${msg.status}`, msg.data?.error);
    const reply = String(msg.data?.content || msg.data?.reply || '');
    // assistant reply is stored as separate row; fetch messages
    const msgs = await api('GET', `/api/kanban/tasks/${taskId}/messages`);
    const list = Array.isArray(msgs.data) ? msgs.data : msgs.data?.messages || [];
    const assistant = list
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
      .join('\n');
    const text = assistant || reply;
    console.log('tech reply snippet:', text.slice(0, 360));
    ok(text.length > 200, 'tech delivered substantive research reply');
    ok(!/^\[Error from agent:/i.test(text), 'tech reply not an agent error');

    // Wait a bit for agent tool moves, then check status
    await sleep(3000);
    let row = kanbanById(taskId);
    if (row && row.status !== 'completed' && row.status !== 'failed') {
      // Poll briefly — agent may still call completed
      const end = Date.now() + 90000;
      while (Date.now() < end && row && row.status !== 'completed' && row.status !== 'failed') {
        await sleep(8000);
        row = kanbanById(taskId);
        console.log(`  [tech] #${taskId}=${row?.status}`);
      }
    }
    // For long research, platform may not auto-complete — agent should. If still open/in_progress after reply with deliverable, fail.
    row = kanbanById(taskId);
    ok(
      row?.status === 'completed',
      `tech kanban #${taskId} completed by agent after deliverable`,
      row?.status
    );

    const logs = toolLogsSince(t0, { agentKey: 'techresearcher' });
    const learn = logs.filter((l) => l.tool_name === 'learnings_summary' && String(l.status).toLowerCase() === 'ok');
    const sum = logs.filter((l) => l.tool_name === 'summarize_url' && String(l.status).toLowerCase() === 'ok');
    console.log(
      'tech tools',
      logs.map((l) => `${l.tool_name}=${l.status}`).slice(-15)
    );
    ok(learn.length > 0, `tech called learnings_summary ok (${learn.length})`);
    if (!sum.length) {
      console.warn('WARN: tech did not call summarize_url successfully (may have used browser/knowledge)');
    } else {
      ok(true, `tech summarize_url ok (${sum.length})`);
    }
  }
}

console.log('\n========== 2b) SocialAssistant face (Kanban task chat) ==========');
{
  const t0 = new Date().toISOString();
  const { taskId, create } = await createAssignedKanban(
    'socialasstant',
    `E2E Indian recipe ${Date.now()}`,
    RECIPE
  );
  ok(!!taskId, `created social kanban task`, create.data?.error);
  if (taskId) {
    const msg = await kanbanChat(taskId, RECIPE);
    ok(msg.status < 400, `social kanban chat HTTP ${msg.status}`, msg.data?.error);
    const msgs = await api('GET', `/api/kanban/tasks/${taskId}/messages`);
    const list = Array.isArray(msgs.data) ? msgs.data : msgs.data?.messages || [];
    const text = list
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
      .join('\n');
    console.log('social reply snippet:', text.slice(0, 360));
    ok(text.length > 250, 'social delivered recipe reply');
    ok(/ingredient|biryani|recipe|cup|tsp|tbsp/i.test(text), 'social reply looks like a recipe');
    ok(/\bingredients?\b/i.test(text) && /(instruction|step|method|marinate|basmati)/i.test(text), 'social reply has ingredients+steps');
    const hasImage =
      /!\[|\/api\/media\/|generate_image/i.test(text) ||
      toolLogsSince(t0, { agentKey: 'socialasstant' }).some(
        (l) => l.tool_name === 'generate_image' && String(l.status).toLowerCase() === 'ok'
      );
    ok(hasImage, 'social produced/generated an image (reply or tool)');

    await sleep(3000);
    let row = kanbanById(taskId);
    if (row && row.status !== 'completed' && row.status !== 'failed') {
      const end = Date.now() + 90000;
      while (Date.now() < end && row && row.status !== 'completed' && row.status !== 'failed') {
        await sleep(8000);
        row = kanbanById(taskId);
        console.log(`  [social] #${taskId}=${row?.status}`);
      }
    }
    row = kanbanById(taskId);
    ok(row?.status === 'completed', `social kanban #${taskId} completed`, row?.status);

    const logs = toolLogsSince(t0, { agentKey: 'socialasstant' });
    const learn = logs.filter((l) => l.tool_name === 'learnings_summary' && String(l.status).toLowerCase() === 'ok');
    console.log(
      'social tools',
      logs.map((l) => `${l.tool_name}=${l.status}`).slice(-15)
    );
    ok(learn.length > 0, `social called learnings_summary ok (${learn.length})`);
  }
}

console.log('\n========== 3) Short trivial queries (immediate) ==========');
{
  for (const agentId of ['techresearcher', 'socialasstant', 'balserve']) {
    await api('POST', `/api/agents/${encodeURIComponent(agentId)}/sessions/new`, {}, {}, 60000).catch(() => null);
  }
  for (const [agentId, q, expectExact] of [
    ['techresearcher', 'Reply with exactly: TRIVIAL_TECH_OK', /TRIVIAL_TECH_OK/i],
    ['socialasstant', 'Reply with exactly: TRIVIAL_SOCIAL_OK', /TRIVIAL_SOCIAL_OK/i],
    ['balserve', 'Reply with exactly: TRIVIAL_COO_OK', /TRIVIAL_COO_OK/i],
  ]) {
    const t0 = Date.now();
    const chat = await agentDashboardChat(agentId, q, 120000);
    const elapsed = Date.now() - t0;
    const reply = String(chat.data?.reply || chat.data?.error || '');
    console.log(`${agentId} trivial (${elapsed}ms):`, reply.slice(0, 160));
    ok(chat.status < 400, `${agentId} trivial HTTP ${chat.status}`);
    ok(reply.length > 0 && !/^\[Error/i.test(reply), `${agentId} trivial got a reply`);
    ok(elapsed < 90000, `${agentId} trivial answered quickly (${elapsed}ms < 90s)`);
    ok(expectExact.test(reply), `${agentId} trivial exact reply`);
    ok(!chat.data?.specialty_delegation, `${agentId} trivial did not specialty-delegate`);
  }
}

console.log('\n========== 4) Vedic Astrology generic spot-check ==========');
{
  const vedic =
    db.prepare(`SELECT id, name FROM agents WHERE id LIKE '%vedic%' OR name LIKE '%Vedic%' OR name LIKE '%Astrolog%' LIMIT 5`).all();
  console.log('vedic candidates', vedic);
  const agentId = vedic.find((a) => /vedic/i.test(a.id))?.id || vedic[0]?.id;
  ok(!!agentId, `found vedic/astrology agent`, vedic);
  if (agentId) {
    const trivial = await agentDashboardChat(agentId, 'Reply with exactly: VEDIC_TRIVIAL_OK', 120000);
    ok(trivial.status < 400, `vedic trivial HTTP ${trivial.status}`, trivial.data?.error);
    ok(/VEDIC_TRIVIAL_OK/i.test(String(trivial.data?.reply || '')), 'vedic trivial exact reply');

    const t0 = new Date().toISOString();
    const { taskId, create } = await createAssignedKanban(
      agentId,
      `E2E Vedic brief ${Date.now()}`,
      'Give a short overview of what Vedic astrology covers (2-3 paragraphs). Call learnings_summary first.'
    );
    ok(!!taskId, `vedic kanban created`, create.data?.error);
    if (taskId) {
      const msg = await kanbanChat(
        taskId,
        'Give a short overview of what Vedic astrology covers (2-3 paragraphs). Call learnings_summary first, then answer. When done mark the Kanban task completed.'
      );
      ok(msg.status < 400, `vedic kanban chat HTTP ${msg.status}`, msg.data?.error);
      const msgs = await api('GET', `/api/kanban/tasks/${taskId}/messages`);
      const list = Array.isArray(msgs.data) ? msgs.data : msgs.data?.messages || [];
      const text = list
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content)
        .join('\n');
      console.log('vedic reply snippet:', text.slice(0, 280));
      ok(text.length > 120, 'vedic delivered substantive reply');

      await sleep(3000);
      let row = kanbanById(taskId);
      if (row && row.status !== 'completed' && row.status !== 'failed') {
        const end = Date.now() + 90000;
        while (Date.now() < end && row && row.status !== 'completed' && row.status !== 'failed') {
          await sleep(8000);
          row = kanbanById(taskId);
          console.log(`  [vedic] #${taskId}=${row?.status}`);
        }
      }
      row = kanbanById(taskId);
      ok(row?.status === 'completed', `vedic kanban #${taskId} completed`, row?.status);

      const logs = toolLogsSince(t0, { agentKey: agentId.replace(/^.*--/, '') });
      const learn = logs.filter((l) => l.tool_name === 'learnings_summary' && String(l.status).toLowerCase() === 'ok');
      console.log(
        'vedic tools',
        logs.map((l) => `${l.tool_name}=${l.status}`).slice(-12)
      );
      if (!learn.length) {
        // source may be tenant id
        const anyLearn = toolLogsSince(t0).filter(
          (l) =>
            l.tool_name === 'learnings_summary' &&
            String(l.status).toLowerCase() === 'ok' &&
            String(l.source || '').toLowerCase().includes('vedic')
        );
        ok(anyLearn.length > 0, `vedic called learnings_summary ok`);
      } else {
        ok(true, `vedic called learnings_summary ok (${learn.length})`);
      }
    }
  }
}

console.log('\n========== SUMMARY ==========');
const passed = results.filter((r) => r.ok).length;
const failedN = results.filter((r) => !r.ok).length;
console.log(JSON.stringify({ passed, failed: failedN, failed }, null, 2));
if (failed || failedN) {
  console.error('AGENT_FACES_E2E_FAIL');
  process.exit(1);
}
console.log('AGENT_FACES_E2E_OK');
