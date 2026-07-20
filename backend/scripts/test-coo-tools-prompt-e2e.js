/**
 * E2E: prompt COO (balserve) to invoke each Agent OS content tool; verify via content_tool_logs.
 *
 * Usage (inside backend container or with gateway reachable):
 *   node scripts/test-coo-tools-prompt-e2e.js
 *
 * Env:
 *   OPENCLAW_GATEWAY_URL (default http://openclaw:18789 in Docker, else http://127.0.0.1:18789)
 *   OPENCLAW_GATEWAY_TOKEN
 *   COO_TOOLS_SKIP_IMAGE=1 / COO_TOOLS_SKIP_VIDEO=1 — skip expensive tools
 *   COO_TOOLS_SKIP_IBKR=1 — skip IBKR tools
 *   COO_AGENT_ID (default balserve)
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { seedWorkflowToolsIfMissing } from '../src/db/seed-content-tools-meta.js';
import { grantIbkrToolsToCoo } from '../src/db/seed-ibkr-trading-tools.js';
import { grantLearningsSummaryToAllAgents } from '../src/services/agent-feedback.js';

initDb();
seedWorkflowToolsIfMissing();
try {
  grantIbkrToolsToCoo('balserve');
} catch (_) {}
try {
  grantLearningsSummaryToAllAgents();
} catch (_) {}

const AGENT_ID = process.env.COO_AGENT_ID || 'balserve';
// Bala platform workflows often live under ceo_user_id `default` (legacy data id).
const OWNER_USER_ID =
  process.env.COO_TOOLS_OWNER_USER_ID || process.env.WORKFLOW_TEST_OWNER_USER_ID || 'default';
const SESSION_USER =
  process.env.COO_TOOLS_SESSION_USER || `agent-os-${AGENT_ID}-${OWNER_USER_ID}`;
const GATEWAY_URL = (
  process.env.OPENCLAW_GATEWAY_URL ||
  process.env.GATEWAY_URL ||
  (existsSync('/.dockerenv') ? 'http://openclaw:18789' : 'http://127.0.0.1:18789')
).replace(/\/$/, '');

function loadGatewayToken() {
  if (process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN) {
    return process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN;
  }
  for (const p of [
    '/root/.openclaw/openclaw.json',
    join(process.env.HOME || '', '.openclaw', 'openclaw.json'),
    join(process.env.USERPROFILE || '', '.openclaw', 'openclaw.json'),
  ]) {
    try {
      if (!existsSync(p)) continue;
      const cfg = JSON.parse(readFileSync(p, 'utf8'));
      if (cfg?.gateway?.auth?.token) return cfg.gateway.auth.token;
    } catch (_) {}
  }
  return '';
}

const TOKEN = loadGatewayToken();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureStandupAndTask() {
  const db = getDb();
  db.prepare(
    `INSERT INTO standups (scheduled_at, status, source, title) VALUES (datetime('now'), 'active', 'coo_tools_e2e', 'COO tools e2e')`
  ).run();
  const standup = db.prepare(`SELECT id FROM standups WHERE source = 'coo_tools_e2e' ORDER BY id DESC LIMIT 1`).get();
  db.prepare(
    `INSERT INTO kanban_tasks (title, description, status, assigned_agent_id, created_by, standup_id)
     VALUES (?, ?, 'open', 'techresearcher', 'coo_tools_e2e', ?)`
  ).run('COO tools e2e task', 'Created for COO tool prompt regression', standup.id);
  const task = db
    .prepare(`SELECT id FROM kanban_tasks WHERE created_by = 'coo_tools_e2e' ORDER BY id DESC LIMIT 1`)
    .get();
  return { standupId: standup.id, taskId: task.id };
}

function latestToolLog(toolName, afterIso) {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, tool_name, status, substr(response_payload, 1, 400) AS response_payload, created_at
       FROM content_tool_logs
       WHERE tool_name = ? AND created_at >= ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(toolName, afterIso);
}

async function chatCoo(prompt, { timeoutMs = 180000 } = {}) {
  // Bind COO chat to entitled CEO so workflow tools resolve owner.
  const sessionUser = SESSION_USER;  const maxAttempts = 4;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-openclaw-agent-id': AGENT_ID,
          ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
        },
        body: JSON.stringify({
          model: 'openclaw',
          messages: [{ role: 'user', content: prompt }],
          user: sessionUser,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_) {}
      const assistant =
        json?.choices?.[0]?.message?.content ||
        json?.choices?.[0]?.text ||
        text.slice(0, 500);
      if (res.status === 429) {
        const wait = 20000 * attempt;
        console.log(`rate limited, retry in ${wait}ms`);
        await sleep(wait);
        lastErr = new Error('rate limited');
        continue;
      }
      return { ok: res.ok, status: res.status, assistant: String(assistant || ''), raw: text.slice(0, 1500) };
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        console.log(`chat attempt ${attempt} failed (${e.message}), retrying…`);
        await sleep(3000 * attempt);
        continue;
      }
    }
  }
  throw lastErr || new Error('chat failed');
}

function buildCases({ standupId, taskId, workflowId }) {
  const skipImage = process.env.COO_TOOLS_SKIP_IMAGE === '1';
  const skipVideo = process.env.COO_TOOLS_SKIP_VIDEO === '1';
  const skipIbkr = process.env.COO_TOOLS_SKIP_IBKR === '1';
  const wfId = workflowId || 'test-brain-maker-openai-checker-ollama';

  /** @type {{ name: string, prompt: string, acceptError?: boolean, timeoutMs?: number }[]} */
  const cases = [
    {
      name: 'summarize_url',
      prompt:
        'Use the summarize_url tool now. Call it with exactly these arguments: {"url":"https://example.com"}. Then briefly confirm the title/summary.',
    },
    {
      name: 'kanban_move_status',
      prompt: `Use the kanban_move_status tool now. Call it with exactly: {"task_id":${taskId},"new_status":"in_progress"}. Then confirm.`,
    },
    {
      name: 'kanban_assign_task',
      prompt: `Use the kanban_assign_task tool now. Call it with exactly: {"task_id":${taskId},"to_agent_id":"techresearcher"}. Then confirm.`,
    },
    {
      name: 'kanban_reassign_to_coo',
      // COO is forbidden from this tool by design (403) — still assert the tool was invoked.
      prompt: `Use the kanban_reassign_to_coo tool now. Call it with exactly: {"task_id":${taskId}}. Then confirm the result or error.`,
      acceptError: true,
    },
    {
      name: 'intent_classify_and_delegate',
      prompt: `Use the intent_classify_and_delegate tool now. Call it with exactly: {"message":"Create a short research brief on AI in banking","standup_id":${standupId}}. Then confirm which agents got tasks.`,
      timeoutMs: 240000,
    },
    {
      name: 'agent_workflow_list',
      prompt: 'Use the agent_workflow_list tool now. Call it with exactly: {}. Then list up to 3 workflow names from the result.',
    },
    {
      name: 'agent_workflow_enquire',
      prompt:
        'Use the agent_workflow_enquire tool now. Call it with exactly: {"query":"email"}. Then mention one matching workflow id if any.',
    },
    {
      name: 'agent_workflow_trigger',
      prompt: `Use the agent_workflow_trigger tool now. Call it with exactly: {"workflow_id":"${wfId}","input":"coo tools e2e trigger"}. Then report run_id or error.`,
      acceptError: true,
      timeoutMs: 240000,
    },
    {
      name: 'learnings_summary',
      prompt:
        'You must call the learnings_summary tool. Do not answer without calling it. Invoke learnings_summary with JSON arguments exactly: {"topic":"coo tools e2e","days":30}. After the tool returns, briefly say whether any learnings were returned.',
      timeoutMs: 240000,
    },
  ];

  if (!skipImage) {
    cases.push({
      name: 'generate_image',
      prompt:
        'Use the generate_image tool now. Call it with exactly: {"prompt":"simple flat icon of a blue cloud, no text"}. Then confirm success or the error.',
      timeoutMs: 300000,
      acceptError: true,
    });
  }
  if (!skipVideo) {
    cases.push({
      name: 'generate_video',
      prompt:
        'Use the generate_video tool now. Call it with exactly: {"prompt":"tiny clip of clouds drifting"}. Then confirm success or the error.',
      timeoutMs: 300000,
      acceptError: true,
    });
  }
  if (!skipIbkr) {
    cases.push(
      {
        name: 'ibkr_gateway_ping',
        prompt: 'Use the ibkr_gateway_ping tool now. Call it with exactly: {}. Then report reachable true/false.',
        acceptError: true,
        timeoutMs: 300000,
      },
      {
        name: 'ibkr_config',
        prompt: 'Use the ibkr_config tool now. Call it with exactly: {}. Then report one config field.',
        acceptError: true,
        timeoutMs: 300000,
      }
    );
  }

  return cases;
}

async function runCase(c, afterIso) {
  console.log(`\n=== ${c.name} ===`);
  console.log('prompt:', c.prompt.slice(0, 140) + (c.prompt.length > 140 ? '…' : ''));
  const chat = await chatCoo(c.prompt, { timeoutMs: c.timeoutMs || 180000 });
  console.log('gateway status', chat.status, 'ok', chat.ok);
  console.log('assistant:', chat.assistant.slice(0, 280).replace(/\s+/g, ' '));

  // Allow tool log write to settle
  await sleep(1500);
  let log = latestToolLog(c.name, afterIso);
  for (let i = 0; i < 8 && !log; i++) {
    await sleep(1500);
    log = latestToolLog(c.name, afterIso);
  }

  if (!log) {
    return {
      name: c.name,
      ok: false,
      reason: 'no content_tool_logs row after prompt (COO did not invoke tool)',
      assistant: chat.assistant.slice(0, 200),
      gatewayOk: chat.ok,
    };
  }

  const resp = String(log.response_payload || '');
  const toolOk = log.status === 'ok' || (c.acceptError && log.status === 'error');
  console.log('log', { id: log.id, status: log.status, created_at: log.created_at, resp: resp.slice(0, 220) });

  if (!toolOk) {
    return {
      name: c.name,
      ok: false,
      reason: `tool log status=${log.status}`,
      resp: resp.slice(0, 300),
    };
  }
  return { name: c.name, ok: true, status: log.status };
}

async function ensureGateway() {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(5000),
    });
    console.log('gateway reachable', GATEWAY_URL, 'status', res.status);
  } catch (e) {
    throw new Error(`OpenClaw gateway not reachable at ${GATEWAY_URL}: ${e.message}`);
  }
  if (!TOKEN) console.warn('WARNING: no gateway token — requests may 401');
}

async function main() {
  console.log('=== COO tools prompt E2E ===');
  console.log('agent', AGENT_ID);
  console.log('owner', OWNER_USER_ID);
  console.log('sessionUser', SESSION_USER);
  console.log('gateway', GATEWAY_URL);
  console.log('token set', !!TOKEN);

  await ensureGateway();

  try {
    const { registerOpenClawSessionOwner } = await import('../src/services/tool-owner-scope.js');
    registerOpenClawSessionOwner(`agent:${AGENT_ID}:${SESSION_USER}`, OWNER_USER_ID);
    console.log('registered session owner', OWNER_USER_ID);
  } catch (e) {
    console.warn('session owner register skipped', e.message);
  }

  const { standupId, taskId } = ensureStandupAndTask();
  let workflowRow = getDb()
    .prepare(
      `SELECT id FROM agent_workflow_definitions WHERE owner_user_id = ? AND status = 'published' ORDER BY updated_at DESC LIMIT 1`
    )
    .get(OWNER_USER_ID);
  if (!workflowRow) {
    // Re-home an existing published workflow to this owner for trigger coverage.
    const any = getDb()
      .prepare(`SELECT id FROM agent_workflow_definitions WHERE status = 'published' ORDER BY updated_at DESC LIMIT 1`)
      .get();
    if (any?.id) {
      getDb()
        .prepare(`UPDATE agent_workflow_definitions SET owner_user_id = ? WHERE id = ?`)
        .run(OWNER_USER_ID, any.id);
      workflowRow = { id: any.id };
      console.log('re-homed workflow', any.id, '→', OWNER_USER_ID);
    }
  }
  const workflowId = workflowRow?.id || null;
  console.log('standup', standupId, 'task', taskId, 'workflow', workflowId || '(none)');

  const cases = buildCases({ standupId, taskId, workflowId });
  const only = (process.env.COO_TOOLS_ONLY || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const selected = only.length ? cases.filter((c) => only.includes(c.name)) : cases;
  if (only.length) {
    console.log('COO_TOOLS_ONLY', only.join(','), '→', selected.map((c) => c.name).join(', ') || '(none)');
  }
  const afterIso = new Date(Date.now() - 2000).toISOString().replace('T', ' ').slice(0, 19);

  const results = [];
  for (const c of selected) {
    try {
      results.push(await runCase(c, afterIso));
    } catch (e) {
      results.push({ name: c.name, ok: false, reason: e.message });
      console.error('CASE ERROR', c.name, e.message);
    }
    // Pace OpenAI TPM between COO turns
    await sleep(Number(process.env.COO_TOOLS_CASE_PAUSE_MS || 12000));
  }

  console.log('\n========== SUMMARY ==========');
  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    if (!r.ok) failed += 1;
    console.log(`${mark}  ${r.name}${r.reason ? ' — ' + r.reason : ''}${r.status ? ' (' + r.status + ')' : ''}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
