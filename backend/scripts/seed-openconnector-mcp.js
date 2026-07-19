/**
 * Register OpenConnector as a platform MCP server (admin-owned, visible to CEOs).
 *
 * Start mock (dev/e2e):
 *   node tools/openconnector-mcp-mock/server.js
 * Or point at a real OpenConnector runtime:
 *   OPENCONNECTOR_MCP_URL=http://localhost:3000/mcp
 *
 * Run:
 *   node backend/scripts/seed-openconnector-mcp.js
 *
 * Env:
 *   OPENCONNECTOR_MCP_URL   — required (default: mock on 3105)
 *   OPENCONNECTOR_MCP_ID    — default mcp-openconnector
 *   OPENCONNECTOR_MCP_BEARER — optional runtime token for /mcp
 *   OPENCONNECTOR_MCP_TRANSPORT — streamable_http | sse (default streamable_http)
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { connectMcpServer, createMcpServer, getMcpServer, updateMcpServer } from '../src/services/mcp-servers.js';

initDb();
const db = getDb();

const MCP_ID = process.env.OPENCONNECTOR_MCP_ID || 'mcp-openconnector';
const URL = (process.env.OPENCONNECTOR_MCP_URL || 'http://127.0.0.1:3105/mcp').replace(/\/$/, '');
const BEARER = String(process.env.OPENCONNECTOR_MCP_BEARER || process.env.OPENCONNECTOR_MOCK_TOKEN || '').trim();
const TRANSPORT = process.env.OPENCONNECTOR_MCP_TRANSPORT || 'streamable_http';

const admin = db.prepare(`SELECT id, role FROM platform_users WHERE role = 'admin' LIMIT 1`).get();
if (!admin) {
  console.error('No admin user — start backend once to seed admin, then re-run.');
  process.exit(1);
}
const authUser = { id: admin.id, role: admin.role };

let server = getMcpServer(MCP_ID, authUser);
if (!server) {
  server = createMcpServer(authUser, {
    id: MCP_ID,
    name: 'OpenConnector',
    description:
      'OpenConnector gateway (SaaS actions via MCP). Tools: list_apps, search_actions, get_action_guide, execute_action.',
    url: URL,
    transport: TRANSPORT,
    headers: BEARER ? { Authorization: `Bearer ${BEARER}` } : undefined,
    authBearer: BEARER || undefined,
  });
  console.log('Created MCP:', server.id);
} else {
  updateMcpServer(MCP_ID, authUser, {
    url: URL,
    transport: TRANSPORT,
    headers: BEARER ? { Authorization: `Bearer ${BEARER}` } : {},
    authBearer: BEARER || '',
  });
  console.log('Updated MCP:', server.id);
}

console.log('Connecting to', URL, '...');
const auth = BEARER ? { bearer: BEARER } : null;
try {
  const result = await connectMcpServer(MCP_ID, authUser, auth);
  console.log('Status:', result.status);
  console.log('Tools:', result.tools?.map((t) => t.name).join(', ') || '(none)');
} catch (e) {
  console.error('Connect failed:', e.message);
  console.error('Start the mock: node tools/openconnector-mcp-mock/server.js');
  console.error('Or set OPENCONNECTOR_MCP_URL to a live OpenConnector /mcp endpoint.');
  process.exit(1);
}
