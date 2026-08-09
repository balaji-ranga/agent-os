/**
 * Local browser worker registry + job dispatch (owner-scoped).
 * Workers pull jobs outbound; browser-tasks enqueues when node online.
 */
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';

function db() {
  return getDb();
}

const OFFLINE_MS = () =>
  Math.max(15_000, Number(process.env.BROWSER_WORKER_OFFLINE_MS || 90_000));
const JOB_TIMEOUT_MS = () =>
  Math.max(10_000, Number(process.env.BROWSER_WORKER_JOB_TIMEOUT_MS || 120_000));

function nowIso() {
  return new Date().toISOString();
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw || '') ?? fallback;
  } catch {
    return fallback;
  }
}

export function getBrowserWorkerOfflineMs() {
  return OFFLINE_MS();
}

/**
 * Mark node online from register/heartbeat. Owner from authenticated token only.
 */
export function touchBrowserWorkerNode(ownerUserId, {
  tokenId = null,
  workerVersion = '',
  driverMode = 'playwright',
  capabilities = {},
  clientIp = null,
} = {}) {
  const id = String(ownerUserId || '').trim();
  if (!id) throw new Error('owner_user_id required');
  const ts = nowIso();
  const caps = JSON.stringify(capabilities && typeof capabilities === 'object' ? capabilities : {});
  db()
    .prepare(
      `INSERT INTO browser_worker_nodes
         (owner_user_id, token_id, online, last_heartbeat_at, worker_version, driver_mode, capabilities_json, last_client_ip, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_user_id) DO UPDATE SET
         token_id = COALESCE(excluded.token_id, browser_worker_nodes.token_id),
         online = 1,
         last_heartbeat_at = excluded.last_heartbeat_at,
         worker_version = excluded.worker_version,
         driver_mode = excluded.driver_mode,
         capabilities_json = excluded.capabilities_json,
         last_client_ip = excluded.last_client_ip,
         updated_at = excluded.updated_at`
    )
    .run(
      id,
      tokenId || null,
      ts,
      String(workerVersion || '').slice(0, 80),
      String(driverMode || 'playwright').slice(0, 40),
      caps,
      clientIp ? String(clientIp).slice(0, 80) : null,
      ts
    );
  return getBrowserWorkerNodeStatus(id);
}

export function markBrowserWorkerOffline(ownerUserId) {
  const id = String(ownerUserId || '').trim();
  if (!id) return false;
  const r = db()
    .prepare(
      `UPDATE browser_worker_nodes SET online = 0, updated_at = ? WHERE owner_user_id = ?`
    )
    .run(nowIso(), id);
  return r.changes > 0;
}

function isHeartbeatFresh(lastHeartbeatAt) {
  if (!lastHeartbeatAt) return false;
  const t = Date.parse(lastHeartbeatAt);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < OFFLINE_MS();
}

/**
 * Effective online status for an owner (demotes stale heartbeats).
 */
export function getBrowserWorkerNodeStatus(ownerUserId) {
  const id = String(ownerUserId || '').trim();
  if (!id) {
    return {
      online: false,
      last_heartbeat_at: null,
      worker_version: null,
      driver_mode: null,
      capabilities: {},
      last_client_ip: null,
      offline_after_ms: OFFLINE_MS(),
    };
  }
  const row = db()
    .prepare(`SELECT * FROM browser_worker_nodes WHERE owner_user_id = ?`)
    .get(id);
  if (!row) {
    return {
      online: false,
      last_heartbeat_at: null,
      worker_version: null,
      driver_mode: null,
      capabilities: {},
      last_client_ip: null,
      offline_after_ms: OFFLINE_MS(),
    };
  }
  const fresh = isHeartbeatFresh(row.last_heartbeat_at);
  if (row.online && !fresh) {
    db()
      .prepare(
        `UPDATE browser_worker_nodes SET online = 0, updated_at = ? WHERE owner_user_id = ?`
      )
      .run(nowIso(), id);
  }
  return {
    online: Boolean(row.online) && fresh,
    last_heartbeat_at: row.last_heartbeat_at || null,
    worker_version: row.worker_version || null,
    driver_mode: row.driver_mode || null,
    capabilities: parseJson(row.capabilities_json, {}),
    last_client_ip: row.last_client_ip || null,
    token_id: row.token_id || null,
    offline_after_ms: OFFLINE_MS(),
  };
}

export function isBrowserWorkerOnline(ownerUserId) {
  return Boolean(getBrowserWorkerNodeStatus(ownerUserId).online);
}

/**
 * Enqueue a browser action job for the owner's worker.
 * @returns {{ id: string }}
 */
export function enqueueBrowserWorkerJob(ownerUserId, action, args = {}) {
  const id = randomUUID();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id required');
  const act = String(action || '').trim();
  if (!act) throw new Error('action required');
  db()
    .prepare(
      `INSERT INTO browser_worker_jobs
       (id, owner_user_id, action, args_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?)`
    )
    .run(id, owner, act, JSON.stringify(args || {}), nowIso(), nowIso());
  console.info(
    '[browser-worker-dispatch] job queued owner=%s id=%s action=%s',
    owner,
    id,
    act
  );
  return { id };
}

/**
 * Worker claims next queued job (owner from token only).
 */
export function claimNextBrowserWorkerJob(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const row = db()
    .prepare(
      `SELECT * FROM browser_worker_jobs
       WHERE owner_user_id = ? AND status = 'queued'
       ORDER BY created_at ASC
       LIMIT 1`
    )
    .get(owner);
  if (!row) return null;
  const ts = nowIso();
  const updated = db()
    .prepare(
      `UPDATE browser_worker_jobs
       SET status = 'running', claimed_at = ?, updated_at = ?
       WHERE id = ? AND owner_user_id = ? AND status = 'queued'`
    )
    .run(ts, ts, row.id, owner);
  if (!updated.changes) return null;
  return {
    id: row.id,
    action: row.action,
    args: parseJson(row.args_json, {}),
    created_at: row.created_at,
  };
}

export function completeBrowserWorkerJob(ownerUserId, jobId, { ok, result = null, error = null } = {}) {
  const owner = String(ownerUserId || '').trim();
  const id = String(jobId || '').trim();
  const row = db()
    .prepare(
      `SELECT id, status FROM browser_worker_jobs WHERE id = ? AND owner_user_id = ?`
    )
    .get(id, owner);
  if (!row) return { ok: false, error: 'job not found' };
  if (row.status === 'completed' || row.status === 'failed') {
    return { ok: true, already: true };
  }
  const ts = nowIso();
  const status = ok ? 'completed' : 'failed';
  db()
    .prepare(
      `UPDATE browser_worker_jobs
       SET status = ?, result_json = ?, error = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND owner_user_id = ?`
    )
    .run(
      status,
      result != null ? JSON.stringify(result) : null,
      error ? String(error).slice(0, 2000) : null,
      ts,
      ts,
      id,
      owner
    );
  console.info(
    '[browser-worker-dispatch] job %s owner=%s id=%s',
    status,
    owner,
    id
  );
  return { ok: true };
}

export function getBrowserWorkerJob(ownerUserId, jobId) {
  const row = db()
    .prepare(
      `SELECT * FROM browser_worker_jobs WHERE id = ? AND owner_user_id = ?`
    )
    .get(String(jobId || ''), String(ownerUserId || ''));
  if (!row) return null;
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    action: row.action,
    args: parseJson(row.args_json, {}),
    status: row.status,
    result: parseJson(row.result_json, null),
    error: row.error || null,
    created_at: row.created_at,
    claimed_at: row.claimed_at,
    completed_at: row.completed_at,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Enqueue and wait for worker result. Shape matches invokeBrowserAction-ish for tasks.
 * @returns {Promise<{ ok: boolean, status: number, text: string, via: string }>}
 */
export async function invokeViaBrowserWorker(ownerUserId, action, args = {}) {
  if (!isBrowserWorkerOnline(ownerUserId)) {
    return {
      ok: false,
      status: 503,
      text: 'Local browser worker is offline for this account',
      via: 'desktop_worker',
    };
  }
  const { id } = enqueueBrowserWorkerJob(ownerUserId, action, args);
  const deadline = Date.now() + JOB_TIMEOUT_MS();
  while (Date.now() < deadline) {
    const job = getBrowserWorkerJob(ownerUserId, id);
    if (!job) {
      return { ok: false, status: 500, text: 'job vanished', via: 'desktop_worker' };
    }
    if (job.status === 'completed') {
      const body =
        typeof job.result === 'string'
          ? job.result
          : JSON.stringify(job.result ?? { ok: true });
      return { ok: true, status: 200, text: body, via: 'desktop_worker' };
    }
    if (job.status === 'failed') {
      return {
        ok: false,
        status: 500,
        text: job.error || 'browser worker job failed',
        via: 'desktop_worker',
      };
    }
    await sleep(400);
  }
  db()
    .prepare(
      `UPDATE browser_worker_jobs
       SET status = 'failed', error = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND owner_user_id = ? AND status IN ('queued','running')`
    )
    .run('job timed out waiting for local worker', nowIso(), nowIso(), id, ownerUserId);
  console.warn(
    '[browser-worker-dispatch] job timeout owner=%s id=%s action=%s',
    ownerUserId,
    id,
    action
  );
  return {
    ok: false,
    status: 504,
    text: 'Local browser worker job timed out',
    via: 'desktop_worker',
  };
}

/**
 * Long-poll helper: sleep then claim (used by route with short wait_ms).
 */
export async function pullBrowserWorkerJob(ownerUserId, waitMs = 0) {
  const maxWait = Math.min(55_000, Math.max(0, Number(waitMs) || 0));
  const deadline = Date.now() + maxWait;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const job = claimNextBrowserWorkerJob(ownerUserId);
    if (job) return job;
    if (Date.now() >= deadline) return null;
    await sleep(Math.min(1000, deadline - Date.now()));
  }
}
