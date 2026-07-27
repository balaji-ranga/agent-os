/**
 * Admin Docker tool onboarding: allowlist, deploy, discover, register as content tool.
 * Containers are internal-only (no host ports). Agents/workflows call via /api/tools/invoke.
 */
import { randomBytes } from 'crypto';
import { getDb } from '../db/schema.js';
import { createToolMeta, updateToolMeta, getToolMeta, writeOpenClawToolsList } from './content-tools-meta.js';
import {
  dockerToolsEnabled,
  dockerSocketPath,
  splitImageRef,
  pullImage,
  createContainer,
  startContainer,
  stopContainer,
  restartContainer,
  removeContainer,
  inspectContainer,
  listContainers,
  inspectSelfNetworks,
  pingDocker,
} from './docker-engine.js';

const LABEL_MANAGED = 'agent-os.managed';
const LABEL_TOOL = 'agent-os.tool';
const LABEL_NAME = 'agent-os.tool.name';
const LABEL_PORT = 'agent-os.tool.port';
const LABEL_PATH = 'agent-os.tool.path';

export function ensureDockerToolTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS docker_onboarded_tools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      purpose TEXT DEFAULT '',
      image TEXT NOT NULL,
      image_canonical TEXT,
      container_name TEXT,
      container_id TEXT,
      container_port INTEGER NOT NULL DEFAULT 8080,
      invoke_path TEXT NOT NULL DEFAULT '/',
      method TEXT NOT NULL DEFAULT 'POST',
      request_schema_json TEXT,
      response_schema_json TEXT,
      network_name TEXT,
      endpoint TEXT,
      auth_header TEXT,
      status TEXT NOT NULL DEFAULT 'declared',
      last_error TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_docker_tools_status ON docker_onboarded_tools(status)`);
}

function csvEnv(name) {
  return String(process.env[name] || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function getDockerToolsPolicy() {
  return {
    enabled: dockerToolsEnabled(),
    socket: dockerSocketPath(),
    registry_allow: csvEnv('DOCKER_TOOLS_REGISTRY_ALLOW'),
    registry_deny: csvEnv('DOCKER_TOOLS_REGISTRY_DENY'),
    network: String(process.env.DOCKER_TOOLS_NETWORK || '').trim() || null,
    max_memory_mb: Math.max(64, Number(process.env.DOCKER_TOOLS_MAX_MEMORY_MB) || 512),
    max_cpus: Math.max(0.1, Number(process.env.DOCKER_TOOLS_MAX_CPUS) || 1),
    stepup_required: true,
  };
}

export function assertDockerToolsEnabled() {
  if (!dockerToolsEnabled()) {
    const err = new Error('Docker tools onboarding is disabled (set DOCKER_TOOLS_ENABLED=1)');
    err.status = 503;
    throw err;
  }
}

/** Deny-list first; empty allow-list = deny all (fail closed). */
export function assertImageAllowed(imageRef) {
  const { registryPath, canonical } = splitImageRef(imageRef);
  const pathLower = registryPath.toLowerCase();
  for (const d of csvEnv('DOCKER_TOOLS_REGISTRY_DENY')) {
    if (pathLower === d || pathLower.startsWith(`${d}/`) || pathLower.startsWith(d)) {
      const err = new Error(`Image registry path denied by DOCKER_TOOLS_REGISTRY_DENY: ${canonical}`);
      err.status = 403;
      throw err;
    }
  }
  const allow = csvEnv('DOCKER_TOOLS_REGISTRY_ALLOW');
  if (!allow.length) {
    const err = new Error(
      'DOCKER_TOOLS_REGISTRY_ALLOW is empty — refuse all pulls (fail closed). Set allowed prefixes in deploy/.env'
    );
    err.status = 403;
    throw err;
  }
  const ok = allow.some((a) => pathLower === a || pathLower.startsWith(`${a}/`) || pathLower.startsWith(a));
  if (!ok) {
    const err = new Error(`Image not on allow-list: ${canonical}. Allowed prefixes: ${allow.join(', ')}`);
    err.status = 403;
    throw err;
  }
  return { registryPath, canonical };
}

function sanitizeToolName(name) {
  const n = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  if (!n || !/^[a-z][a-z0-9_]*$/.test(n)) {
    const err = new Error('name must start with a letter and use only a-z, 0-9, underscore');
    err.status = 400;
    throw err;
  }
  return n;
}

function sanitizePath(p) {
  let s = String(p || '/').trim() || '/';
  if (!s.startsWith('/')) s = `/${s}`;
  if (s.includes('://') || s.includes('..') || s.includes('\\')) {
    const err = new Error('invoke_path must be a simple absolute path');
    err.status = 400;
    throw err;
  }
  return s;
}

function aliasFor(toolName) {
  return `tool-${String(toolName).replace(/_/g, '-')}`;
}

function containerNameFor(toolName) {
  return `agent-os-tool-${String(toolName).replace(/_/g, '-')}`;
}

function endpointFor(toolName, port, invokePath) {
  // Prefer full container DNS name (hyphenated). Short alias remains on the network for discovery.
  return `http://${containerNameFor(toolName)}:${Number(port)}${sanitizePath(invokePath)}`;
}

async function waitForHttpReady(endpoint, method = 'POST', timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(endpoint, {
        method: method === 'GET' ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify({ ping: true }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.ok || res.status < 500) return { ok: true, status: res.status };
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e.message || String(e);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { ok: false, error: lastErr || 'timeout waiting for tool HTTP' };
}


async function restartOpenClawGatewayForNewTools() {
  if (String(process.env.DOCKER_TOOLS_RESTART_OPENCLAW || "1").trim() === "0") {
    console.info("[docker-tools] skip OpenClaw restart (DOCKER_TOOLS_RESTART_OPENCLAW=0)");
    return { skipped: true };
  }
  try {
    const containers = await listContainers({
      all: false,
      filters: { label: ["com.docker.compose.service=openclaw"] },
    });
    const target =
      containers.find((c) => (c.Names || []).some((n) => String(n).includes("openclaw"))) || containers[0];
    if (!target?.Id) {
      console.warn("[docker-tools] OpenClaw container not found for tools reload");
      return { ok: false, error: "openclaw container not found" };
    }
    await restartContainer(target.Id, { t: 5 });
    const name = (target.Names || [])[0] || target.Id.slice(0, 12);
    console.info(`[docker-tools] restarted OpenClaw for new tool registration name=${name}`);
    return { ok: true, name };
  } catch (e) {
    console.warn(`[docker-tools] OpenClaw restart failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}
function safeJson(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function rowPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    display_name: row.display_name,
    purpose: row.purpose || '',
    image: row.image,
    image_canonical: row.image_canonical,
    container_name: row.container_name,
    container_id: row.container_id,
    container_port: row.container_port,
    invoke_path: row.invoke_path,
    method: row.method || 'POST',
    request_schema: safeJson(row.request_schema_json),
    response_schema: safeJson(row.response_schema_json),
    network_name: row.network_name,
    endpoint: row.endpoint,
    auth_header_set: !!(row.auth_header && String(row.auth_header).trim()),
    status: row.status,
    last_error: row.last_error || null,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    content_tool: getToolMeta(row.name) || null,
  };
}

export function listDockerTools() {
  ensureDockerToolTables();
  return getDb()
    .prepare('SELECT * FROM docker_onboarded_tools ORDER BY updated_at DESC')
    .all()
    .map(rowPublic);
}

export function getDockerTool(name) {
  ensureDockerToolTables();
  const row = getDb()
    .prepare('SELECT * FROM docker_onboarded_tools WHERE name = ?')
    .get(sanitizeToolName(name));
  return rowPublic(row);
}

function getRaw(name) {
  return getDb()
    .prepare('SELECT * FROM docker_onboarded_tools WHERE name = ?')
    .get(sanitizeToolName(name));
}

function touch(id, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE docker_onboarded_tools SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map((k) => patch[k]), id);
}

export async function resolveToolsNetwork() {
  const forced = String(process.env.DOCKER_TOOLS_NETWORK || '').trim();
  if (forced) return forced;
  const nets = await inspectSelfNetworks();
  const preferred =
    nets.find((n) => /agent-os/i.test(n) && !/ingress/i.test(n)) ||
    nets.find((n) => !/ingress|none|host/i.test(n)) ||
    nets[0];
  if (!preferred) {
    const err = new Error(
      'Could not detect Docker network — set DOCKER_TOOLS_NETWORK in deploy/.env (e.g. agent-os_default)'
    );
    err.status = 503;
    throw err;
  }
  return preferred;
}

export function declareDockerTool(input, { createdBy }) {
  ensureDockerToolTables();
  assertDockerToolsEnabled();
  const name = sanitizeToolName(input.name);
  const image = String(input.image || '').trim();
  if (!image) {
    const err = new Error('image is required (Docker Hub / registry reference)');
    err.status = 400;
    throw err;
  }
  const { canonical } = assertImageAllowed(image);
  const display_name = String(input.display_name || name).trim();
  const purpose = String(input.purpose || '').trim();
  const container_port = Math.min(65535, Math.max(1, Number(input.container_port) || 8080));
  const invoke_path = sanitizePath(input.invoke_path || '/');
  const method = String(input.method || 'POST').trim().toUpperCase() === 'GET' ? 'GET' : 'POST';
  const auth_header = String(input.auth_header || '').trim() || null;
  const request_schema_json =
    input.request_schema != null
      ? typeof input.request_schema === 'string'
        ? input.request_schema
        : JSON.stringify(input.request_schema)
      : null;
  const response_schema_json =
    input.response_schema != null
      ? typeof input.response_schema === 'string'
        ? input.response_schema
        : JSON.stringify(input.response_schema)
      : null;

  const existing = getRaw(name);
  const endpoint = endpointFor(name, container_port, invoke_path);
  const cname = containerNameFor(name);

  if (existing) {
    touch(existing.id, {
      display_name,
      purpose,
      image,
      image_canonical: canonical,
      container_name: cname,
      container_port,
      invoke_path,
      method,
      request_schema_json,
      response_schema_json,
      endpoint,
      auth_header,
      status: existing.status === 'running' ? existing.status : 'declared',
      last_error: null,
    });
    console.info(`[docker-tools] updated declaration name=${name} image=${canonical}`);
    return getDockerTool(name);
  }

  const id = `dt-${randomBytes(6).toString('hex')}`;
  getDb()
    .prepare(
      `INSERT INTO docker_onboarded_tools
        (id, name, display_name, purpose, image, image_canonical, container_name, container_port,
         invoke_path, method, request_schema_json, response_schema_json, endpoint, auth_header,
         status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'declared', ?)`
    )
    .run(
      id,
      name,
      display_name,
      purpose,
      image,
      canonical,
      cname,
      container_port,
      invoke_path,
      method,
      request_schema_json,
      response_schema_json,
      endpoint,
      auth_header,
      createdBy || null
    );
  console.info(`[docker-tools] declared name=${name} image=${canonical} by=${createdBy || '?'}`);
  return getDockerTool(name);
}

export async function pullDockerTool(name) {
  assertDockerToolsEnabled();
  const row = getRaw(name);
  if (!row) {
    const err = new Error('Tool not found');
    err.status = 404;
    throw err;
  }
  assertImageAllowed(row.image);
  touch(row.id, { status: 'pulling', last_error: null });
  try {
    await pullImage(row.image);
    touch(row.id, { status: 'pulled', last_error: null });
    console.info(`[docker-tools] pulled name=${row.name} image=${row.image}`);
    return getDockerTool(row.name);
  } catch (e) {
    touch(row.id, { status: 'error', last_error: e.message || String(e) });
    throw e;
  }
}

function memoryBytes() {
  return Math.max(64, Number(process.env.DOCKER_TOOLS_MAX_MEMORY_MB) || 512) * 1024 * 1024;
}

function nanoCpus() {
  return Math.round(Math.max(0.1, Number(process.env.DOCKER_TOOLS_MAX_CPUS) || 1) * 1e9);
}

export async function deployDockerTool(name) {
  assertDockerToolsEnabled();
  const row = getRaw(name);
  if (!row) {
    const err = new Error('Tool not found');
    err.status = 404;
    throw err;
  }
  assertImageAllowed(row.image);
  const network = await resolveToolsNetwork();
  const cname = containerNameFor(row.name);
  const alias = aliasFor(row.name);
  const port = Number(row.container_port) || 8080;

  try {
    const existingList = await listContainers({
      all: true,
      filters: { name: [cname] },
    });
    for (const c of existingList) {
      const labels = c.Labels || {};
      if (labels[LABEL_MANAGED] !== '1') continue;
      try {
        await removeContainer(c.Id, { force: true });
      } catch (e) {
        console.warn(`[docker-tools] remove prior container failed: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`[docker-tools] list prior containers: ${e.message}`);
  }

  touch(row.id, { status: 'deploying', last_error: null, network_name: network });

  const body = {
    Image: row.image,
    Hostname: alias,
    Labels: {
      [LABEL_MANAGED]: '1',
      [LABEL_TOOL]: '1',
      [LABEL_NAME]: row.name,
      [LABEL_PORT]: String(port),
      [LABEL_PATH]: row.invoke_path || '/',
    },
    Env: [],
    ExposedPorts: { [`${port}/tcp`]: {} },
    HostConfig: {
      NetworkMode: network,
      PortBindings: {},
      PublishAllPorts: false,
      Privileged: false,
      ReadonlyRootfs: false,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      Memory: memoryBytes(),
      NanoCpus: nanoCpus(),
      RestartPolicy: { Name: 'unless-stopped' },
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [network]: {
          Aliases: [alias, cname],
        },
      },
    },
  };

  try {
    await pullImage(row.image);
    const created = await createContainer({ name: cname, body });
    const id = created.data?.Id || created.data?.id;
    if (!id) throw Object.assign(new Error('Docker create returned no container id'), { status: 502 });
    await startContainer(id);
    const endpoint = endpointFor(row.name, port, row.invoke_path);
    const ready = await waitForHttpReady(endpoint, row.method || 'POST', 25000);
    if (!ready.ok) {
      console.warn(`[docker-tools] container started but HTTP not ready name=${row.name} err=${ready.error}`);
    }
    touch(row.id, {
      status: 'running',
      container_id: id,
      container_name: cname,
      network_name: network,
      endpoint,
      last_error: ready.ok ? null : `started but HTTP not ready: ${ready.error}`,
    });

    const meta = {
      name: row.name,
      display_name: row.display_name,
      endpoint,
      method: row.method || 'POST',
      purpose: row.purpose || `Docker tool ${row.name}`,
      model_used: '',
      auth_header: row.auth_header || '',
    };
    if (getToolMeta(row.name)) {
      updateToolMeta(row.name, {
        display_name: meta.display_name,
        endpoint: meta.endpoint,
        method: meta.method,
        purpose: meta.purpose,
        enabled: true,
        auth_header: meta.auth_header,
      });
    } else {
      createToolMeta(meta);
    }
    writeOpenClawToolsList();
    const ocReload = await restartOpenClawGatewayForNewTools();
    console.info(
      `[docker-tools] deployed name=${row.name} container=${cname} network=${network} endpoint=${endpoint} openclaw_reload=${JSON.stringify(ocReload)}`
    );
    return getDockerTool(row.name);
  } catch (e) {
    touch(row.id, { status: 'error', last_error: e.message || String(e) });
    throw e;
  }
}

export async function stopDockerTool(name) {
  assertDockerToolsEnabled();
  const row = getRaw(name);
  if (!row?.container_id) {
    const err = new Error('No running container');
    err.status = 404;
    throw err;
  }
  await stopContainer(row.container_id);
  touch(row.id, { status: 'stopped', last_error: null });
  console.info(`[docker-tools] stopped name=${row.name}`);
  return getDockerTool(row.name);
}

export async function restartDockerTool(name) {
  assertDockerToolsEnabled();
  const row = getRaw(name);
  if (!row?.container_id) {
    const err = new Error('No container to restart');
    err.status = 404;
    throw err;
  }
  await restartContainer(row.container_id);
  touch(row.id, { status: 'running', last_error: null });
  console.info(`[docker-tools] restarted name=${row.name}`);
  return getDockerTool(row.name);
}

export async function deleteDockerTool(name, { removeContentTool = false } = {}) {
  assertDockerToolsEnabled();
  const row = getRaw(name);
  if (!row) {
    const err = new Error('Tool not found');
    err.status = 404;
    throw err;
  }
  if (row.container_id) {
    try {
      await removeContainer(row.container_id, { force: true });
    } catch (e) {
      console.warn(`[docker-tools] remove container: ${e.message}`);
    }
  }
  getDb().prepare('DELETE FROM docker_onboarded_tools WHERE id = ?').run(row.id);
  if (removeContentTool && getToolMeta(row.name)) {
    updateToolMeta(row.name, { enabled: false });
  }
  console.info(`[docker-tools] deleted declaration name=${row.name}`);
  return { ok: true, name: row.name };
}

export async function discoverDockerTools() {
  assertDockerToolsEnabled();
  const containers = await listContainers({
    all: true,
    filters: { label: [`${LABEL_TOOL}=1`, `${LABEL_MANAGED}=1`] },
  });
  return containers.map((c) => {
    const labels = c.Labels || {};
    const rawName = labels[LABEL_NAME] || (c.Names?.[0] || '').replace(/^\//, '');
    const port = Number(labels[LABEL_PORT]) || null;
    const path = labels[LABEL_PATH] || '/';
    let toolName = String(rawName).replace(/^agent-os-tool-/, '');
    try {
      toolName = sanitizeToolName(toolName);
    } catch {
      /* keep raw */
    }
    return {
      container_id: c.Id,
      names: c.Names,
      image: c.Image,
      state: c.State,
      status: c.Status,
      tool_name: toolName,
      port,
      path,
      endpoint: port ? endpointFor(toolName, port, path) : null,
      labels,
    };
  });
}

export async function healthDockerTool(name) {
  const row = getRaw(name);
  if (!row) {
    const err = new Error('Tool not found');
    err.status = 404;
    throw err;
  }
  let inspect = null;
  if (row.container_id) {
    try {
      inspect = await inspectContainer(row.container_id);
    } catch (e) {
      return { ok: false, name: row.name, error: e.message, tool: getDockerTool(row.name) };
    }
  }
  const running = !!inspect?.State?.Running;
  let http = null;
  if (running && row.endpoint) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(row.endpoint, {
        method: row.method === 'GET' ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: row.method === 'GET' ? undefined : JSON.stringify({ ping: true }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      http = { status: res.status, ok: res.ok };
    } catch (e) {
      http = { ok: false, error: e.message };
    }
  }
  return {
    ok: running,
    name: row.name,
    running,
    http,
    endpoint: row.endpoint,
    tool: getDockerTool(row.name),
  };
}

export async function dockerToolsStatus() {
  const policy = getDockerToolsPolicy();
  let docker_ok = false;
  let docker_error = null;
  if (policy.enabled) {
    try {
      docker_ok = await pingDocker();
    } catch (e) {
      docker_error = e.message;
    }
  }
  let network = policy.network;
  if (!network && docker_ok) {
    try {
      network = await resolveToolsNetwork();
    } catch (e) {
      docker_error = docker_error || e.message;
    }
  }
  return {
    ...policy,
    network_resolved: network,
    docker_ok,
    docker_error,
    tools: listDockerTools(),
  };
}
