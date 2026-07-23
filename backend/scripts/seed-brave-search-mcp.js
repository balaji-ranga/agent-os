/**
 * Register Brave Search MCP (HTTP) in the platform MCP registry.
 *
 * Prerequisites:
 *   - Brave MCP container running (compose profile optional-brave-mcp)
 *   - BRAVE_API_KEY set on that container (not needed in Agent OS — key stays in MCP process)
 *
 * Run: node backend/scripts/seed-brave-search-mcp.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '../../deploy/.env') });

import { initDb, getDb } from '../src/db/schema.js';
import {
  connectMcpServer,
  createMcpServer,
  getMcpServer,
  updateMcpServer,
} from '../src/services/mcp-servers.js';

export const BRAVE_MCP_ID = 'mcp-brave-search';

export function getBraveMcpUrl() {
  return process.env.BRAVE_MCP_URL || 'http://brave-search-mcp:8080/mcp';
}

export async function seedBraveSearchMcp() {
  initDb();
  const db = getDb();
  const admin = db.prepare(`SELECT id, role FROM platform_users WHERE role = 'admin' LIMIT 1`).get();
  if (!admin) throw new Error('No admin user');
  const authUser = { id: admin.id, role: admin.role };
  const url = getBraveMcpUrl();

  let server = getMcpServer(BRAVE_MCP_ID, authUser);
  if (!server) {
    server = createMcpServer(authUser, {
      id: BRAVE_MCP_ID,
      name: 'Brave Search',
      description: 'Official Brave Search MCP (web / news / LLM context) over HTTP',
      url,
      transport: 'streamable_http',
    });
    console.log('Created MCP:', server.id, server.url);
  } else {
    console.log('MCP already exists:', server.id);
    if (url && server.url !== url) {
      server = updateMcpServer(BRAVE_MCP_ID, authUser, { url, transport: 'streamable_http' });
      console.log('Updated MCP URL:', url);
    }
  }

  console.log('Probing', url, '...');
  const result = await connectMcpServer(BRAVE_MCP_ID, authUser);
  console.log('Status:', result.status);
  console.log('Tools:', (result.tools || []).map((t) => t.name).join(', ') || '(none)');
  if (result.status !== 'healthy') {
    throw new Error('MCP not healthy — ensure brave-search-mcp is up and BRAVE_API_KEY is set');
  }
  return result;
}

if (process.argv[1]?.includes('seed-brave-search-mcp')) {
  seedBraveSearchMcp()
    .then(() => console.log('OK', BRAVE_MCP_ID))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
