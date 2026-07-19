/**
 * OpenConnector integration status — env + MCP registry (no hardcoded URLs).
 */
import { getDb } from '../db/schema.js';
import { getMcpServer, listVisibleMcpServers } from './mcp-servers.js';

export function getOpenConnectorEnvConfig() {
  return {
    mcp_url: String(process.env.OPENCONNECTOR_MCP_URL || '').trim() || null,
    mcp_id: String(process.env.OPENCONNECTOR_MCP_ID || 'mcp-openconnector').trim(),
    transport: String(process.env.OPENCONNECTOR_MCP_TRANSPORT || 'streamable_http').trim(),
    has_bearer: Boolean(String(process.env.OPENCONNECTOR_MCP_BEARER || '').trim()),
  };
}

export function getOpenConnectorStatus(authUser) {
  const env = getOpenConnectorEnvConfig();
  const server = getMcpServer(env.mcp_id, authUser);
  const visible = listVisibleMcpServers(authUser).filter(
    (s) => s.id === env.mcp_id || /openconnector/i.test(s.name || '')
  );
  return {
    configured: Boolean(env.mcp_url || server),
    env,
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
  return getDb().prepare('SELECT id, name, url, status, is_platform FROM mcp_servers WHERE id = ?').get(id);
}
