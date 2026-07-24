/**
 * Register Brave Search MCP (HTTP) in the platform MCP registry.
 *
 * Prerequisites:
 *   - Brave MCP BYOK container running (compose profile optional-brave-mcp)
 *   - API keys are supplied per workflow MCP request (X-Subscription-Token / Bearer)
 *     — do NOT rely on BRAVE_API_KEY in the MCP container
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
  createMcpServer,
  updateMcpServer,
  getMcpServer,
  connectMcpServer,
} from '../src/services/mcp-servers.js';

initDb();

export const BRAVE_MCP_ID = 'mcp-brave-search';

export function getBraveMcpUrl() {
  return process.env.BRAVE_MCP_URL || 'http://brave-search-mcp:8080/mcp';
}

export async function seedBraveSearchMcp() {
  const admin =
    getDb().prepare(`SELECT id, role FROM platform_users WHERE role = 'admin' AND enabled = 1 LIMIT 1`).get() ||
    getDb().prepare(`SELECT id, role FROM platform_users WHERE role = 'ceo' AND enabled = 1 LIMIT 1`).get();
  if (!admin) throw new Error('No admin/CEO user for MCP seed');
  const authUser = { id: admin.id, role: admin.role };
  const url = getBraveMcpUrl();

  let server = getMcpServer(BRAVE_MCP_ID, authUser);
  if (!server) {
    server = createMcpServer(authUser, {
      id: BRAVE_MCP_ID,
      name: 'Brave Search',
      description:
        'Brave Search MCP (BYOK). Pass X-Subscription-Token or Authorization Bearer from the workflow — platform BRAVE_API_KEY is not used.',
      url,
      transport: 'streamable_http',
    });
  } else {
    try {
      server = updateMcpServer(BRAVE_MCP_ID, authUser, {
        url,
        transport: 'streamable_http',
        description:
          'Brave Search MCP (BYOK). Pass X-Subscription-Token or Authorization Bearer from the workflow — platform BRAVE_API_KEY is not used.',
      });
    } catch (_) {
      /* keep existing */
    }
  }

  const result = await connectMcpServer(BRAVE_MCP_ID, authUser);
  const status = result?.status || getMcpServer(BRAVE_MCP_ID, authUser)?.status;
  if (status !== 'healthy') {
    throw new Error('MCP not healthy — ensure brave-search-mcp BYOK container is up (no env key required)');
  }
  return getMcpServer(BRAVE_MCP_ID, authUser);
}

if (process.argv[1]?.includes('seed-brave-search-mcp')) {
  seedBraveSearchMcp()
    .then((s) => console.log('OK', BRAVE_MCP_ID, s?.status, s?.url))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
