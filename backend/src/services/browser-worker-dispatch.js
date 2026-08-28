/** Owner-scoped multi-executor browser registry and node-addressed job dispatch. */
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { assertUrlAllowed } from './browser-url-policy.js';
import { createMediaArtifact } from './ceo-media-artifacts.js';

function db() { return getDb(); }
const OFFLINE_MS = () => Math.max(15_000, Number(process.env.BROWSER_WORKER_OFFLINE_MS || 90_000));
const JOB_TIMEOUT_MS = () => Math.max(10_000, Number(process.env.BROWSER_WORKER_JOB_TIMEOUT_MS || 120_000));
const DRIVER_PRIORITY = ['chrome_extension', 'playwright_chrome', 'playwright_persistent', 'playwright'];
const nowIso = () => new Date().toISOString();

function parseJson(raw, fallback) {
  try { return JSON.parse(raw || '') ?? fallback; } catch { return fallback; }
}
function nodeIdFor(nodeId, owner) {
  return (String(nodeId || '').trim() || `legacy-${String(owner || '').trim()}`).slice(0, 120);
}
function heartbeatFresh(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) && Date.now() - time < OFFLINE_MS();
}
function rowToNode(row) {
  if (!row) return null;
  return {
    id: row.id,
    node_id: row.id,
    owner_user_id: row.owner_user_id,
    token_id: row.token_id || null,
    device_name: row.device_name || '',
    online: Boolean(row.online) && heartbeatFresh(row.last_heartbeat_at),
    last_heartbeat_at: row.last_heartbeat_at || null,
    worker_version: row.worker_version || null,
    browser_version: row.browser_version || null,
    driver_mode: row.driver_mode || 'playwright',
    protocol_version: Number(row.protocol_version || 1),
    capabilities: parseJson(row.capabilities_json, {}),
    last_client_ip: row.last_client_ip || null,
    active_task_id: row.active_task_id || null,
    offline_after_ms: OFFLINE_MS(),
  };
}

export function getBrowserWorkerOfflineMs() { return OFFLINE_MS(); }

export function touchBrowserWorkerNode(ownerUserId, {
  nodeId = null, tokenId = null, deviceName, workerVersion, browserVersion,
  driverMode, protocolVersion, capabilities, clientIp = null,
} = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id required');
  const id = nodeIdFor(nodeId, owner);
  const ts = nowIso();
  // Heartbeats and long-poll requests intentionally send only liveness fields.
  // Preserve the richer metadata registered by the executor instead of replacing
  // capabilities with an empty object and making the node unroutable.
  const existing = db().prepare(
    `SELECT device_name, worker_version, browser_version, driver_mode,
            protocol_version, capabilities_json
       FROM browser_executor_nodes
      WHERE id = ? AND owner_user_id = ?`
  ).get(id, owner);
  const nextDeviceName = deviceName == null ? existing?.device_name || '' : String(deviceName || '').slice(0, 120);
  const nextWorkerVersion = workerVersion == null ? existing?.worker_version || '' : String(workerVersion || '').slice(0, 80);
  const nextBrowserVersion = browserVersion == null ? existing?.browser_version || '' : String(browserVersion || '').slice(0, 80);
  const nextDriverMode = driverMode == null ? existing?.driver_mode || 'playwright' : String(driverMode || 'playwright').slice(0, 40);
  const nextProtocolVersion = protocolVersion == null
    ? Math.max(1, Number(existing?.protocol_version) || 1)
    : Math.max(1, Number(protocolVersion) || 1);
  const nextCapabilities = capabilities == null
    ? parseJson(existing?.capabilities_json, {})
    : (capabilities && typeof capabilities === 'object' ? capabilities : {});
  db().prepare(
    `INSERT INTO browser_executor_nodes
      (id, owner_user_id, token_id, device_name, online, last_heartbeat_at, worker_version,
       browser_version, driver_mode, protocol_version, capabilities_json, last_client_ip, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       token_id = COALESCE(excluded.token_id, browser_executor_nodes.token_id),
       device_name = excluded.device_name, online = 1,
       last_heartbeat_at = excluded.last_heartbeat_at, worker_version = excluded.worker_version,
       browser_version = excluded.browser_version, driver_mode = excluded.driver_mode,
       protocol_version = excluded.protocol_version, capabilities_json = excluded.capabilities_json,
       last_client_ip = excluded.last_client_ip, updated_at = excluded.updated_at
     WHERE browser_executor_nodes.owner_user_id = excluded.owner_user_id`
  ).run(id, owner, tokenId || null, nextDeviceName, ts,
    nextWorkerVersion, nextBrowserVersion,
    nextDriverMode, nextProtocolVersion,
    JSON.stringify(nextCapabilities),
    clientIp ? String(clientIp).slice(0, 80) : null, ts);
  const node = getBrowserExecutorNode(owner, id);
  if (!node) throw new Error('node_id belongs to another owner');
  return node;
}

export function getBrowserExecutorNode(ownerUserId, nodeId) {
  return rowToNode(db().prepare(`SELECT * FROM browser_executor_nodes WHERE id = ? AND owner_user_id = ?`)
    .get(String(nodeId || ''), String(ownerUserId || '')));
}

export function listBrowserExecutorNodes(ownerUserId, { includeOffline = true } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return [];
  const rows = db().prepare(`SELECT * FROM browser_executor_nodes WHERE owner_user_id = ? ORDER BY last_heartbeat_at DESC`).all(owner);
  const stale = rows.filter((row) => row.online && !heartbeatFresh(row.last_heartbeat_at)).map((row) => row.id);
  if (stale.length) {
    db().prepare(`UPDATE browser_executor_nodes SET online = 0, updated_at = ? WHERE owner_user_id = ? AND id IN (${stale.map(() => '?').join(',')})`)
      .run(nowIso(), owner, ...stale);
  }
  const nodes = rows.map(rowToNode).map((node) => stale.includes(node.id) ? { ...node, online: false } : node);
  return includeOffline ? nodes : nodes.filter((node) => node.online);
}

export function markBrowserWorkerOffline(ownerUserId, nodeId = null) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return false;
  const result = nodeId
    ? db().prepare(`UPDATE browser_executor_nodes SET online = 0, updated_at = ? WHERE owner_user_id = ? AND id = ?`)
      .run(nowIso(), owner, nodeIdFor(nodeId, owner))
    : db().prepare(`UPDATE browser_executor_nodes SET online = 0, updated_at = ? WHERE owner_user_id = ?`)
      .run(nowIso(), owner);
  return result.changes > 0;
}

export function selectBrowserExecutor(ownerUserId, { preferredDriver = null, requiredCapabilities = [], excludedDrivers = [] } = {}) {
  let nodes = listBrowserExecutorNodes(ownerUserId, { includeOffline: false });
  const required = Array.isArray(requiredCapabilities) ? requiredCapabilities : [];
  const excluded = new Set((Array.isArray(excludedDrivers) ? excludedDrivers : []).map((v) => String(v || '').trim()).filter(Boolean));
  nodes = nodes.filter((node) => !excluded.has(node.driver_mode));
  nodes = nodes.filter((node) => required.every((cap) => node.capabilities?.[cap] === true || node.capabilities?.actions?.includes?.(cap)));
  if (preferredDriver) {
    const preferred = nodes.find((node) => node.driver_mode === preferredDriver);
    if (preferred) return preferred;
  }
  return nodes.sort((a, b) => {
    const ai = DRIVER_PRIORITY.indexOf(a.driver_mode);
    const bi = DRIVER_PRIORITY.indexOf(b.driver_mode);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  })[0] || null;
}

export function getBrowserWorkerNodeStatus(ownerUserId) {
  const nodes = listBrowserExecutorNodes(ownerUserId);
  const selected = selectBrowserExecutor(ownerUserId);
  return selected ? { ...selected, nodes } : {
    online: false, node_id: null, nodes, last_heartbeat_at: null, worker_version: null,
    driver_mode: null, capabilities: {}, last_client_ip: null, offline_after_ms: OFFLINE_MS(),
  };
}
export function isBrowserWorkerOnline(ownerUserId) { return Boolean(selectBrowserExecutor(ownerUserId)); }

export function enqueueBrowserWorkerJob(ownerUserId, action, args = {}, options = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id required');
  const act = String(action || '').trim();
  if (!act) throw new Error('action required');
  const selected = options.node || selectBrowserExecutor(owner, options);
  if (!selected) throw Object.assign(new Error('No compatible local browser executor is online'), { code: 'EXECUTOR_OFFLINE' });
  const idempotencyKey = options.idempotencyKey ? String(options.idempotencyKey).slice(0, 160) : null;
  if (idempotencyKey) {
    const existing = db().prepare(`SELECT id FROM browser_worker_jobs WHERE owner_user_id = ? AND idempotency_key = ?`).get(owner, idempotencyKey);
    if (existing) return { id: existing.id, node: selected, duplicate: true };
  }
  const id = randomUUID();
  const required = options.requiredCapabilities || [];
  db().prepare(
    `INSERT INTO browser_worker_jobs
      (id, owner_user_id, action, args_json, status, selected_node_id, selected_driver_mode,
       protocol_version, capability_requirements_json, idempotency_key, dispatch_deadline, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, owner, act, JSON.stringify(args || {}), selected.id, selected.driver_mode,
    selected.protocol_version || 1, JSON.stringify(required), idempotencyKey,
    new Date(Date.now() + JOB_TIMEOUT_MS()).toISOString(), nowIso(), nowIso());
  console.info('[browser-worker-dispatch] queued owner=%s node=%s driver=%s id=%s action=%s', owner, selected.id, selected.driver_mode, id, act);
  return { id, node: selected };
}

export function claimNextBrowserWorkerJob(ownerUserId, nodeId) {
  const owner = String(ownerUserId || '').trim();
  const node = nodeIdFor(nodeId, owner);
  if (!getBrowserExecutorNode(owner, node)) return null;
  const row = db().prepare(
    `SELECT * FROM browser_worker_jobs WHERE owner_user_id = ? AND selected_node_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1`
  ).get(owner, node);
  if (!row) return null;
  const ts = nowIso();
  const updated = db().prepare(
    `UPDATE browser_worker_jobs SET status = 'running', claimed_at = ?, updated_at = ?
     WHERE id = ? AND owner_user_id = ? AND selected_node_id = ? AND status = 'queued'`
  ).run(ts, ts, row.id, owner, node);
  if (!updated.changes) return null;
  return { id: row.id, action: row.action, args: parseJson(row.args_json, {}), created_at: row.created_at, protocol_version: row.protocol_version || 1 };
}

export function completeBrowserWorkerJob(ownerUserId, nodeId, jobId, {
  ok, result = null, error = null, failureCode = null, resultState = null,
} = {}) {
  const owner = String(ownerUserId || '').trim();
  const node = nodeIdFor(nodeId, owner);
  const id = String(jobId || '').trim();
  const row = db().prepare(`SELECT id, status FROM browser_worker_jobs WHERE id = ? AND owner_user_id = ? AND selected_node_id = ?`).get(id, owner, node);
  if (!row) return { ok: false, error: 'job not found for this node' };
  if (row.status === 'completed' || row.status === 'failed') return { ok: true, already: true };
  let storedResult = result;
  if (ok && result?.screenshot_base64) {
    const encoded = String(result.screenshot_base64);
    const maxBytes = Math.max(1, Number(process.env.BROWSER_SCREENSHOT_MAX_MB || 10)) * 1024 * 1024;
    const buffer = Buffer.from(encoded, 'base64');
    if (!buffer.length || buffer.length > maxBytes) {
      ok = false;
      error = buffer.length ? 'Screenshot exceeds configured size limit' : 'Screenshot payload is empty';
      failureCode = 'SCREENSHOT_INVALID';
      resultState = 'outcome_not_observed';
      storedResult = null;
    } else {
      const { ref } = createMediaArtifact(owner, {
        buffer,
        filename: result.filename || `browser-${id}.png`,
        mimeType: 'image/png',
        kind: 'other',
        meta: { source: 'browser_task', browser_worker_job_id: id, node_id: node, url: result.url || '' },
      });
      const { screenshot_base64: _discard, ...rest } = result;
      storedResult = { ...rest, artifact: ref, artifact_url: ref.url };
    }
  }
  const status = ok ? 'completed' : 'failed';
  const ts = nowIso();
  db().prepare(
    `UPDATE browser_worker_jobs SET status = ?, result_json = ?, error = ?, failure_code = ?, result_state = ?, completed_at = ?, updated_at = ?
     WHERE id = ? AND owner_user_id = ? AND selected_node_id = ?`
  ).run(status, storedResult != null ? JSON.stringify(storedResult) : null, error ? String(error).slice(0, 2000) : null,
    failureCode ? String(failureCode).slice(0, 80) : null, resultState ? String(resultState).slice(0, 80) : null,
    ts, ts, id, owner, node);
  return { ok: true };
}

export function getBrowserWorkerJob(ownerUserId, jobId) {
  const row = db().prepare(`SELECT * FROM browser_worker_jobs WHERE id = ? AND owner_user_id = ?`)
    .get(String(jobId || ''), String(ownerUserId || ''));
  if (!row) return null;
  return {
    id: row.id, owner_user_id: row.owner_user_id, action: row.action,
    args: parseJson(row.args_json, {}), status: row.status, result: parseJson(row.result_json, null),
    error: row.error || null, failure_code: row.failure_code || null, result_state: row.result_state || null,
    selected_node_id: row.selected_node_id || null, selected_driver_mode: row.selected_driver_mode || null,
    created_at: row.created_at, claimed_at: row.claimed_at, completed_at: row.completed_at,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function invokeViaBrowserWorker(ownerUserId, action, args = {}, options = {}) {
  let queued;
  try { queued = enqueueBrowserWorkerJob(ownerUserId, action, args, options); }
  catch (error) {
    return { ok: false, status: 503, text: error.message, via: 'local_executor', failure_code: error.code || 'EXECUTOR_OFFLINE' };
  }
  const deadline = Date.now() + JOB_TIMEOUT_MS();
  while (Date.now() < deadline) {
    const job = getBrowserWorkerJob(ownerUserId, queued.id);
    if (!job) return { ok: false, status: 500, text: 'job vanished', via: 'local_executor' };
    if (job.status === 'completed') {
      if (String(action).toLowerCase() === 'open' && job.result?.url) {
        try { assertUrlAllowed(ownerUserId, job.result.url); }
        catch (error) {
          return { ok: false, status: 403, text: error.message, via: job.selected_driver_mode, failure_code: 'URL_REDIRECT_BLOCKED' };
        }
      }
      return {
        ok: true, status: 200,
        text: typeof job.result === 'string' ? job.result : JSON.stringify(job.result ?? { ok: true }),
        via: job.selected_driver_mode || 'local_executor', node_id: job.selected_node_id,
      };
    }
    if (job.status === 'failed') return {
      ok: false, status: 500, text: job.error || 'browser executor job failed',
      via: job.selected_driver_mode || 'local_executor', failure_code: job.failure_code,
    };
    await sleep(400);
  }
  db().prepare(
    `UPDATE browser_worker_jobs SET status = 'failed', error = ?, failure_code = 'ACTION_TIMEOUT', result_state = 'outcome_uncertain', completed_at = ?, updated_at = ?
     WHERE id = ? AND owner_user_id = ? AND status IN ('queued','running')`
  ).run('job timed out waiting for browser executor', nowIso(), nowIso(), queued.id, ownerUserId);
  return { ok: false, status: 504, text: 'Browser executor job timed out', via: queued.node.driver_mode, failure_code: 'ACTION_TIMEOUT' };
}

export async function pullBrowserWorkerJob(ownerUserId, nodeId, waitMs = 0) {
  const maxWait = Math.min(55_000, Math.max(0, Number(waitMs) || 0));
  const deadline = Date.now() + maxWait;
  while (true) {
    const job = claimNextBrowserWorkerJob(ownerUserId, nodeId);
    if (job) return job;
    if (Date.now() >= deadline) return null;
    await sleep(Math.min(1000, deadline - Date.now()));
  }
}
