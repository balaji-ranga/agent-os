/**
 * Platform-admin AgentSystem (OpenClaw) recovery: diagnose and unblock
 * gateway lane, sessions, workspaces, and gateway crons.
 * Mutating helpers are owner-scoped (CEO id). Never log tokens/secrets.
 */
import { existsSync, writeFileSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { getDb } from '../db/schema.js';
import { getOpenClawDir, getOpenClawConfigPath } from '../config/openclaw-paths.js';
import { readOpenClawConfigSafe } from './openclaw-config-safe.js';
import { pingDocker, listContainers, restartContainer } from './docker-engine.js';
import { listOpenClawCronJobs, removeOpenClawCronJob } from './kanban-watch.js';
import { ensureTenantOpenClawAgent } from './openclaw-tenant.js';
import { syncAllowlistsFile } from './openclaw-agent-tools.js';
import { ESSENTIAL_OPENCLAW_RUNTIME_TOOLS } from './openclaw-runtime-tools.js';
import { listAgentsForUser } from './users.js';
import { startNewChatSession } from './chat-session-policy.js';
import {
  isGoalPlanFailureKanbanDisabled,
  setGoalPlanFailureKanbanEnabled,
} from './goal-plan-failure-kanban.js';
import { getPlatformSetting } from './platform-llm-settings.js';

const OPEN_DEL = `status IN ('processing','pending','running','queued')`;
const OPEN_GOAL = `status IN ('running','in_progress','pending','blocked','awaiting')`;
const OPEN_BROWSER = `status IN ('running','queued','pending')`;
const OPEN_KANBAN = `status IN ('open','in_progress','failed','pending')`;
const CLEAR_REASON = 'Admin AgentSystem recovery: drained to unblock gateway lane';

function db() {
  return getDb();
}

function clip(s, n = 80) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + '…';
}

function requireCeo(ownerUserId) {
  const id = String(ownerUserId || '').trim();
  if (!id) {
    const err = new Error('ceo_user_id required');
    err.status = 400;
    throw err;
  }
  const row = db().prepare(`SELECT id, email, name, role, enabled FROM platform_users WHERE id = ?`).get(id);
  if (!row || row.role !== 'ceo') {
    const err = new Error('CEO not found');
    err.status = 404;
    throw err;
  }
  return row;
}

function gatewayBase() {
  return String(process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789').replace(/\/$/, '');
}

function gatewayToken() {
  return String(process.env.OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_PASSWORD || '').trim();
}

async function probeGateway() {
  const url = gatewayBase();
  const token = gatewayToken();
  const out = { url, root: { ok: false }, chat: { ok: false } };
  try {
    const res = await fetch(`${url}/`, { signal: AbortSignal.timeout(5000) });
    out.root = { ok: res.status < 500, http: res.status };
  } catch (e) {
    out.root = { ok: false, error: e.message || String(e) };
  }
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'probe',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(8000),
    });
    // 401/400 = endpoint present; 404 = wiped chatCompletions; 5xx = gateway unhappy
    out.chat = {
      http: res.status,
      ok: res.status !== 404 && res.status < 500,
      wiped_chat_endpoint: res.status === 404,
    };
  } catch (e) {
    out.chat = { ok: false, error: e.message || String(e) };
  }
  return out;
}

function configSnapshot() {
  const path = getOpenClawConfigPath();
  if (!existsSync(path)) return { path, present: false };
  try {
    const cfg = readOpenClawConfigSafe();
    const providers = cfg?.models?.providers && typeof cfg.models.providers === 'object' ? cfg.models.providers : {};
    const providerNames = Object.keys(providers);
    const modelCount = providerNames.reduce((n, k) => {
      const models = providers[k]?.models;
      return n + (Array.isArray(models) ? models.length : 0);
    }, 0);
    const chatOn = !!cfg?.gateway?.http?.endpoints?.chatCompletions?.enabled;
    return {
      path,
      present: true,
      has_gateway: !!(cfg?.gateway && typeof cfg.gateway === 'object'),
      chat_completions_enabled: chatOn,
      agent_count: Array.isArray(cfg?.agents?.list) ? cfg.agents.list.length : 0,
      model_catalog_empty: modelCount === 0,
      provider_count: providerNames.length,
      model_count: modelCount,
      has_channels: !!(cfg?.channels && Object.keys(cfg.channels).length),
      binding_count: Array.isArray(cfg?.bindings) ? cfg.bindings.length : 0,
    };
  } catch (e) {
    return { path, present: true, error: e.message || String(e) };
  }
}

function queueCounts(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const scoped = owner ? 'AND owner_user_id = ?' : '';
  const scopedCeo = owner ? 'AND ceo_user_id = ?' : '';
  const args = owner ? [owner] : [];
  const dels = db()
    .prepare(
      `SELECT COUNT(*) AS c FROM agent_delegation_tasks WHERE ${OPEN_DEL} ${scoped}`
    )
    .get(...args)?.c || 0;
  const goals = db()
    .prepare(`SELECT COUNT(*) AS c FROM agent_goal_runs WHERE ${OPEN_GOAL} ${scoped}`)
    .get(...args)?.c || 0;
  const browser = db()
    .prepare(`SELECT COUNT(*) AS c FROM browser_tasks WHERE ${OPEN_BROWSER} ${scopedCeo}`)
    .get(...args)?.c || 0;
  const recoveryCards = db()
    .prepare(
      `SELECT COUNT(*) AS c FROM kanban_tasks
       WHERE ${OPEN_KANBAN} ${scoped}
         AND (title LIKE 'Goal recovery:%' OR description LIKE '%goal_plan_recovery%')`
    )
    .get(...args)?.c || 0;
  const sched = owner
    ? db()
        .prepare(
          `SELECT COUNT(*) AS c FROM scheduled_goals WHERE owner_user_id = ? AND status = 'active'`
        )
        .get(owner)?.c || 0
    : db().prepare(`SELECT COUNT(*) AS c FROM scheduled_goals WHERE status = 'active'`).get()?.c || 0;
  return {
    open_delegations: Number(dels) || 0,
    open_goal_runs: Number(goals) || 0,
    open_browser_tasks: Number(browser) || 0,
    recovery_kanban: Number(recoveryCards) || 0,
    active_scheduled_goals: Number(sched) || 0,
  };
}

function sampleOpenWork(ownerUserId, limit = 8) {
  const owner = String(ownerUserId);
  const dels = db()
    .prepare(
      `SELECT id, to_agent_id, status, datetime(created_at) AS created_at, substr(prompt,1,80) AS prompt
       FROM agent_delegation_tasks
       WHERE owner_user_id = ? AND ${OPEN_DEL}
       ORDER BY id DESC LIMIT ?`
    )
    .all(owner, limit);
  const goals = db()
    .prepare(
      `SELECT id, status, title, source, datetime(updated_at) AS updated_at
       FROM agent_goal_runs
       WHERE owner_user_id = ? AND ${OPEN_GOAL}
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(owner, limit);
  const browser = db()
    .prepare(
      `SELECT id, status, agent_id, substr(goal_text,1,80) AS goal_text, datetime(updated_at) AS updated_at
       FROM browser_tasks
       WHERE ceo_user_id = ? AND ${OPEN_BROWSER}
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(owner, limit);
  return {
    delegations: dels.map((r) => ({ ...r, prompt: clip(r.prompt) })),
    goal_runs: goals,
    browser_tasks: browser.map((r) => ({ ...r, goal_text: clip(r.goal_text) })),
  };
}

function allowlistHealth(ownerUserId) {
  const cfg = readOpenClawConfigSafe();
  const list = Array.isArray(cfg?.agents?.list) ? cfg.agents.list : [];
  const prefix = ownerUserId ? `t-${String(ownerUserId).toLowerCase()}--` : '';
  const missing = [];
  for (const a of list) {
    const id = String(a?.id || '');
    if (prefix && !id.toLowerCase().startsWith(prefix)) continue;
    const allow = Array.isArray(a?.tools?.allow) ? a.tools.allow : [];
    const miss = ESSENTIAL_OPENCLAW_RUNTIME_TOOLS.filter((t) => !allow.includes(t));
    if (miss.length) missing.push({ id, missing: miss.slice(0, 8) });
  }
  return { agents_checked: prefix ? list.filter((a) => String(a?.id || '').toLowerCase().startsWith(prefix)).length : list.length, missing_allowlists: missing.slice(0, 20) };
}

export function listRecoveryCeos() {
  return db()
    .prepare(
      `SELECT id, email, name, enabled FROM platform_users WHERE role = 'ceo' ORDER BY name, email`
    )
    .all()
    .map((r) => ({ ...r, enabled: !!r.enabled, queues: queueCounts(r.id) }));
}

export async function getRecoveryStatus({ ceoUserId = null } = {}) {
  const gateway = await probeGateway();
  let docker = { reachable: false };
  try {
    docker = { reachable: await pingDocker() };
  } catch (e) {
    docker = { reachable: false, error: e.message || String(e) };
  }
  const owner = ceoUserId ? requireCeo(ceoUserId).id : null;
  let gatewayCrons = [];
  try {
    gatewayCrons = await listOpenClawCronJobs();
  } catch (e) {
    gatewayCrons = [];
    docker.cron_list_error = e.message || String(e);
  }
  return {
    gateway,
    config: configSnapshot(),
    docker,
    failure_kanban: {
      disabled: isGoalPlanFailureKanbanDisabled(),
      env: String(process.env.GOAL_PLAN_FAILURE_KANBAN || '1'),
      setting: getPlatformSetting('goal_plan_failure_kanban', null),
    },
    queues: queueCounts(owner),
    samples: owner ? sampleOpenWork(owner) : null,
    allowlists: owner ? allowlistHealth(owner) : allowlistHealth(null),
    gateway_cron_count: Array.isArray(gatewayCrons) ? gatewayCrons.length : 0,
    ceo: owner ? requireCeo(owner) : null,
    ceos: listRecoveryCeos(),
  };
}

export function drainCeoLane(ownerUserId, { includeScheduled = true, includeGoals = true, includeBrowser = true } = {}) {
  const ceo = requireCeo(ownerUserId);
  const owner = ceo.id;
  const failedDels = db()
    .prepare(
      `UPDATE agent_delegation_tasks
       SET status = 'failed', error_message = ?, completed_at = datetime('now')
       WHERE owner_user_id = ? AND ${OPEN_DEL}`
    )
    .run(CLEAR_REASON, owner).changes;

  let failedGoals = 0;
  if (includeGoals) {
    failedGoals = db()
      .prepare(
        `UPDATE agent_goal_runs
         SET status = 'failed', error_message = ?, updated_at = datetime('now'), completed_at = datetime('now')
         WHERE owner_user_id = ? AND ${OPEN_GOAL}`
      )
      .run(CLEAR_REASON, owner).changes;
  }

  const cancelledCards = db()
    .prepare(
      `UPDATE kanban_tasks
       SET status = 'cancelled', updated_at = datetime('now')
       WHERE owner_user_id = ? AND ${OPEN_KANBAN}
         AND (title LIKE 'Goal recovery:%' OR description LIKE '%goal_plan_recovery%')`
    )
    .run(owner).changes;

  let pausedSched = 0;
  if (includeScheduled) {
    pausedSched = db()
      .prepare(
        `UPDATE scheduled_goals SET status = 'paused', updated_at = datetime('now')
         WHERE owner_user_id = ? AND status = 'active'`
      )
      .run(owner).changes;
  }

  let cancelledBrowser = 0;
  if (includeBrowser) {
    cancelledBrowser = db()
      .prepare(
        `UPDATE browser_tasks
         SET status = 'failed', error = ?, updated_at = datetime('now')
         WHERE ceo_user_id = ? AND ${OPEN_BROWSER}`
      )
      .run(CLEAR_REASON, owner).changes;
  }

  const remaining = queueCounts(owner);
  console.info(
    '[openclaw-recovery] drained ceo=%s dels=%s goals=%s cards=%s sched=%s browser=%s remaining_dels=%s',
    owner,
    failedDels,
    failedGoals,
    cancelledCards,
    pausedSched,
    cancelledBrowser,
    remaining.open_delegations
  );
  return {
    ceo_user_id: owner,
    failed_delegations: failedDels,
    failed_goal_runs: failedGoals,
    cancelled_recovery_kanban: cancelledCards,
    paused_scheduled_goals: pausedSched,
    cancelled_browser_tasks: cancelledBrowser,
    remaining,
  };
}

export async function restartOpenClawGateway() {
  try {
    const ok = await pingDocker();
    if (!ok) {
      const err = new Error('Docker socket not reachable — mount docker.sock (docker-compose.docker-tools.yml)');
      err.status = 503;
      throw err;
    }
  } catch (e) {
    if (e.status) throw e;
    const err = new Error(`Docker socket not reachable: ${e.message || e}`);
    err.status = 503;
    throw err;
  }
  const containers = await listContainers({
    all: true,
    filters: { label: ['com.docker.compose.service=openclaw'] },
  });
  const target =
    containers.find((c) => (c.Names || []).some((n) => String(n).includes('openclaw'))) || containers[0];
  if (!target?.Id) {
    const err = new Error('AgentSystem (openclaw) container not found');
    err.status = 404;
    throw err;
  }
  await restartContainer(target.Id, { t: 8 });
  const name = (target.Names || [])[0] || target.Id.slice(0, 12);
  console.info('[openclaw-recovery] restarted gateway container=%s', name);
  return { ok: true, container: name };
}

function repoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

function runNodeScript(relPath, timeoutMs = 45000) {
  const script = join(repoRoot(), relPath);
  if (!existsSync(script)) {
    return Promise.resolve({ ok: false, error: 'script missing', script: relPath });
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env },
      cwd: repoRoot(),
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const t = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ ok: false, error: 'timeout', script: relPath, stdout: clip(stdout, 400), stderr: clip(stderr, 400) });
    }, timeoutMs);
    child.stdout?.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({
        ok: code === 0,
        exit_code: code,
        script: relPath,
        stdout: clip(stdout, 800),
        stderr: clip(stderr, 400),
      });
    });
    child.on('error', (e) => {
      clearTimeout(t);
      resolve({ ok: false, error: e.message || String(e), script: relPath });
    });
  });
}

export async function repairGatewayConfig() {
  const ensure = await runNodeScript('deploy/scripts/ensure-openclaw-gateway-config.js');
  const channels = await runNodeScript('deploy/scripts/restore-openclaw-channel-routing.js');
  const snap = configSnapshot();
  console.info(
    '[openclaw-recovery] repair config ensure_ok=%s channels_ok=%s chat=%s catalog_empty=%s',
    !!ensure.ok,
    !!channels.ok,
    snap.chat_completions_enabled,
    snap.model_catalog_empty
  );
  return { ensure, channels, config: snap };
}

export function healCeoWorkspaces(ownerUserId) {
  const ceo = requireCeo(ownerUserId);
  const agents = listAgentsForUser(ceo.id);
  let ok = 0;
  let fail = 0;
  const errors = [];
  for (const agent of agents) {
    try {
      ensureTenantOpenClawAgent(agent, ceo.id);
      ok += 1;
    } catch (e) {
      fail += 1;
      errors.push({ agent_id: agent.id, error: e.message || String(e) });
    }
  }
  syncAllowlistsFile();
  const allow = allowlistHealth(ceo.id);
  console.info('[openclaw-recovery] heal workspaces ceo=%s ok=%s fail=%s', ceo.id, ok, fail);
  return { ceo_user_id: ceo.id, healed: ok, failed: fail, errors: errors.slice(0, 15), allowlists: allow };
}

export async function clearCeoAgentSession(ownerUserId, agentId) {
  const ceo = requireCeo(ownerUserId);
  const id = String(agentId || '').trim();
  if (!id) {
    const err = new Error('agent_id required');
    err.status = 400;
    throw err;
  }
  const agent = db().prepare('SELECT id, openclaw_agent_id FROM agents WHERE id = ?').get(id);
  if (!agent) {
    const err = new Error('Agent not found');
    err.status = 404;
    throw err;
  }
  const ensured = ensureTenantOpenClawAgent(agent, ceo.id);
  const result = await startNewChatSession({
    agentId: agent.id,
    openclawAgentId: ensured.openclawAgentId,
    ownerUserId: ceo.id,
  });
  console.info('[openclaw-recovery] cleared session ceo=%s agent=%s', ceo.id, agent.id);
  return { ceo_user_id: ceo.id, agent_id: agent.id, ...result };
}

export function resetNativeSessionStore(ownerUserId, agentId) {
  const ceo = requireCeo(ownerUserId);
  const id = String(agentId || '').trim();
  if (!id) {
    const err = new Error('agent_id required');
    err.status = 400;
    throw err;
  }
  const agent = db().prepare('SELECT id, openclaw_agent_id FROM agents WHERE id = ?').get(id);
  if (!agent) {
    const err = new Error('Agent not found');
    err.status = 404;
    throw err;
  }
  const ensured = ensureTenantOpenClawAgent(agent, ceo.id);
  const sessionsDir = join(getOpenClawDir(), 'agents', ensured.openclawAgentId, 'sessions');
  const jsonPath = join(sessionsDir, 'sessions.json');
  if (!existsSync(jsonPath)) {
    return { ok: true, reset: false, reason: 'no sessions.json', path: jsonPath };
  }
  const bak = `${jsonPath}.bak-${Date.now()}`;
  try {
    renameSync(jsonPath, bak);
  } catch {
    /* overwrite in place */
  }
  writeFileSync(jsonPath, '{}\n', 'utf8');
  console.info('[openclaw-recovery] reset sessions.json ceo=%s agent=%s', ceo.id, agent.id);
  return { ok: true, reset: true, ceo_user_id: ceo.id, agent_id: agent.id, backup: existsSync(bak) ? bak : null };
}

export async function listGatewayCrons() {
  const jobs = await listOpenClawCronJobs();
  return {
    jobs: (jobs || []).map((j) => ({
      id: j?.id || j?.jobId || j?.job_id || null,
      name: j?.name || j?.job || null,
      agent: j?.agentId || j?.agent_id || j?.agent || null,
      enabled: j?.enabled !== false,
      schedule: j?.schedule || j?.cron || null,
    })),
  };
}

export async function removeGatewayCron(cronId) {
  const id = String(cronId || '').trim();
  if (!id) {
    const err = new Error('cron id required');
    err.status = 400;
    throw err;
  }
  const r = await removeOpenClawCronJob(id);
  if (!r.ok) {
    const err = new Error(r.error || 'Failed to remove gateway cron');
    err.status = 400;
    throw err;
  }
  return r;
}

export function setFailureKanbanKillSwitch(enabled) {
  const out = setGoalPlanFailureKanbanEnabled(!!enabled);
  console.info('[openclaw-recovery] failure_kanban enabled=%s', out.enabled);
  return out;
}

export function listCeoAgents(ownerUserId) {
  const ceo = requireCeo(ownerUserId);
  return listAgentsForUser(ceo.id).map((a) => ({
    id: a.id,
    name: a.name,
    openclaw_agent_id: a.openclaw_agent_id || a.id,
    is_coo: !!a.is_coo,
  }));
}
