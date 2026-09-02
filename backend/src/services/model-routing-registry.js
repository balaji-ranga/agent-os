import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';

const ROUTE_ALIASES = Object.freeze([
  'flolah-platform-primary',
  'flolah-platform-secondary',
  'flolah-platform-active',
  'flolah-efficiency',
  'flolah-local-reasoning',
  'flolah-realtime',
  'flolah-embedding',
]);

const PROVIDER_TYPES = new Set([
  'openai',
  'deepseek',
  'ollama',
  'litellm',
  'vllm',
  'openai_compatible',
  'embedding',
]);

function enabled(value) {
  return value === true || value === 1 || String(value || '').toLowerCase() === 'true' || String(value) === '1';
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function ensureModelRoutingTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_deployments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      secret_ref TEXT NOT NULL DEFAULT '',
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      builtin INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS model_routes (
      alias TEXT PRIMARY KEY,
      capability TEXT NOT NULL DEFAULT 'chat',
      primary_deployment_id TEXT NOT NULL,
      fallback_deployment_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS model_route_events (
      id TEXT PRIMARY KEY,
      route_alias TEXT NOT NULL,
      deployment_id TEXT,
      outcome TEXT NOT NULL,
      model_used TEXT,
      endpoint_host TEXT,
      source TEXT,
      owner_user_id TEXT,
      latency_ms INTEGER,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_model_route_events_created
      ON model_route_events(created_at DESC);
  `);
  seedBuiltinModelRouting();
}

function upsertBuiltinDeployment(row) {
  getDb().prepare(`
    INSERT INTO model_deployments
      (id, name, provider_type, base_url, model, secret_ref, capabilities_json, enabled, builtin, updated_at)
    VALUES (@id, @name, @provider_type, @base_url, @model, @secret_ref, @capabilities_json, @enabled, 1, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      provider_type=excluded.provider_type,
      base_url=excluded.base_url,
      model=excluded.model,
      secret_ref=excluded.secret_ref,
      capabilities_json=excluded.capabilities_json,
      enabled=excluded.enabled,
      builtin=1,
      updated_at=datetime('now')
  `).run(row);
}

function envEndpoint(prefix, fallbackBaseUrl = '', fallbackModel = '') {
  const baseUrl = clean(
    process.env[`${prefix}_BASE_URL`] ||
      (prefix === 'OPENAI_PRIMARY' ? process.env.OPENAI_BASE_URL : '') ||
      fallbackBaseUrl
  );
  const model = clean(
    process.env[`${prefix}_MODEL`] ||
      (prefix === 'OPENAI_PRIMARY' ? process.env.OPENCLAW_MODEL_PRIMARY?.replace(/^[^/]+\//, '') : '') ||
      fallbackModel,
    160
  );
  return { baseUrl, model };
}

export function seedBuiltinModelRouting() {
  const primary = envEndpoint('OPENAI_PRIMARY', 'https://api.openai.com/v1', 'gpt-4o-mini');
  const secondary = envEndpoint('OPENAI_SECONDARY');
  const ollamaBase = clean(process.env.OLLAMA_BASE_URL || 'http://ollama:11434').replace(/\/$/, '');
  const rows = [
    {
      id: 'platform-primary', name: 'Platform primary', provider_type: 'openai_compatible',
      base_url: primary.baseUrl, model: primary.model, secret_ref: 'env:OPENAI_PRIMARY_API_KEY',
      capabilities_json: '["chat","tools","json"]', enabled: 1,
    },
    {
      id: 'platform-secondary', name: 'Platform secondary', provider_type: 'openai_compatible',
      base_url: secondary.baseUrl, model: secondary.model, secret_ref: 'env:OPENAI_SECONDARY_API_KEY',
      capabilities_json: '["chat","tools","json"]', enabled: secondary.baseUrl && secondary.model ? 1 : 0,
    },
    {
      id: 'ollama-efficiency', name: 'Ollama efficiency', provider_type: 'ollama',
      base_url: `${ollamaBase}/v1`, model: clean(process.env.OLLAMA_MODEL || 'llama3.2', 160),
      secret_ref: 'internal:ollama', capabilities_json: '["chat","json"]', enabled: 1,
    },
    {
      id: 'ollama-reasoning', name: 'Ollama local reasoning', provider_type: 'ollama',
      base_url: `${ollamaBase}/v1`, model: clean(process.env.DEEPSEEK_FALLBACK_MODEL || 'deepseek-r1:8b', 160),
      secret_ref: 'internal:ollama', capabilities_json: '["chat","reasoning"]', enabled: 1,
    },
    {
      id: 'litellm-gateway', name: 'LiteLLM gateway', provider_type: 'litellm',
      base_url: clean(process.env.LITELLM_BASE_URL || 'http://litellm:4000/v1'), model: '',
      secret_ref: 'env:LITELLM_MASTER_KEY', capabilities_json: '["routing","chat","tools","json"]',
      enabled: enabled(process.env.MODEL_ROUTING_ENABLED) ? 1 : 0,
    },
    {
      id: 'vllm-future', name: 'vLLM deployment (disabled)', provider_type: 'vllm',
      base_url: clean(process.env.VLLM_BASE_URL || 'http://vllm:8000/v1'), model: clean(process.env.VLLM_MODEL || '', 160),
      secret_ref: 'env:VLLM_API_KEY', capabilities_json: '["chat","tools"]', enabled: 0,
    },
    {
      id: 'realtime-openai', name: 'OpenAI Realtime', provider_type: 'openai',
      base_url: clean(process.env.OPENAI_REALTIME_BASE_URL || 'https://api.openai.com/v1'),
      model: clean(process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview', 160),
      secret_ref: 'env:OPENAI_REALTIME_API_KEY', capabilities_json: '["realtime","audio"]', enabled: 1,
    },
    {
      id: 'qwen-embeddings', name: 'Qwen embeddings', provider_type: 'embedding',
      base_url: clean(process.env.OPENSEARCH_EMBEDDING_BASE_URL || 'http://embeddings:8080/v1'),
      model: clean(process.env.EMBEDDING_MODEL_ID || 'Qwen/Qwen3-Embedding-0.6B', 160),
      secret_ref: 'internal:embeddings', capabilities_json: '["embedding"]', enabled: 1,
    },
  ];
  for (const row of rows) upsertBuiltinDeployment(row);

  const routes = [
    ['flolah-platform-primary', 'chat', 'platform-primary', 'platform-secondary'],
    ['flolah-platform-secondary', 'chat', 'platform-secondary', 'platform-primary'],
    ['flolah-platform-active', 'chat', 'platform-primary', 'platform-secondary'],
    ['flolah-efficiency', 'chat', 'ollama-efficiency', 'platform-primary'],
    ['flolah-local-reasoning', 'reasoning', 'ollama-reasoning', 'platform-primary'],
    ['flolah-realtime', 'realtime', 'realtime-openai', null],
    ['flolah-embedding', 'embedding', 'qwen-embeddings', null],
  ];
  const stmt = getDb().prepare(`
    INSERT INTO model_routes(alias, capability, primary_deployment_id, fallback_deployment_id, enabled, updated_at)
    VALUES (?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(alias) DO NOTHING
  `);
  for (const route of routes) stmt.run(...route);
}

function deploymentPublic(row) {
  return {
    ...row,
    enabled: !!row.enabled,
    builtin: !!row.builtin,
    capabilities: parseJson(row.capabilities_json, []),
    capabilities_json: undefined,
    secret_configured: row.secret_ref.startsWith('internal:') || !!process.env[row.secret_ref.replace(/^env:/, '')],
  };
}

export function getModelRoutingSnapshot({ eventPage = 1, eventPageSize = 25 } = {}) {
  ensureModelRoutingTables();
  const db = getDb();
  const pageSize = Math.min(Math.max(Number(eventPageSize) || 25, 1), 100);
  const totalEvents = Number(db.prepare('SELECT COUNT(*) AS count FROM model_route_events').get()?.count || 0);
  const totalPages = Math.max(1, Math.ceil(totalEvents / pageSize));
  const page = Math.min(Math.max(Number(eventPage) || 1, 1), totalPages);
  const deployments = db.prepare('SELECT * FROM model_deployments ORDER BY builtin DESC, name').all().map(deploymentPublic);
  const routes = db.prepare(`
    SELECT r.*, p.name AS primary_name, f.name AS fallback_name
    FROM model_routes r
    LEFT JOIN model_deployments p ON p.id=r.primary_deployment_id
    LEFT JOIN model_deployments f ON f.id=r.fallback_deployment_id
    ORDER BY r.alias
  `).all().map((row) => ({ ...row, enabled: !!row.enabled }));
  const events = db.prepare(`
    SELECT id, route_alias, deployment_id, outcome, model_used, endpoint_host, source,
           latency_ms, error_message, created_at
    FROM model_route_events ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
  `).all(pageSize, (page - 1) * pageSize);
  return {
    enabled: enabled(process.env.MODEL_ROUTING_ENABLED),
    gateway: {
      base_url: clean(process.env.LITELLM_BASE_URL || 'http://litellm:4000/v1'),
      configured: !!process.env.LITELLM_MASTER_KEY,
    },
    aliases: ROUTE_ALIASES,
    deployments,
    routes,
    events,
    event_pagination: {
      page,
      page_size: pageSize,
      total_items: totalEvents,
      total_pages: totalPages,
      has_previous: page > 1,
      has_next: page < totalPages,
    },
  };
}

export function saveModelDeployment(idRaw, input = {}) {
  ensureModelRoutingTables();
  const id = clean(idRaw || input.id, 100);
  if (!/^[a-z0-9][a-z0-9._-]{1,99}$/i.test(id)) throw Object.assign(new Error('Invalid deployment id'), { status: 400 });
  const providerType = clean(input.provider_type, 40).toLowerCase();
  if (!PROVIDER_TYPES.has(providerType)) throw Object.assign(new Error('Unsupported provider type'), { status: 400 });
  const name = clean(input.name, 120);
  const baseUrl = clean(input.base_url);
  const model = clean(input.model, 160);
  const secretRef = clean(input.secret_ref, 160);
  if (!name || !baseUrl) throw Object.assign(new Error('Name and base URL are required'), { status: 400 });
  if (secretRef && !/^(env:[A-Z0-9_]+|internal:[a-z0-9_-]+)$/i.test(secretRef)) {
    throw Object.assign(new Error('Secret reference must be env:NAME or internal:name; raw secrets are not accepted'), { status: 400 });
  }
  let parsedUrl;
  try { parsedUrl = new URL(baseUrl); } catch { throw Object.assign(new Error('Base URL is invalid'), { status: 400 }); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw Object.assign(new Error('Base URL must use HTTP(S)'), { status: 400 });
  const capabilities = Array.isArray(input.capabilities) ? input.capabilities.map((v) => clean(v, 40)).filter(Boolean).slice(0, 20) : [];
  const existing = getDb().prepare('SELECT builtin FROM model_deployments WHERE id=?').get(id);
  getDb().prepare(`
    INSERT INTO model_deployments
      (id,name,provider_type,base_url,model,secret_ref,capabilities_json,enabled,builtin,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, provider_type=excluded.provider_type,
      base_url=excluded.base_url, model=excluded.model, secret_ref=excluded.secret_ref,
      capabilities_json=excluded.capabilities_json, enabled=excluded.enabled, updated_at=datetime('now')
  `).run(id, name, providerType, baseUrl, model, secretRef, JSON.stringify(capabilities), enabled(input.enabled) ? 1 : 0, existing?.builtin ? 1 : 0);
  return deploymentPublic(getDb().prepare('SELECT * FROM model_deployments WHERE id=?').get(id));
}

export function saveModelRoute(aliasRaw, input = {}) {
  ensureModelRoutingTables();
  const alias = clean(aliasRaw || input.alias, 120);
  if (!/^flolah-[a-z0-9-]+$/.test(alias)) throw Object.assign(new Error('Route alias must start with flolah-'), { status: 400 });
  const primary = clean(input.primary_deployment_id, 100);
  const fallback = clean(input.fallback_deployment_id, 100) || null;
  const db = getDb();
  const primaryRow = db.prepare('SELECT * FROM model_deployments WHERE id=?').get(primary);
  if (!primaryRow) throw Object.assign(new Error('Primary deployment not found'), { status: 400 });
  if (!primaryRow.enabled) throw Object.assign(new Error('Primary deployment is disabled'), { status: 400 });
  if (fallback && !db.prepare('SELECT 1 FROM model_deployments WHERE id=?').get(fallback)) throw Object.assign(new Error('Fallback deployment not found'), { status: 400 });
  db.prepare(`
    INSERT INTO model_routes(alias,capability,primary_deployment_id,fallback_deployment_id,enabled,updated_at)
    VALUES (?,?,?,?,?,datetime('now'))
    ON CONFLICT(alias) DO UPDATE SET capability=excluded.capability,
      primary_deployment_id=excluded.primary_deployment_id,
      fallback_deployment_id=excluded.fallback_deployment_id, enabled=excluded.enabled,
      updated_at=datetime('now')
  `).run(alias, clean(input.capability || 'chat', 40), primary, fallback, enabled(input.enabled) ? 1 : 0);
  return db.prepare('SELECT * FROM model_routes WHERE alias=?').get(alias);
}

export function registryGatewayEnabled() {
  return enabled(process.env.MODEL_ROUTING_ENABLED) && !!clean(process.env.LITELLM_MASTER_KEY);
}

export function maybeRouteThroughModelGateway({ cfg, effectiveModel, routeAlias }) {
  if (!registryGatewayEnabled() || cfg?.using_byok) return { cfg, effectiveModel, routeAlias: null };
  const alias = ROUTE_ALIASES.includes(routeAlias) ? routeAlias : 'flolah-platform-active';
  ensureModelRoutingTables();
  const route = getDb().prepare('SELECT * FROM model_routes WHERE alias=? AND enabled=1').get(alias);
  const gatewayAliases = {
    'platform-primary': 'flolah-platform-primary',
    'platform-secondary': 'flolah-platform-secondary',
    'ollama-efficiency': 'flolah-efficiency',
    'ollama-reasoning': 'flolah-local-reasoning',
  };
  const gatewayModel = gatewayAliases[route?.primary_deployment_id] || alias;
  return {
    cfg: {
      ...cfg,
      primary: {
        baseUrl: clean(process.env.LITELLM_BASE_URL || 'http://litellm:4000/v1'),
        apiKey: process.env.LITELLM_MASTER_KEY,
        model: gatewayModel,
      },
      secondary: null,
      routed_by: 'litellm',
      logical_model: effectiveModel,
    },
    effectiveModel: gatewayModel,
    routeAlias: alias,
  };
}

export function recordModelRouteEvent(input = {}) {
  try {
    ensureModelRoutingTables();
    getDb().prepare(`
      INSERT INTO model_route_events
        (id,route_alias,deployment_id,outcome,model_used,endpoint_host,source,owner_user_id,latency_ms,error_message)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      randomUUID(), clean(input.routeAlias || 'direct', 120), clean(input.deploymentId, 100) || null,
      clean(input.outcome || 'unknown', 30), clean(input.modelUsed, 160) || null,
      clean(input.endpointHost, 200) || null, clean(input.source, 120) || null,
      clean(input.ownerUserId, 160) || null, Number.isFinite(Number(input.latencyMs)) ? Number(input.latencyMs) : null,
      clean(input.errorMessage, 500) || null
    );
  } catch (error) {
    console.warn('[model-routing] event audit skipped:', error?.message || error);
  }
}

export async function probeModelDeployment(idRaw) {
  ensureModelRoutingTables();
  const row = getDb().prepare('SELECT * FROM model_deployments WHERE id=?').get(clean(idRaw, 100));
  if (!row) throw Object.assign(new Error('Deployment not found'), { status: 404 });
  const url = new URL(row.base_url);
  const internalHosts = new Set(['litellm', 'ollama', 'vllm', 'embeddings', '127.0.0.1', 'localhost']);
  if (url.protocol !== 'https:' && !internalHosts.has(url.hostname)) {
    throw Object.assign(new Error('Health probes require public HTTPS or an approved internal model service'), { status: 400 });
  }
  const started = Date.now();
  const isLiteLlm = row.provider_type === 'litellm';
  const path = isLiteLlm ? '/health/liveliness' : '/models';
  const base = (isLiteLlm ? row.base_url.replace(/\/v1\/?$/, '') : row.base_url).replace(/\/$/, '');
  const headers = {};
  if (row.secret_ref.startsWith('env:')) {
    const value = process.env[row.secret_ref.slice(4)];
    if (value) headers.Authorization = `Bearer ${value}`;
  }
  const response = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(10000) });
  const result = { ok: response.ok, status: response.status, latency_ms: Date.now() - started };
  recordModelRouteEvent({ routeAlias: 'health-probe', deploymentId: row.id, outcome: response.ok ? 'healthy' : 'failed', endpointHost: url.hostname, latencyMs: result.latency_ms });
  if (!response.ok) throw Object.assign(new Error(`Health probe returned HTTP ${response.status}`), { status: 502, result });
  return result;
}
