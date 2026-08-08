/**
 * Admin TLS / Let's Encrypt cert status + refresh jobs.
 * Refresh runs host scripts via Docker (chroot host rootfs) when docker.sock is available.
 * Privileged: platform admin + TOTP step-up (purpose tls_certs).
 */
import { randomBytes } from 'crypto';
import { getDb } from '../db/schema.js';
import {
  dockerToolsEnabled,
  dockerSocketPath,
  request,
  listContainers,
  createContainer,
  startContainer,
  removeContainer,
  pullImage,
  pingDocker,
} from './docker-engine.js';

const PURPOSE = 'tls_certs';
const JOB_TTL_HOURS = 48;
const DEFAULT_HOST_ROOT = '/opt/agent-os';
const RUNNER_IMAGE = String(process.env.TLS_CERT_RUNNER_IMAGE || 'alpine:3.20').trim();

/** In-process job tail (also persisted to SQLite). */
const liveJobs = new Map();

export function tlsCertsStepupPurpose() {
  return PURPOSE;
}

function hostRoot() {
  return String(process.env.AGENT_OS_HOST_ROOT || process.env.AGENT_OS_ROOT || DEFAULT_HOST_ROOT)
    .trim()
    .replace(/\/+$/, '');
}

export function ensureTlsCertJobsTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS admin_tls_cert_jobs (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      status TEXT NOT NULL,
      started_by TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      exit_code INTEGER,
      log_text TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tls_cert_jobs_started ON admin_tls_cert_jobs(started_at DESC);
  `);
  getDb()
    .prepare(
      `DELETE FROM admin_tls_cert_jobs WHERE started_at < datetime('now', ?)`
    )
    .run(`-${JOB_TTL_HOURS} hours`);
}

function appendLog(jobId, chunk) {
  const line = String(chunk || '');
  if (!line) return;
  const j = liveJobs.get(jobId);
  if (j) j.log = (j.log || '') + line;
  try {
    const row = getDb().prepare(`SELECT log_text FROM admin_tls_cert_jobs WHERE id = ?`).get(jobId);
    const next = String(row?.log_text || '') + line;
    // cap ~200k
    const capped = next.length > 200000 ? next.slice(-200000) : next;
    getDb().prepare(`UPDATE admin_tls_cert_jobs SET log_text = ? WHERE id = ?`).run(capped, jobId);
  } catch {
    /* best effort */
  }
}

async function dockerRequest(method, path, opts = {}) {
  return request(method, path, opts);
}

async function dockerExecInContainer(containerId, cmd, { timeoutMs = 15000 } = {}) {
  const create = await dockerRequest('POST', `/containers/${encodeURIComponent(containerId)}/exec`, {
    body: {
      AttachStdout: true,
      AttachStderr: true,
      Cmd: cmd,
    },
    timeoutMs: 30000,
  });
  const execId = create.data?.Id;
  if (!execId) throw Object.assign(new Error('Docker exec create failed'), { status: 502 });

  // start with hijack — Docker multiplexed stream is awkward; use Detach and then logs isn't available.
  // Prefer JSON attach via /exec/{id}/start with stream and collect.
  const socketPath = dockerSocketPath();
  const http = await import('http');
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ Detach: false, Tty: false }));
    const req = http.request(
      {
        socketPath,
        path: `/exec/${encodeURIComponent(execId)}/start`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          Connection: 'Upgrade',
          Upgrade: 'tcp',
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          // tty=false multiplex frames: 8-byte header + payload
          const buf = Buffer.concat(chunks);
          let out = '';
          let i = 0;
          while (i + 8 <= buf.length) {
            const size = buf.readUInt32BE(i + 4);
            const payload = buf.slice(i + 8, i + 8 + size);
            out += payload.toString('utf8');
            i += 8 + size;
          }
          if (!out && buf.length) out = buf.toString('utf8');
          resolve(out);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(Object.assign(new Error('docker exec timeout'), { status: 504 }));
    });
    req.write(body);
    req.end();
  });
}

async function findContainerName(fragments, { preferRunning = true } = {}) {
  const list = await listContainers({ all: true });
  const scored = [];
  for (const c of list) {
    const names = (c.Names || []).map((n) => String(n).replace(/^\//, ''));
    const joined = names.join(' ').toLowerCase();
    if (!fragments.every((f) => joined.includes(String(f).toLowerCase()))) continue;
    // Prefer compose service-style names (…-nginx-1) over accidental matches
    const primary = names[0] || '';
    let score = preferRunning && c.State === 'running' ? 10 : 0;
    if (/-nginx-?\d*$/i.test(primary) || /_nginx(?:_\d+)?$/i.test(primary)) score += 5;
    if (/-twenty-db-?\d*$/i.test(primary) || /twenty-db/i.test(primary)) score += 5;
    scored.push({ name: primary, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.name || null;
}

async function readCertViaRunner() {
  const hostCert = `${hostRoot()}/deploy/nginx/certs/fullchain.pem`;
  const name = `agent-os-tls-read-${Date.now().toString(36)}`;
  let id = null;
  try {
    await ensureRunnerImage();
    const create = await createContainer({
      name,
      body: {
        Image: RUNNER_IMAGE,
        Cmd: [
          'sh',
          '-c',
          `apk add --no-cache openssl >/dev/null 2>&1; openssl x509 -in /host${hostCert} -noout -subject -dates -ext subjectAltName 2>/dev/null || openssl x509 -in /host${hostCert} -noout -text 2>/dev/null | head -50`,
        ],
        HostConfig: {
          Binds: ['/:/host:ro'],
          AutoRemove: false,
        },
      },
    });
    id = create.data?.Id;
    if (!id) return null;
    await startContainer(id);
    await waitContainer(id, 120000);
    return await containerLogs(id);
  } catch {
    return null;
  } finally {
    if (id) {
      try {
        await removeContainer(id, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

export async function getTlsCertStatus() {
  ensureTlsCertJobsTable();
  const out = {
    docker_socket: dockerToolsEnabled() || false,
    docker_ping: false,
    host_root: hostRoot(),
    runner_image: RUNNER_IMAGE,
    scripts: {
      refresh: `${hostRoot()}/deploy/scripts/vps-refresh-tls-certs.sh`,
      expand_login: `${hostRoot()}/deploy/scripts/vps-expand-login-cert.sh`,
      expand_crm: `${hostRoot()}/deploy/scripts/vps-expand-crm-cert.sh`,
      ensure_crm_dns: `${hostRoot()}/deploy/scripts/vps-ensure-crm-workspace-dns-cert.sh`,
    },
    certificate: null,
    crm_workspaces: [],
    notes: [
      'Refresh uses acme.sh TLS-ALPN on :443 (stops nginx briefly).',
      'CRM multi-workspace hosts need DNS A (e.g. *.crm → VPS) before SANs can be added.',
      'Wildcard LE certs require DNS-01; this tool issues per-FQDN SANs.',
    ],
  };

  try {
    out.docker_ping = await pingDocker();
  } catch {
    out.docker_ping = false;
  }
  out.docker_socket_ok = out.docker_ping;

  // Certificate SANs via nginx container (fallback: alpine + host cert bind)
  try {
    let pemText = '';
    let source = null;
    const nginx = await findContainerName(['nginx']);
    if (nginx) {
      try {
        pemText = await dockerExecInContainer(nginx, [
          'sh',
          '-c',
          'openssl x509 -in /etc/nginx/certs/fullchain.pem -noout -subject -dates -ext subjectAltName 2>/dev/null || openssl x509 -in /etc/nginx/certs/fullchain.pem -noout -text 2>/dev/null | head -40',
        ]);
        source = `container:${nginx}`;
      } catch {
        pemText = '';
      }
    }
    if (!pemText || !/DNS:|notAfter=/i.test(pemText)) {
      const viaHost = await readCertViaRunner();
      if (viaHost) {
        pemText = viaHost;
        source = 'host:fullchain.pem';
      }
    }
    if (pemText && /DNS:|notAfter=|subject=/i.test(pemText)) {
      const sans = [];
      const sanMatch = pemText.match(/DNS:([a-zA-Z0-9.*-]+)/g) || [];
      for (const m of sanMatch) {
        const h = m.replace(/^DNS:/, '');
        if (h && !sans.includes(h)) sans.push(h);
      }
      const notBefore = (pemText.match(/notBefore=([^\n]+)/i) || [])[1] || null;
      const notAfter = (pemText.match(/notAfter=([^\n]+)/i) || [])[1] || null;
      const subject = (pemText.match(/subject=([^\n]+)/i) || [])[1] || null;
      out.certificate = {
        subject,
        not_before: notBefore,
        not_after: notAfter,
        sans,
        source,
        raw_snippet: pemText.slice(0, 1200),
      };
    } else {
      out.certificate = { error: 'Could not read fullchain.pem (nginx exec and host path failed)' };
    }
  } catch (e) {
    out.certificate = { error: e.message || String(e) };
  }

  // Twenty workspace subdomains (for CRM SAN planning)
  try {
    const tdb = await findContainerName(['twenty-db']);
    if (tdb) {
      const sql =
        'SELECT subdomain, "displayName", "activationStatus" FROM core.workspace WHERE "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 50';
      const raw = await dockerExecInContainer(tdb, [
        'psql',
        '-U',
        'twenty',
        '-d',
        'twenty',
        '-t',
        '-A',
        '-F',
        '|',
        '-c',
        sql,
      ]);
      out.crm_workspaces = String(raw || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [subdomain, displayName, activationStatus] = line.split('|');
          return {
            subdomain: subdomain || '',
            display_name: displayName || '',
            activation_status: activationStatus || '',
            host: subdomain ? `${subdomain}.crm.flolah.cloud` : null,
            on_cert: Boolean(
              subdomain &&
                out.certificate?.sans?.some(
                  (s) => s === `${subdomain}.crm.flolah.cloud` || s === `*.crm.flolah.cloud`
                )
            ),
          };
        });
    }
  } catch (e) {
    out.crm_workspaces_error = e.message || String(e);
  }

  out.scopes = [
    {
      id: 'all',
      label: 'All (platform + CRM workspaces)',
      description:
        'Runs vps-ensure-crm-workspace-dns-cert.sh → vps-expand-crm-cert.sh (SANs for flolah/www/login/crm + ACTIVE workspace subdomains with public DNS). Falls back to platform expand if CRM DNS incomplete.',
    },
    {
      id: 'platform',
      label: 'Platform only',
      description: 'Runs vps-expand-login-cert.sh — flolah.cloud, www, login only.',
    },
    {
      id: 'crm',
      label: 'CRM workspaces',
      description:
        'Runs vps-ensure-crm-workspace-dns-cert.sh (requires *.crm or per-workspace DNS A records).',
    },
  ];

  return out;
}

export function listTlsCertJobs({ limit = 20 } = {}) {
  ensureTlsCertJobsTable();
  const lim = Math.min(50, Math.max(1, Number(limit) || 20));
  return getDb()
    .prepare(
      `SELECT id, scope, status, started_by, started_at, finished_at, exit_code, error,
              length(coalesce(log_text,'')) AS log_bytes
       FROM admin_tls_cert_jobs ORDER BY started_at DESC LIMIT ?`
    )
    .all(lim);
}

export function getTlsCertJob(jobId) {
  ensureTlsCertJobsTable();
  const row = getDb().prepare(`SELECT * FROM admin_tls_cert_jobs WHERE id = ?`).get(jobId);
  if (!row) return null;
  const live = liveJobs.get(jobId);
  return {
    ...row,
    log_text: live?.log ?? row.log_text,
  };
}

function anyJobRunning() {
  ensureTlsCertJobsTable();
  const row = getDb()
    .prepare(`SELECT id FROM admin_tls_cert_jobs WHERE status = 'running' LIMIT 1`)
    .get();
  return row?.id || null;
}

/**
 * Start async cert refresh job. Returns job id immediately.
 */
export async function startTlsCertRefresh({ scope = 'all', startedBy } = {}) {
  ensureTlsCertJobsTable();
  const sc = String(scope || 'all')
    .toLowerCase()
    .replace(/[^a-z_]/g, '');
  if (!['all', 'platform', 'crm'].includes(sc)) {
    throw Object.assign(new Error('scope must be all | platform | crm'), { status: 400 });
  }

  const running = anyJobRunning();
  if (running) {
    throw Object.assign(new Error(`Another TLS refresh is already running (job ${running})`), {
      status: 409,
    });
  }

  if (!(await pingDocker().catch(() => false))) {
    throw Object.assign(
      new Error(
        'Docker socket unavailable — enable docker-compose.docker-tools.yml (DOCKER_TOOLS_ENABLED) on the VPS'
      ),
      { status: 503 }
    );
  }

  const jobId = `tls-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const startedAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO admin_tls_cert_jobs (id, scope, status, started_by, started_at, log_text)
       VALUES (?, ?, 'running', ?, ?, ?)`
    )
    .run(jobId, sc, startedBy || null, startedAt, '');
  liveJobs.set(jobId, { log: '', status: 'running' });

  // fire and forget
  setImmediate(() => {
    runTlsCertJob(jobId, sc).catch((e) => {
      console.warn('[tls-cert-admin] job failed', jobId, e?.message || e);
    });
  });

  console.info(`[tls-cert-admin] started job=${jobId} scope=${sc} by=${startedBy || '?'}`);
  return { job_id: jobId, scope: sc, status: 'running', started_at: startedAt };
}

async function waitContainer(id, timeoutMs = 25 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const { data } = await dockerRequest('POST', `/containers/${encodeURIComponent(id)}/wait`, {
        timeoutMs: Math.min(120000, timeoutMs),
      });
      return typeof data?.StatusCode === 'number' ? data.StatusCode : 1;
    } catch (e) {
      // timeout on wait request — inspect
      try {
        const { data: info } = await dockerRequest(
          'GET',
          `/containers/${encodeURIComponent(id)}/json`,
          { timeoutMs: 10000 }
        );
        if (info?.State && info.State.Running === false) {
          return info.State.ExitCode ?? 1;
        }
      } catch {
        /* retry */
      }
      if (Date.now() - started > timeoutMs) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw Object.assign(new Error('cert refresh timed out waiting for runner container'), {
    status: 504,
  });
}

async function containerLogs(id) {
  // GET /containers/{id}/logs?stdout=1&stderr=1
  const socketPath = dockerSocketPath();
  const http = await import('http');
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path: `/containers/${encodeURIComponent(id)}/logs?stdout=1&stderr=1&timestamps=0`,
        method: 'GET',
        headers: { Accept: 'application/vnd.docker.raw-stream' },
        timeout: 60000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          let out = '';
          let i = 0;
          while (i + 8 <= buf.length) {
            const size = buf.readUInt32BE(i + 4);
            const payload = buf.slice(i + 8, i + 8 + size);
            out += payload.toString('utf8');
            i += 8 + size;
          }
          if (!out && buf.length) out = buf.toString('utf8');
          resolve(out);
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function ensureRunnerImage() {
  try {
    await dockerRequest('GET', `/images/${encodeURIComponent(RUNNER_IMAGE)}/json`, {
      timeoutMs: 10000,
    });
  } catch {
    appendLogGlobal(`Pulling runner image ${RUNNER_IMAGE}…\n`);
    await pullImage(RUNNER_IMAGE);
  }
}

let globalLogSink = null;
function appendLogGlobal(s) {
  if (globalLogSink) appendLog(globalLogSink, s);
}

async function runTlsCertJob(jobId, scope) {
  globalLogSink = jobId;
  const containerName = `agent-os-tls-cert-${jobId}`;
  let containerId = null;
  try {
    appendLog(jobId, `Starting TLS refresh scope=${scope}\n`);
    appendLog(jobId, `Host root ${hostRoot()}\n`);
    await ensureRunnerImage();

    // chroot into host so acme.sh, dig, docker, compose match VPS host tools
    const script = `${hostRoot()}/deploy/scripts/vps-refresh-tls-certs.sh`;
    const cmd = [
      'sh',
      '-c',
      `chroot /host /bin/bash ${JSON.stringify(script)} ${JSON.stringify(scope)}`,
    ];

    try {
      await removeContainer(containerName, { force: true }).catch(() => {});
    } catch {
      /* ok */
    }

    const create = await createContainer({
      name: containerName,
      body: {
        Image: RUNNER_IMAGE,
        Cmd: cmd,
        HostConfig: {
          Privileged: true,
          NetworkMode: 'host',
          Binds: ['/:/host'],
          AutoRemove: false,
        },
        Labels: {
          'agent-os.managed': 'tls-cert-refresh',
          'agent-os.job': jobId,
        },
      },
    });
    containerId = create.data?.Id;
    if (!containerId) throw new Error('Failed to create runner container');

    appendLog(jobId, `Runner container ${containerId.slice(0, 12)}\n`);
    await startContainer(containerId);
    const exitCode = await waitContainer(containerId);
    let logs = '';
    try {
      logs = await containerLogs(containerId);
    } catch (e) {
      logs = `(log fetch failed: ${e.message})\n`;
    }
    appendLog(jobId, logs);
    appendLog(jobId, `\nexit_code=${exitCode}\n`);

    const ok = exitCode === 0;
    getDb()
      .prepare(
        `UPDATE admin_tls_cert_jobs SET status = ?, finished_at = datetime('now'), exit_code = ?, error = ?
         WHERE id = ?`
      )
      .run(ok ? 'succeeded' : 'failed', exitCode, ok ? null : `exit ${exitCode}`, jobId);
    const live = liveJobs.get(jobId);
    if (live) live.status = ok ? 'succeeded' : 'failed';
    console.info(`[tls-cert-admin] job=${jobId} finished exit=${exitCode}`);
  } catch (e) {
    const msg = e?.message || String(e);
    appendLog(jobId, `\nERROR: ${msg}\n`);
    getDb()
      .prepare(
        `UPDATE admin_tls_cert_jobs SET status = 'failed', finished_at = datetime('now'), error = ? WHERE id = ?`
      )
      .run(msg.slice(0, 2000), jobId);
    const live = liveJobs.get(jobId);
    if (live) live.status = 'failed';
  } finally {
    globalLogSink = null;
    if (containerId) {
      try {
        await removeContainer(containerId, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}
