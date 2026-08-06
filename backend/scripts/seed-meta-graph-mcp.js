/**
 * Register Meta Graph MCP (Facebook) + OAuth provider config in the platform registry.
 *
 * Prerequisites:
 *   - meta-graph-mcp container (compose profile optional-meta-graph-mcp)
 *   - Prefer App ID/Secret on Connectors → MCPs (connector-level). Env FACEBOOK_APP_* is optional fallback only.
 *
 * Run: node backend/scripts/seed-meta-graph-mcp.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '../../deploy/.env') });

import { initDb, getDb } from '../src/db/schema.js';
import {
  createMcpServer,
  updateMcpServer,
  getMcpServer,
  connectMcpServer,
} from '../src/services/mcp-servers.js';
import { ensureFacebookOauthConfig } from '../src/services/mcp-oauth.js';

initDb();

export const META_GRAPH_MCP_ID = 'mcp-meta-graph';

export function getMetaGraphMcpUrl() {
  return process.env.META_GRAPH_MCP_URL || 'http://meta-graph-mcp:8081/mcp';
}

export async function seedMetaGraphMcp() {
  const admin =
    getDb().prepare(`SELECT id, role FROM platform_users WHERE role = 'admin' AND enabled = 1 LIMIT 1`).get() ||
    getDb().prepare(`SELECT id, role FROM platform_users WHERE role = 'ceo' AND enabled = 1 LIMIT 1`).get();
  if (!admin) throw new Error('No admin/CEO user for MCP seed');
  const authUser = { id: admin.id, role: admin.role };
  const url = getMetaGraphMcpUrl();

  let server = getMcpServer(META_GRAPH_MCP_ID, authUser);
  const description =
    'Facebook / Meta Graph API (Pages + Instagram). Connect OAuth on Connectors / MCPs; workflows use mcp_tool with your session token.';
  if (!server) {
    server = createMcpServer(authUser, {
      id: META_GRAPH_MCP_ID,
      name: 'Facebook / Meta Graph',
      description,
      url,
      transport: 'streamable_http',
    });
  } else {
    try {
      server = updateMcpServer(META_GRAPH_MCP_ID, authUser, {
        url,
        transport: 'streamable_http',
        description,
        name: 'Facebook / Meta Graph',
      });
    } catch (_) { /* keep */ }
  }

  // OAuth client config (env FACEBOOK_APP_ID / FACEBOOK_APP_SECRET)
  if (authUser.role === 'admin') {
    try {
      ensureFacebookOauthConfig(META_GRAPH_MCP_ID, authUser, {
        display_name: 'Facebook / Meta Graph',
        enabled: true,
      });
      console.info('[seed-meta-graph-mcp] oauth config ready', { server_id: META_GRAPH_MCP_ID });
    } catch (e) {
      console.warn('[seed-meta-graph-mcp] oauth config skipped', { error: e.message });
    }
  }

  // Health probe (no token required for tools/list via initialize)
  try {
    const result = await connectMcpServer(META_GRAPH_MCP_ID, authUser);
    const status = result?.status || getMcpServer(META_GRAPH_MCP_ID, authUser)?.status;
    console.info('[seed-meta-graph-mcp] connect', { status, url });
  } catch (e) {
    console.warn('[seed-meta-graph-mcp] connect failed (start meta-graph-mcp container)', {
      error: e.message,
      url,
    });
  }
  return getMcpServer(META_GRAPH_MCP_ID, authUser);
}

if (process.argv[1]?.includes('seed-meta-graph-mcp')) {
  seedMetaGraphMcp()
    .then((s) => console.log('OK', META_GRAPH_MCP_ID, s?.status, s?.url))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
