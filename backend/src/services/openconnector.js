/**
 * OpenConnector facade: per-CEO runtime tokens + catalog / execute APIs.
 * UI should treat this as first-class connectors, even if the backend talks MCP under the hood.
 */
import { getDb } from '../db/schema.js';
import { getMcpServer, listVisibleMcpServers } from './mcp-servers.js';

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
      });
      continue;
    }
    const existing = map.get(appId);
    if (!existing.name && row.name) existing.name = row.name;
    existing.connected = existing.connected || !!row.connected;
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
  return {
    url: baseUrl,
    mcp_url: mcpUrl,
    mcp_id: configuredId,
    transport: String(process.env.OPENCONNECTOR_MCP_TRANSPORT || 'streamable_http').trim(),
    has_bearer: Boolean(String(process.env.OPENCONNECTOR_MCP_BEARER || '').trim()),
    has_admin_token: Boolean(String(process.env.OPENCONNECTOR_ADMIN_TOKEN || '').trim()),
    origin: trimOrNull(process.env.OOMOL_CONNECT_ORIGIN),
  };
}

export function getOpenConnectorLink(userId) {
  if (!userId) return null;
  const row = db()
    .prepare(
      `SELECT user_id, runtime_token, connection_name, oc_user_id, linked_at, last_provisioned_at, last_error, created_at, updated_at
       FROM openconnector_user_links WHERE user_id = ?`
    )
    .get(String(userId).trim());
  if (!row) return null;
  return {
    ...row,
    runtime_token_set: !!String(row.runtime_token || '').trim(),
    runtime_token_hint: maskSecret(row.runtime_token),
    connection_name: String(row.connection_name || '').trim() || defaultConnectionName(userId),
  };
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
  const runtimeToken =
    patch.clear_runtime_token
      ? null
      : patch.runtime_token !== undefined
        ? String(patch.runtime_token || '').trim() || null
        : existing?.runtime_token || null;
  const connectionName =
    patch.connection_name !== undefined
      ? String(patch.connection_name || '').trim() || defaultConnectionName(id)
      : existing?.connection_name || defaultConnectionName(id);
  const ocUserId =
    patch.oc_user_id !== undefined ? String(patch.oc_user_id || '').trim() : existing?.oc_user_id || '';
  const linkedAt =
    runtimeToken && !existing?.linked_at ? new Date().toISOString() : existing?.linked_at || null;
  const lastProvisionedAt =
    patch.last_provisioned_at !== undefined
      ? patch.last_provisioned_at
      : existing?.last_provisioned_at || null;
  const lastError =
    patch.last_error !== undefined ? String(patch.last_error || '').trim() || null : existing?.last_error || null;

  db()
    .prepare(
      `INSERT INTO openconnector_user_links
        (user_id, runtime_token, connection_name, oc_user_id, linked_at, last_provisioned_at, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         runtime_token = excluded.runtime_token,
         connection_name = excluded.connection_name,
         oc_user_id = excluded.oc_user_id,
         linked_at = excluded.linked_at,
         last_provisioned_at = excluded.last_provisioned_at,
         last_error = excluded.last_error,
         updated_at = datetime('now')`
    )
    .run(id, runtimeToken, connectionName, ocUserId, linkedAt, lastProvisionedAt, lastError);
  return getOpenConnectorLinkPublic(id);
}

function getRuntimeTokenForUser(userId) {
  const row = getOpenConnectorLink(userId);
  const token = String(row?.runtime_token || '').trim();
  if (!token) throw new Error('OpenConnector runtime token not linked for this CEO');
  return { token, connectionName: row.connection_name || defaultConnectionName(userId) };
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
  if (!res.ok) {
    throw new Error(data.error || data.message || `OpenConnector request failed (${res.status})`);
  }
  return data;
}

async function callOpenConnectorMcpTool(userId, toolName, args = {}) {
  const env = getOpenConnectorEnvConfig();
  if (!env.mcp_url) throw new Error('OPENCONNECTOR_MCP_URL not configured');
  const runtime = getRuntimeTokenForUser(userId);
  const body = {
    jsonrpc: '2.0',
    id: jsonRpcId(),
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args || {},
    },
  };
  const res = await fetch(env.mcp_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${runtime.token}`,
      ...(runtime.connectionName ? { 'x-oo-connector-alias': runtime.connectionName } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `OpenConnector MCP failed (${res.status})`);
  }
  const parsed = parseJsonRpcToolResult(data);
  if (parsed.is_error) {
    throw new Error(parsed.text || `OpenConnector tool failed: ${toolName}`);
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

export async function getConnectedConnectorApps(userId) {
  const result = await callOpenConnectorMcpTool(userId, 'list_apps', {});
  return { apps: parseAppsFromListApps(result), source: 'list_apps' };
}

export async function searchConnectorApps(userId, query = '') {
  const q = String(query || '').trim();
  const result = await callOpenConnectorMcpTool(userId, 'search_actions', q ? { query: q } : {});
  return { apps: parseAppsFromActionSearch(result), source: 'search_actions', query: q };
}

export async function listConnectorActions(userId, appId, query = '') {
  const q = String(query || '').trim();
  const result = await callOpenConnectorMcpTool(userId, 'search_actions', {
    query: q || String(appId || '').trim(),
  });
  const structuredActions = result?.structured?.actions;
  const actions = Array.isArray(structuredActions)
    ? structuredActions
    : Array.isArray(result?.raw?.result?.actions)
      ? result.raw.result.actions
      : [];
  const normalized = actions
    .map(normalizeActionHit)
    .filter((item) => !appId || item.app_id === appId || item.id.startsWith(`${appId}.`));
  return {
    app_id: appId,
    actions: normalized,
  };
}

export async function getConnectorActionGuide(userId, actionId) {
  const result = await callOpenConnectorMcpTool(userId, 'get_action_guide', { actionId });
  return {
    action_id: actionId,
    guide: result.structured?.guide || result.text || '',
    raw: result.structured || result.raw?.result || null,
  };
}

export async function executeConnectorAction(userId, actionId, input = {}, { connectionName = '' } = {}) {
  const runtime = getRuntimeTokenForUser(userId);
  const alias = String(connectionName || runtime.connectionName || '').trim();
  const headers = alias ? { 'x-oo-connector-alias': alias } : {};
  const body = {
    actionId,
    input: input && typeof input === 'object' ? input : {},
  };
  try {
    const direct = await openConnectorFetch(`/v1/actions/${encodeURIComponent(actionId)}`, {
      method: 'POST',
      headers,
      body: { input: body.input },
      auth: 'runtime',
      userId,
    });
    return {
      ok: true,
      action_id: actionId,
      connection_name: alias || null,
      data: direct,
      text: typeof direct === 'string' ? direct : JSON.stringify(direct, null, 2),
      transport: 'http',
    };
  } catch (err) {
    const mcp = await callOpenConnectorMcpTool(userId, 'execute_action', body);
    return {
      ok: true,
      action_id: actionId,
      connection_name: alias || null,
      data: mcp.structured?.data || mcp.structured || null,
      text: mcp.text || '',
      transport: 'mcp',
      fallback_error: err.message,
    };
  }
}

export async function provisionOpenConnectorForUser(user) {
  const userId = String(user?.id || '').trim();
  if (!userId) throw new Error('Authenticated user required');
  const env = getOpenConnectorEnvConfig();
  if (!env.url) throw new Error('OpenConnector URL not configured');

  const label = user?.email
    ? `${user.email} (${userId})`
    : `${user?.name || 'CEO'} (${userId})`;
  const payload = await openConnectorFetch('/api/runtime-tokens', {
    method: 'POST',
    auth: 'admin',
    body: { name: label },
  });
  const token =
    trimOrNull(payload?.token) ||
    trimOrNull(payload?.runtime_token) ||
    trimOrNull(payload?.value) ||
    trimOrNull(payload?.plainToken);
  if (!token) {
    throw new Error('OpenConnector did not return a runtime token');
  }
  const provisioned = upsertOpenConnectorLink(userId, {
    runtime_token: token,
    connection_name: defaultConnectionName(userId),
    last_provisioned_at: new Date().toISOString(),
    last_error: null,
  });
  return {
    ...provisioned,
    provisioned: true,
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
