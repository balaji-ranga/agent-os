/**
 * OpenConnector facade: per-CEO runtime tokens + catalog / execute APIs.
 * UI should treat this as first-class connectors, even if the backend talks MCP under the hood.
 */
import { getDb } from '../db/schema.js';
import { getMcpServer, listVisibleMcpServers } from './mcp-servers.js';
import { McpHttpClient } from './mcp-client.js';
import { resolveUserApiKey, tryResolveUserApiKey } from './user-api-keys.js';
import {
  isOpenConnectorCustomOauthEnabledInEnv,
  resolveOpenConnectorOauthClientForAuthorize,
} from './openconnector-oauth-override.js';
import {
  authorizationUrlUsesClientId,
  seedOpenConnectorOauthClientForAuthorize,
  withOpenConnectorOauthClientSeed,
} from './openconnector-oauth-lease.js';
import { classifyConnectorAction } from './connector-action-grants.js';
import { connectorExecutionError, invokeConnectorTransport, readConnectorMessagePages, retryConnectorRead } from './connector-execution-policy.js';

function db() {
  return getDb();
}

function trimOrNull(value) {
  const v = String(value || '').trim();
  return v || null;
}

function defaultConnectionName(userId) {
  const safe = String(userId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `ceo-${safe || 'unknown'}`;
}

function maskSecret(secret) {
  const raw = String(secret || '').trim();
  if (!raw) return null;
  if (raw.length <= 8) return '••••';
  return `${raw.slice(0, 4)}…${raw.slice(-4)}`;
}

function normalizeActionHit(hit = {}) {
  const id = String(hit.id || hit.actionId || '').trim();
  const service = String(hit.service || hit.appId || hit.app_id || '').trim();
  const appName = String(hit.appName || hit.app_name || hit.service_name || service || '').trim();
  return {
    id,
    service,
    app_id: service,
    app_name: appName || service || id,
    description: String(hit.description || '').trim(),
    input_schema: hit.inputSchema || hit.input_schema || null,
    raw: hit,
  };
}

function dedupeApps(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const appId = String(row.id || row.app_id || row.service || '').trim();
    if (!appId) continue;
    if (!map.has(appId)) {
      map.set(appId, {
        id: appId,
        name: String(row.name || row.app_name || row.service_name || appId).trim() || appId,
        connected: !!row.connected,
        suggested: !!row.suggested,
        provider_name: row.provider_name || null,
        account_name: row.account_name || null,
      });
      continue;
    }
    const existing = map.get(appId);
    if (!existing.name && row.name) existing.name = row.name;
    existing.connected = existing.connected || !!row.connected;
    existing.suggested = existing.suggested || !!row.suggested;
    if (!existing.provider_name && row.provider_name) existing.provider_name = row.provider_name;
    if (!existing.account_name && row.account_name) existing.account_name = row.account_name;
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function jsonRpcId() {
  return `oc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseJsonRpcToolResult(payload = {}) {
  const result = payload?.result || {};
  const content = Array.isArray(result.content) ? result.content : [];
  let text = '';
  for (const part of content) {
    if (part?.type === 'text' && typeof part.text === 'string') {
      text = text ? `${text}\n${part.text}` : part.text;
    }
  }
  return {
    text,
    structured: result.structuredContent || null,
    is_error: !!result.isError,
    raw: payload,
  };
}

export function getOpenConnectorEnvConfig() {
  const configuredId = String(process.env.OPENCONNECTOR_MCP_ID || 'mcp-openconnector').trim();
  const row = db()
    .prepare('SELECT url FROM mcp_servers WHERE id = ?')
    .get(configuredId);
  const mcpUrl = trimOrNull(process.env.OPENCONNECTOR_MCP_URL) || trimOrNull(row?.url);
  const baseUrl =
    trimOrNull(process.env.OPENCONNECTOR_URL) ||
    (mcpUrl ? mcpUrl.replace(/\/mcp\/?$/i, '') : null);
  const publicOrigin =
    trimOrNull(process.env.OPENCONNECTOR_PUBLIC_ORIGIN) ||
    trimOrNull(process.env.OOMOL_CONNECT_ORIGIN);
  return {
    url: baseUrl,
    mcp_url: mcpUrl,
    mcp_id: configuredId,
    transport: String(process.env.OPENCONNECTOR_MCP_TRANSPORT || 'streamable_http').trim(),
    has_bearer: Boolean(String(process.env.OPENCONNECTOR_MCP_BEARER || '').trim()),
    has_admin_token: Boolean(String(process.env.OPENCONNECTOR_ADMIN_TOKEN || '').trim()),
    origin: publicOrigin,
    public_origin: publicOrigin,
    allowed_custom_oauth: String(
      process.env.OPENCONNECTOR_ALLOWED_CUSTOM_OAUTH ||
        process.env.OOMOL_CONNECT_ALLOWED_CUSTOM_OAUTH ||
        ''
    ).trim(),
  };
}

export { defaultConnectionName };

export function getOpenConnectorLink(userId) {
  if (!userId) return null;
  let row;
  try {
    row = db()
      .prepare(
        `SELECT user_id, runtime_token, runtime_token_ref, connection_name, oc_user_id, linked_at, last_provisioned_at, last_error, created_at, updated_at
         FROM openconnector_user_links WHERE user_id = ?`
      )
      .get(String(userId).trim());
  } catch (_) {
    row = db()
      .prepare(
        `SELECT user_id, runtime_token, connection_name, oc_user_id, linked_at, last_provisioned_at, last_error, created_at, updated_at
         FROM openconnector_user_links WHERE user_id = ?`
      )
      .get(String(userId).trim());
  }
  if (!row) return null;
  const token = String(row.runtime_token || '').trim();
  const tokenRef = String(row.runtime_token_ref || '').trim();
  return {
    ...row,
    runtime_token_ref: tokenRef || null,
    runtime_token_set: !!(token || tokenRef),
    runtime_token_hint: token ? maskSecret(token) : tokenRef ? `vault:${tokenRef}` : null,
    connection_name: String(row.connection_name || '').trim() || defaultConnectionName(userId),
  };
}

/** Resolve plaintext OpenConnector runtime token (literal or vault ref). */
export function resolveOpenConnectorRuntimeToken(userId) {
  const row = getOpenConnectorLink(userId);
  if (!row) return '';
  const ref = String(row.runtime_token_ref || '').trim();
  if (ref) {
    return resolveUserApiKey(userId, ref).value;
  }
  return String(row.runtime_token || '').trim();
}

export function getOpenConnectorLinkPublic(userId) {
  const row = getOpenConnectorLink(userId);
  if (!row) {
    return {
      linked: false,
      runtime_token_set: false,
      runtime_token_hint: null,
      connection_name: defaultConnectionName(userId),
      oc_user_id: '',
      linked_at: null,
      last_provisioned_at: null,
      last_error: null,
    };
  }
  return {
    linked: !!row.runtime_token_set,
    runtime_token_set: row.runtime_token_set,
    runtime_token_hint: row.runtime_token_hint,
    runtime_token_ref: row.runtime_token_ref || null,
    connection_name: row.connection_name,
    oc_user_id: row.oc_user_id || '',
    linked_at: row.linked_at || null,
    last_provisioned_at: row.last_provisioned_at || null,
    last_error: row.last_error || null,
  };
}

export function upsertOpenConnectorLink(userId, patch = {}) {
  const id = String(userId || '').trim();
  if (!id) throw new Error('user_id required');
  const existing = getOpenConnectorLink(id);
  let runtimeToken =
    patch.clear_runtime_token
      ? null
      : patch.runtime_token !== undefined
        ? String(patch.runtime_token || '').trim() || null
        : existing?.runtime_token || null;
  let runtimeTokenRef =
    patch.clear_runtime_token
      ? null
      : patch.runtime_token_ref !== undefined
        ? String(patch.runtime_token_ref || '').trim() || null
        : existing?.runtime_token_ref || null;
  if (runtimeTokenRef) {
    // Prefer vault ref; clear literal when ref is set
    runtimeToken = null;
    // ensure key exists
    if (!tryResolveUserApiKey(id, runtimeTokenRef)) {
      throw Object.assign(new Error(`API key "${runtimeTokenRef}" not found`), { status: 400 });
    }
  }
  const connectionName =
    patch.connection_name !== undefined
      ? String(patch.connection_name || '').trim() || defaultConnectionName(id)
      : existing?.connection_name || defaultConnectionName(id);
  const ocUserId =
    patch.oc_user_id !== undefined ? String(patch.oc_user_id || '').trim() : existing?.oc_user_id || '';
  const hasCreds = !!(runtimeToken || runtimeTokenRef);
  const linkedAt =
    hasCreds && !existing?.linked_at ? new Date().toISOString() : existing?.linked_at || null;
  const lastProvisionedAt =
    patch.last_provisioned_at !== undefined
      ? patch.last_provisioned_at
      : existing?.last_provisioned_at || null;
  const lastError =
    patch.last_error !== undefined ? String(patch.last_error || '').trim() || null : existing?.last_error || null;

  db()
    .prepare(
      `INSERT INTO openconnector_user_links
        (user_id, runtime_token, runtime_token_ref, connection_name, oc_user_id, linked_at, last_provisioned_at, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         runtime_token = excluded.runtime_token,
         runtime_token_ref = excluded.runtime_token_ref,
         connection_name = excluded.connection_name,
         oc_user_id = excluded.oc_user_id,
         linked_at = excluded.linked_at,
         last_provisioned_at = excluded.last_provisioned_at,
         last_error = excluded.last_error,
         updated_at = datetime('now')`
    )
    .run(
      id,
      runtimeToken,
      runtimeTokenRef,
      connectionName,
      ocUserId,
      linkedAt,
      lastProvisionedAt,
      lastError
    );
  return getOpenConnectorLinkPublic(id);
}

function getRuntimeTokenForUser(userId) {
  const row = getOpenConnectorLink(userId);
  const token = resolveOpenConnectorRuntimeToken(userId);
  if (!token) throw new Error('OpenConnector runtime token not linked for this CEO');
  return { token, connectionName: row?.connection_name || defaultConnectionName(userId) };
}

async function openConnectorFetch(path, { method = 'GET', headers = {}, body, auth = 'runtime', userId = null } = {}) {
  const env = getOpenConnectorEnvConfig();
  if (!env.url) throw new Error('OPENCONNECTOR_URL or OPENCONNECTOR_MCP_URL must be configured');
  const target = `${env.url}${path.startsWith('/') ? path : `/${path}`}`;
  const finalHeaders = { ...headers };

  if (auth === 'admin') {
    const token = String(process.env.OPENCONNECTOR_ADMIN_TOKEN || '').trim();
    if (!token) throw new Error('OPENCONNECTOR_ADMIN_TOKEN not configured');
    finalHeaders.Authorization = `Bearer ${token}`;
  } else if (auth === 'runtime') {
    const runtime = getRuntimeTokenForUser(userId);
    finalHeaders.Authorization = `Bearer ${runtime.token}`;
    if (!finalHeaders['x-oo-connector-alias'] && runtime.connectionName) {
      finalHeaders['x-oo-connector-alias'] = runtime.connectionName;
    }
  }

  if (body != null && !finalHeaders['Content-Type']) {
    finalHeaders['Content-Type'] = 'application/json';
  }

  const res = await fetch(target, {
    method,
    headers: finalHeaders,
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false || data.ok === false) {
    throw connectorExecutionError(res.status, data, res.headers.get('retry-after'));
  }
  return data;
}

async function callOpenConnectorMcpTool(userId, toolName, args = {}, connectionName = '') {
  const env = getOpenConnectorEnvConfig();
  if (!env.mcp_url) throw new Error('OPENCONNECTOR_MCP_URL not configured');
  const runtime = getRuntimeTokenForUser(userId);
  const alias = connectionName || runtime.connectionName;
  const extraHeaders = alias
    ? { 'x-oo-connector-alias': alias }
    : {};
  const client = new McpHttpClient(
    { url: env.mcp_url, transport: env.transport || 'streamable_http' },
    { bearer: runtime.token, headers: extraHeaders }
  );
  await client.initialize();
  const raw = await client.callTool(toolName, args || {});
  const parsed = parseJsonRpcToolResult({ result: raw });
  if (parsed.is_error) {
    throw connectorExecutionError(502, parsed.structured || { message: parsed.text || `OpenConnector tool failed: ${toolName}` });
  }
  return parsed;
}

function parseAppsFromListApps(result) {
  const structuredApps = result?.structured?.apps;
  const rawApps = Array.isArray(structuredApps)
    ? structuredApps
    : Array.isArray(result?.raw?.result?.apps)
      ? result.raw.result.apps
      : [];
  return dedupeApps(
    rawApps.map((app) => ({
      id: app.id || app.app_id,
      name: app.name || app.label || app.id,
      connected: true,
    }))
  );
}

function parseAppsFromActionSearch(result) {
  const structuredActions = result?.structured?.actions;
  const actions = Array.isArray(structuredActions)
    ? structuredActions
    : Array.isArray(result?.raw?.result?.actions)
      ? result.raw.result.actions
      : [];
  const rows = actions.map((hit) => {
    const action = normalizeActionHit(hit);
    return {
      id: action.app_id,
      name: action.app_name,
      connected: false,
    };
  });
  return dedupeApps(rows);
}

function parseHttpActionList(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return rows.map(normalizeActionHit).filter((a) => a.id || a.app_id);
}

const SUGGESTED_CONNECTOR_APPS = [
  { id: 'hackernews', name: 'Hacker News', connected: false, suggested: true },
  { id: 'github', name: 'GitHub', connected: false, suggested: true },
  { id: 'gmail', name: 'Gmail', connected: false, suggested: true },
];

const PROVIDER_DISPLAY_NAMES = {
  github: 'GitHub',
  gmail: 'Gmail',
  google_drive: 'Google Drive',
  google_sheets: 'Google Sheets',
  hackernews: 'Hacker News',
  slack: 'Slack',
};

export function providerDisplayName(service) {
  const s = String(service || '').trim();
  if (!s) return '';
  const known = PROVIDER_DISPLAY_NAMES[s.toLowerCase()];
  if (known) return known;
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build a minimal editable example object from a JSON Schema. */
export function exampleInputFromSchema(schema) {
  if (!schema || typeof schema !== 'object') return {};
  if (Object.prototype.hasOwnProperty.call(schema, 'const')) return schema.const;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) {
    return exampleInputFromSchema(schema.anyOf[0] || {});
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    return exampleInputFromSchema(schema.oneOf[0] || {});
  }
  const type = schema.type;
  if (type === 'object' || schema.properties) {
    const out = {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    for (const [key, prop] of Object.entries(schema.properties || {})) {
      const p = prop || {};
      // Include required fields, const/default fields, and simple primitives so samples are complete.
      const include =
        required.has(key) ||
        Object.prototype.hasOwnProperty.call(p, 'const') ||
        p.default !== undefined ||
        true;
      if (!include) continue;
      out[key] = exampleInputFromSchema(p);
    }
    return out;
  }
  if (type === 'array') {
    return [exampleInputFromSchema(schema.items || { type: 'string' })];
  }
  if (type === 'integer' || type === 'number') {
    if (typeof schema.minimum === 'number') {
      const min = schema.exclusiveMinimum === true ? schema.minimum + 1 : schema.minimum;
      return min;
    }
    if (typeof schema.exclusiveMinimum === 'number') {
      return schema.exclusiveMinimum + (type === 'integer' ? 1 : Number.EPSILON);
    }
    return type === 'integer' ? 1 : 0;
  }
  if (type === 'boolean') return false;
  if (type === 'null') return null;
  return '';
}

async function fetchHttpActionCatalog(userId, { service = '', query = '' } = {}) {
  const path = service
    ? `/v1/actions?service=${encodeURIComponent(service)}`
    : '/v1/actions';
  const payload = await openConnectorFetch(path, { auth: 'runtime', userId });
  let actions = parseHttpActionList(payload);
  const q = String(query || '').trim().toLowerCase();
  if (q) {
    actions = actions.filter(
      (a) =>
        a.id.toLowerCase().includes(q) ||
        a.app_id.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q)
    );
  }
  return actions;
}

async function fetchHttpServiceCatalog(userId, query = '') {
  const q = String(query || '').trim().toLowerCase();
  // Prefer service-scoped lookup (real OC /v1/actions without service= returns stubs only).
  if (q && /^[a-z0-9_-]+$/i.test(q)) {
    try {
      const actions = await fetchHttpActionCatalog(userId, { service: q });
      if (actions.length) {
        return [{ id: q, name: actions[0].app_name || q, connected: false }];
      }
    } catch (_) {
      /* fall through to service index */
    }
  }
  const payload = await openConnectorFetch('/v1/actions', { auth: 'runtime', userId });
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return dedupeApps(
    rows
      .map((r) => ({
        id: String(r.service || r.id || '').split('.')[0],
        name: String(r.service || r.name || ''),
        connected: false,
      }))
      .filter((r) => r.id && (!q || r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)))
  );
}

export async function getConnectedConnectorApps(userId) {
  const alias = getOpenConnectorLink(userId)?.connection_name || defaultConnectionName(userId);
  // /api/connections requires admin bearer on real OC; runtime tokens only work on /v1/*.
  try {
    const payload = await openConnectorFetch('/api/connections', { auth: 'admin' });
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.connections)
          ? payload.connections
          : [];
    const apps = dedupeApps(
      rows
        .filter((r) => {
          if (!r || r.configured === false) return false;
          const name = String(r.connectionName || r.connection_name || '').trim();
          // Real OAuth/API-key connections namespaced to this CEO
          if (name === alias) return true;
          return false;
        })
        .map((r) => {
          const service = r.service || r.app_id || r.provider || r.id;
          const account =
            r.profile?.displayName || r.profile?.accountId || r.account_name || '';
          const providerName = providerDisplayName(service);
          return {
            id: service,
            name: account ? `${providerName} (${account})` : providerName,
            provider_name: providerName,
            account_name: account || null,
            connected: true,
          };
        })
    );
    if (apps.length) return { apps, source: 'http_connections' };
  } catch (_) {
    /* try MCP */
  }
  try {
    const result = await callOpenConnectorMcpTool(userId, 'list_apps', {});
    const apps = parseAppsFromListApps(result);
    if (apps.length) return { apps, source: 'list_apps' };
  } catch (_) {
    /* none connected yet */
  }
  // Real OC with no OAuth yet: surface starter chips so the palette is usable.
  return { apps: SUGGESTED_CONNECTOR_APPS, source: 'suggested' };
}

export async function searchConnectorApps(userId, query = '') {
  const q = String(query || '').trim();
  try {
    const apps = await fetchHttpServiceCatalog(userId, q);
    return { apps, source: 'http', query: q };
  } catch (httpErr) {
    try {
      const result = await callOpenConnectorMcpTool(userId, 'search_actions', q ? { query: q } : {});
      return { apps: parseAppsFromActionSearch(result), source: 'search_actions', query: q };
    } catch {
      throw httpErr;
    }
  }
}

export async function listConnectorActions(userId, appId, query = '') {
  const q = String(query || '').trim();
  const service = String(appId || '').trim();
  try {
    const actions = await fetchHttpActionCatalog(userId, { service, query: q });
    if (actions.length) {
      return {
        app_id: appId,
        actions: actions.map((a) => ({
          ...a,
          ...classifyConnectorAction(a),
          example_input: exampleInputFromSchema(a.input_schema || {}),
        })),
        source: 'http',
      };
    }
  } catch (_) {
    /* MCP fallback */
  }
  try {
    const result = await callOpenConnectorMcpTool(userId, 'search_actions', {
      query: q || service,
    });
    const structuredActions = result?.structured?.actions;
    const rows = Array.isArray(structuredActions)
      ? structuredActions
      : Array.isArray(result?.raw?.result?.actions)
        ? result.raw.result.actions
        : [];
    const normalized = rows
      .map(normalizeActionHit)
      .filter((item) => !service || item.app_id === service || item.id.startsWith(`${service}.`))
      .map((item) => ({ ...item, ...classifyConnectorAction(item) }));
    return {
      app_id: appId,
      actions: normalized,
      source: 'search_actions',
    };
  } catch (e) {
    return { app_id: appId, actions: [], source: 'error', error: e.message };
  }
}

export async function getConnectorActionGuide(userId, actionId) {
  const id = String(actionId || '').trim();
  if (!id) throw new Error('action_id required');

  let meta = null;
  try {
    meta = await openConnectorFetch(`/api/actions/${encodeURIComponent(id)}`, {
      method: 'GET',
      auth: 'admin',
    });
  } catch (_) {
    meta = null;
  }
  const metaObj = meta?.data && typeof meta.data === 'object' ? meta.data : meta;
  const inputSchema = metaObj?.inputSchema || metaObj?.input_schema || null;
  const outputSchema = metaObj?.outputSchema || metaObj?.output_schema || null;
  const description = String(metaObj?.description || '').trim();
  const exampleInput = exampleInputFromSchema(inputSchema || {});

  let guide = '';
  try {
    const result = await callOpenConnectorMcpTool(userId, 'get_action_guide', { actionId: id });
    guide = result.structured?.guide || result.text || '';
  } catch (_) {
    try {
      const payload = await openConnectorFetch(`/api/actions/${encodeURIComponent(id)}/agent.md`, {
        auth: 'admin',
      });
      guide = typeof payload === 'string' ? payload : payload?.guide || payload?.data || '';
    } catch (e) {
      guide = description || '';
      if (!guide) {
        return {
          action_id: id,
          guide: '',
          description,
          input_schema: inputSchema,
          output_schema: outputSchema,
          example_input: exampleInput,
          error: e.message,
        };
      }
    }
  }

  return {
    action_id: id,
    guide: String(guide || ''),
    description,
    input_schema: inputSchema,
    output_schema: outputSchema,
    example_input: exampleInput,
    raw: metaObj || null,
  };
}

// Reservations survive restarts and are shared by backend processes. No email
// content or credentials are stored. Gmail list costs 5; each hydrated mail 20.
async function paceGmailRead(userId, alias, input) {
  const unitsPerMinute = Math.max(1000, Math.min(6000, Number(process.env.GMAIL_READ_QUOTA_UNITS_PER_MINUTE) || 4000));
  const cost = 5 + (input.detail === 'ids' ? 0 : input.maxResults * 20);
  db().exec('CREATE TABLE IF NOT EXISTS connector_read_budget (scope_key TEXT PRIMARY KEY, next_at INTEGER NOT NULL)');
  const key = JSON.stringify([userId, alias, 'gmail']);
  const delay = db().transaction(() => {
    const now = Date.now();
    db().prepare('DELETE FROM connector_read_budget WHERE next_at < ?').run(now - 60000);
    const nextAt = Math.max(now, db().prepare('SELECT next_at FROM connector_read_budget WHERE scope_key = ?').get(key)?.next_at || 0);
    if (nextAt - now > 60000) throw connectorExecutionError(429, { code: 'rate_limited', message: 'This mailbox already has queued reads. Retry after the current review finishes.' }, 60);
    db().prepare('INSERT INTO connector_read_budget(scope_key, next_at) VALUES (?, ?) ON CONFLICT(scope_key) DO UPDATE SET next_at = excluded.next_at')
      .run(key, nextAt + Math.ceil(cost * 60000 / unitsPerMinute));
    return nextAt - now;
  })();
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

export async function executeConnectorAction(
  userId,
  actionId,
  input = {},
  { connectionName = '', authorizationRetryDelaysMs = null } = {}
) {
  const id = String(actionId || '').trim();
  const appGuess = id.includes('.') ? id.split('.')[0] : '';
  const custom =
    appGuess && userId ? resolveOpenConnectorOauthClientForAuthorize(appGuess, userId) : null;

  const readOnly = classifyConnectorAction({ id }).action_family === 'read';
  const run = async (actionInput = input) => {
    const runtime = getRuntimeTokenForUser(userId);
    const alias = String(connectionName || runtime.connectionName || '').trim();
    const headers = alias ? { 'x-oo-connector-alias': alias } : {};
    const body = {
      actionId: id,
      input: actionInput && typeof actionInput === 'object' ? actionInput : {},
    };
    if (id === 'gmail.fetch_emails') await paceGmailRead(userId, alias, body.input);
    return invokeConnectorTransport(async () => {
      const direct = await openConnectorFetch(`/v1/actions/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers,
        body: { input: body.input },
        auth: 'runtime',
        userId,
      });
      return {
        ok: true,
        action_id: id,
        connection_name: alias || null,
        data: direct,
        text: typeof direct === 'string' ? direct : JSON.stringify(direct, null, 2),
        transport: 'http',
      };
    }, async (err) => {
      const mcp = await callOpenConnectorMcpTool(userId, 'execute_action', body, alias);
      return {
        ok: true,
        action_id: id,
        connection_name: alias || null,
        data: mcp.structured?.data || mcp.structured || null,
        text: mcp.text || '',
        transport: 'mcp',
        fallback_error: err.message,
      };
    });
  };

  // Current OpenConnector images persist a connection-scoped OAuth client and
  // use it for refresh. Re-seeding the global provider config before every
  // action can race or reset an in-flight refresh and produce alternating 401s.
  // Keep the old behavior behind an explicit compatibility flag only.
  const legacyGlobalSeed = /^(1|true|yes)$/i.test(
    String(process.env.OPENCONNECTOR_LEGACY_GLOBAL_OAUTH_SEED || '')
  );
  const invokePage = (pageInput) => retryConnectorRead(() => custom && legacyGlobalSeed
    ? withOpenConnectorOauthClientSeed(appGuess, custom, () => run(pageInput))
    : run(pageInput), { readOnly });
  const invoke = () => id === 'gmail.fetch_emails'
    ? readConnectorMessagePages(input, invokePage)
    : invokePage(input);
  const configuredDelays = Array.isArray(authorizationRetryDelaysMs)
    ? authorizationRetryDelaysMs
    : String(process.env.OPENCONNECTOR_AUTH_RETRY_DELAYS_MS || '1000,5000,15000')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .slice(0, 4);
  let retryIndex = 0;
  while (true) {
    try {
      return await invoke();
    } catch (error) {
      const message = String(error?.message || error || '');
      const authorizationFailure = !['rate_limited', 'quota_exceeded'].includes(error.code) &&
        error.provider_status !== 403 && readOnly &&
        (error.provider_status === 401 || /(?:401|authorization[_ -]?failed|not connected|connect .*oauth)/i.test(message));
      if (!authorizationFailure || !appGuess || !userId || retryIndex >= configuredDelays.length) throw error;
      // OAuth refresh can briefly make both execution and the connection list
      // report disconnected. Wait for the exact owner's grant to reappear
      // across the bounded schedule; do not fail on the first transient read,
      // and never borrow another owner's connection.
      let connected = false;
      while (!connected && retryIndex < configuredDelays.length) {
        const delayMs = configuredDelays[retryIndex];
        retryIndex += 1;
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        const connections = await getConnectorConnectionsForUser(userId).catch(() => null);
        connected = !!connections?.connections?.some((item) =>
          item.connected && String(item.app_id || '').toLowerCase() === appGuess.toLowerCase()
        );
        console.warn('[openconnector] owner-scoped OAuth recovery check', {
          user_id: userId,
          app_id: appGuess,
          action_id: id,
          check: retryIndex,
          connected,
          delay_ms: delayMs,
        });
      }
      if (!connected) throw error;
    }
  }
}

export async function getConnectorConnectionsForUser(userId) {
  const link = getOpenConnectorLinkPublic(userId);
  const connected = await getConnectedConnectorApps(userId);
  const env = getOpenConnectorEnvConfig();
  const apps = connected.apps || [];
  const real = apps.filter((a) => a.connected && !a.suggested);
  return {
    connection_name: link.connection_name,
    linked: link.linked,
    origin: env.public_origin || env.origin || null,
    source: connected.source,
    connections: real.map((app) => ({
      app_id: app.id,
      app_name: app.name,
      provider_name: app.provider_name || providerDisplayName(app.id),
      account_name: app.account_name || null,
      connected: true,
      connection_name: link.connection_name,
    })),
    suggested: apps.filter((a) => a.suggested),
  };
}

export async function getConnectorProvider(appId) {
  const app = String(appId || '').trim();
  if (!app) throw new Error('app_id required');
  const data = await openConnectorFetch(`/api/providers/${encodeURIComponent(app)}`, {
    method: 'GET',
    auth: 'admin',
  });
  return { app_id: app, provider: data?.data || data };
}

function pickAuthModes(provider) {
  const auth = provider?.auth || provider?.authentications || [];
  if (Array.isArray(auth) && auth.length) return auth;
  if (provider?.authType) return [{ type: provider.authType }];
  return [{ type: 'no_auth' }];
}

export async function startConnectorOAuth(userId, appId) {
  const app = String(appId || '').trim();
  if (!app) throw new Error('app_id required');
  const alias = getOpenConnectorLink(userId)?.connection_name || defaultConnectionName(userId);
  const env = getOpenConnectorEnvConfig();
  if (!env.public_origin && !env.origin) {
    throw new Error(
      'OPENCONNECTOR_PUBLIC_ORIGIN (or OOMOL_CONNECT_ORIGIN) must be set to a public HTTPS URL for OAuth callbacks'
    );
  }

  // Ensure CEO has a real runtime token (not leftover mock)
  const link = getOpenConnectorLink(userId);
  if (!link?.runtime_token || String(link.runtime_token).startsWith('oct_mock_')) {
    await provisionOpenConnectorForUser({ id: userId }, { ensureConnections: false });
  }

  const customClient = resolveOpenConnectorOauthClientForAuthorize(app, userId);
  const authBody = { service: app, connectionName: alias };
  if (customClient) {
    authBody.clientId = customClient.clientId;
    authBody.clientSecret = customClient.clientSecret;
    if (customClient.requestedScopes?.length) {
      authBody.requestedScopes = customClient.requestedScopes;
    }
    if (customClient.extra && typeof customClient.extra === 'object') {
      authBody.extra = customClient.extra;
    }
    console.info('[openconnector] oauth start with CEO app override', {
      app,
      connection_name: alias,
      client_id_hint: maskSecret(customClient.clientId),
      scopes: customClient.requestedScopes || null,
    });
  }

  let payload;
  try {
    payload = await openConnectorFetch('/api/oauth/authorizations', {
      method: 'POST',
      auth: 'admin',
      body: authBody,
    });
  } catch (e) {
    const msg = String(e.message || e);
    if (customClient && /custom|clientId|client_id|ALLOWED_CUSTOM|not allowed/i.test(msg)) {
      throw new Error(
        `${msg} — OpenConnector must allow connection-scoped OAuth apps (set OOMOL_CONNECT_ALLOWED_CUSTOM_OAUTH on the openconnector service, e.g. * or github,linkedin,facebook) and OOMOL_CONNECT_ENCRYPTION_KEY`
      );
    }
    throw e;
  }
  let data = payload?.data || payload;
  let authorizationUrl =
    data?.authorizationUrl || data?.authorization_url || data?.url || data?.authorizeUrl || null;

  let credentialsSource = customClient ? 'user' : 'platform';
  let delivery = customClient ? 'connection_scoped' : 'platform';

  // OC images before connection-scoped BYOA silently ignore clientId — seed global config for the lease window.
  if (customClient && !authorizationUrlUsesClientId(authorizationUrl, customClient.clientId)) {
    console.warn(
      '[openconnector] OC authorize URL did not use CEO clientId — falling back to temporary global seed lease',
      { app, connection_name: alias }
    );
    const { hasPlatformOauthClientCached } = await import('./openconnector-oauth-lease.js');
    if (!hasPlatformOauthClientCached(app)) {
      throw new Error(
        `Your App ID/secret override is saved, but this OpenConnector build does not honor connection-scoped clientId, and Flolah has no cached platform OAuth client for "${app}" to restore after a temporary seed. Admin: open Connectors → Provider OAuth apps and re-Save the platform client for ${app} once (credentials are cached in Flolah for safe BYOA). Then retry Connect.`
      );
    }
    await seedOpenConnectorOauthClientForAuthorize(app, customClient);
    payload = await openConnectorFetch('/api/oauth/authorizations', {
      method: 'POST',
      auth: 'admin',
      body: { service: app, connectionName: alias },
    });
    data = payload?.data || payload;
    authorizationUrl =
      data?.authorizationUrl || data?.authorization_url || data?.url || data?.authorizeUrl || null;
    delivery = 'seed_lease';
    if (!authorizationUrlUsesClientId(authorizationUrl, customClient.clientId)) {
      throw new Error(
        `OpenConnector still did not use your App client id after seeding. Re-save platform OAuth client (admin) so Flolah can restore it, confirm OPENCONNECTOR_ENCRYPTION_KEY, and retry. Got URL prefix: ${String(authorizationUrl || '').slice(0, 120)}`
      );
    }
  }

  if (!authorizationUrl) {
    throw new Error(
      payload?.message ||
        'OpenConnector did not return authorizationUrl — is OAuth client configured for this provider (admin platform client or your App ID/secret override)?'
    );
  }
  return {
    app_id: app,
    connection_name: alias,
    authorization_url: authorizationUrl,
    oauth_ready: true,
    credentials_source: credentialsSource,
    credentials_delivery: delivery,
  };
}

export async function upsertConnectorConnection(userId, appId, body = {}) {
  const app = String(appId || '').trim();
  if (!app) throw new Error('app_id required');
  const alias = getOpenConnectorLink(userId)?.connection_name || defaultConnectionName(userId);
  const authType = String(body.authType || body.auth_type || '').trim();
  if (!authType) throw new Error('authType required (api_key, oauth2, custom_credential, or no_auth)');

  if (authType === 'no_auth') {
    return {
      app_id: app,
      connection_name: alias,
      auth_type: 'no_auth',
      connected: true,
      note: 'No credentials required for this provider',
    };
  }

  const values = body.values && typeof body.values === 'object' ? body.values : {};
  const payload = await openConnectorFetch(`/api/connections/${encodeURIComponent(app)}`, {
    method: 'PUT',
    auth: 'admin',
    body: {
      authType,
      connectionName: alias,
      values,
      ...(body.extra && typeof body.extra === 'object' ? { extra: body.extra } : {}),
    },
  });
  return {
    app_id: app,
    connection_name: alias,
    auth_type: authType,
    connected: true,
    data: payload?.data || payload,
  };
}

export async function deleteConnectorConnection(userId, appId) {
  const app = String(appId || '').trim();
  if (!app) throw new Error('app_id required');
  const alias = getOpenConnectorLink(userId)?.connection_name || defaultConnectionName(userId);
  try {
    await openConnectorFetch(
      `/api/connections/${encodeURIComponent(app)}?connectionName=${encodeURIComponent(alias)}`,
      { method: 'DELETE', auth: 'admin' }
    );
  } catch (e) {
    // Some OC builds use path-style named connections
    await openConnectorFetch(`/api/connections/${encodeURIComponent(app)}/${encodeURIComponent(alias)}`, {
      method: 'DELETE',
      auth: 'admin',
    }).catch(() => {
      throw e;
    });
  }
  return { app_id: app, connection_name: alias, deleted: true };
}

export async function upsertOAuthClientConfig(appId, body = {}) {
  const app = String(appId || '').trim();
  if (!app) throw new Error('app_id required');
  const clientId = String(body.clientId || body.client_id || '').trim();
  const clientSecret = String(body.clientSecret || body.client_secret || '').trim();
  if (!clientId || !clientSecret) throw new Error('clientId and clientSecret required');
  const payload = await openConnectorFetch(`/api/oauth/configs/${encodeURIComponent(app)}`, {
    method: 'PUT',
    auth: 'admin',
    body: {
      clientId,
      clientSecret,
      ...(body.extra && typeof body.extra === 'object' ? { extra: body.extra } : {}),
    },
  });
  try {
    const { upsertOpenConnectorPlatformOauthClient } = await import('./openconnector-oauth-override.js');
    upsertOpenConnectorPlatformOauthClient(app, {
      clientId,
      clientSecret,
      extra: body.extra,
      scopes: body.scopes || body.requestedScopes,
    });
  } catch (e) {
    console.warn('[openconnector] platform OAuth client cache failed', { app, error: e.message });
  }
  return { app_id: app, configured: true, data: payload?.data || payload };
}

export async function listOAuthClientConfigs() {
  const payload = await openConnectorFetch('/api/oauth/configs', { method: 'GET', auth: 'admin' });
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  const configs = rows
    .map((r) => ({
      service: r.service || r.app_id || r.id || '',
      configured: r.configured === true || Boolean(r.clientId || r.client_id),
      client_id_hint: maskClientId(r.clientId || r.client_id),
      expected_redirect_uri: r.expectedRedirectUri || r.expected_redirect_uri || null,
      auth_type: r.auth?.type || r.authType || null,
    }))
    .filter((r) => r.service);
  return {
    configs,
    configured: configs.filter((c) => c.configured),
  };
}

function maskClientId(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (s.length <= 8) return `${s.slice(0, 2)}…`;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/** @deprecated use startConnectorOAuth / upsertConnectorConnection */
export async function startConnectorConnect(userId, appId) {
  try {
    const provider = await getConnectorProvider(appId);
    const modes = pickAuthModes(provider.provider);
    const types = modes.map((m) => String(m.type || m.authType || '').toLowerCase());
    if (types.includes('no_auth') && types.length === 1) {
      return {
        app_id: appId,
        connection_name: defaultConnectionName(userId),
        auth_type: 'no_auth',
        oauth_ready: true,
        instructions: `${appId} needs no OAuth — use it in the workflow Connectors palette.`,
      };
    }
    if (types.includes('oauth2') || types.includes('oauth')) {
      return await startConnectorOAuth(userId, appId);
    }
    return {
      app_id: appId,
      connection_name: defaultConnectionName(userId),
      auth_types: types,
      instructions: `Open Connectors page and enter API credentials for ${appId}.`,
      oauth_ready: false,
    };
  } catch (e) {
    // Fallback: try oauth start directly
    try {
      return await startConnectorOAuth(userId, appId);
    } catch {
      throw e;
    }
  }
}

export async function ensureConnectorConnectionSlot(userId, appId) {
  // Kept for compatibility — real setup goes through oauth/api_key façades.
  return {
    app_id: appId,
    connection_name: getOpenConnectorLink(userId)?.connection_name || defaultConnectionName(userId),
    ensured: false,
    note: 'Use Connectors page OAuth or API key flow',
  };
}

export async function provisionOpenConnectorForUser(user, { ensureConnections = true, appIds = [] } = {}) {
  const userId = String(user?.id || '').trim();
  if (!userId) throw new Error('Authenticated user required');
  const env = getOpenConnectorEnvConfig();
  if (!env.url) throw new Error('OpenConnector URL not configured');

  const existing = getOpenConnectorLink(userId);
  let token = String(existing?.runtime_token || '').trim();
  let createdToken = false;

  if (token.startsWith('oct_mock_')) {
    token = '';
  }

  if (!token) {
    const label = user?.email
      ? `${user.email} (${userId})`
      : `${user?.name || 'CEO'} (${userId})`;
    try {
      const payload = await openConnectorFetch('/api/runtime-tokens', {
        method: 'POST',
        auth: 'admin',
        body: { name: label },
      });
      const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
      token =
        trimOrNull(data?.token) ||
        trimOrNull(payload?.token) ||
        trimOrNull(payload?.runtime_token) ||
        trimOrNull(payload?.value) ||
        trimOrNull(payload?.plainToken) ||
        '';
      if (!token) throw new Error('OpenConnector did not return a runtime token');
      createdToken = true;
    } catch (err) {
      upsertOpenConnectorLink(userId, { last_error: err.message });
      throw err;
    }
  }

  const provisioned = upsertOpenConnectorLink(userId, {
    runtime_token: token,
    connection_name: defaultConnectionName(userId),
    last_provisioned_at: new Date().toISOString(),
    last_error: null,
  });

  const slots = [];
  if (ensureConnections) {
    const targets = (Array.isArray(appIds) ? appIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    if (!targets.length) {
      try {
        const connected = await getConnectedConnectorApps(userId);
        for (const app of connected.apps || []) targets.push(app.id);
      } catch {
        /* no connected apps yet */
      }
    }
    for (const appId of targets) {
      slots.push(await ensureConnectorConnectionSlot(userId, appId));
    }
  }

  return {
    ...provisioned,
    provisioned: true,
    created_token: createdToken,
    connection_slots: slots,
  };
}

export async function listOpenConnectorConnections() {
  const data = await openConnectorFetch('/api/connections', { method: 'GET', auth: 'admin' });
  const rows = Array.isArray(data) ? data : Array.isArray(data.connections) ? data.connections : [];
  return rows;
}

export function getOpenConnectorStatus(authUser) {
  const env = getOpenConnectorEnvConfig();
  const server = getMcpServer(env.mcp_id, authUser);
  const visible = listVisibleMcpServers(authUser).filter(
    (s) => s.id === env.mcp_id || /openconnector/i.test(s.name || '')
  );
  const link = authUser?.id ? getOpenConnectorLinkPublic(authUser.id) : null;
  return {
    configured: Boolean(env.mcp_url || server || env.url),
    env,
    link,
    custom_oauth_enabled: isOpenConnectorCustomOauthEnabledInEnv(),
    server: server
      ? {
          id: server.id,
          name: server.name,
          status: server.status,
          url: server.url,
          tool_count: server.tools?.length ?? 0,
          tools: (server.tools || []).map((t) => t.name),
          is_platform: !!server.is_platform,
          is_shared: !!server.is_shared,
        }
      : null,
    visible_openconnector_servers: visible.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
    })),
  };
}

/** Admin-only helper used by seed scripts / status. */
export function findOpenConnectorRow() {
  const id = String(process.env.OPENCONNECTOR_MCP_ID || 'mcp-openconnector').trim();
  return db().prepare('SELECT id, name, url, status, is_platform FROM mcp_servers WHERE id = ?').get(id);
}
