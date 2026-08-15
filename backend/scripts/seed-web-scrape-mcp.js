/**
 * Register Web Scrape MCP (HTTP) in the platform MCP registry.
 * Run: node backend/scripts/seed-web-scrape-mcp.js
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

export const WEB_SCRAPE_MCP_ID = 'mcp-web-scrape';

export function getWebScrapeMcpUrl() {
  return process.env.WEB_SCRAPE_MCP_URL || 'http://web-scrape-mcp:8085/mcp';
}

export async function seedWebScrapeMcp() {
  const admin =
    getDb().prepare(`SELECT id, role FROM platform_users WHERE role = 'admin' AND enabled = 1 LIMIT 1`).get() ||
    getDb().prepare(`SELECT id, role FROM platform_users WHERE role = 'ceo' AND enabled = 1 LIMIT 1`).get();
  if (!admin) throw new Error('No admin/CEO user for MCP seed');
  const authUser = { id: admin.id, role: admin.role };
  const url = getWebScrapeMcpUrl();
  const description =
    'Generic HTTPS crawler (Crawlee). scrape_url / scrape_domain with phrase filter, robots.txt, same-origin caps. Pass X-Ceo-User-Id. Workflow Web Scrape node uses the same sidecar.';

  let server = getMcpServer(WEB_SCRAPE_MCP_ID, authUser);
  if (!server) {
    server = createMcpServer(authUser, {
      id: WEB_SCRAPE_MCP_ID,
      name: 'Web Scrape',
      description,
      url,
      transport: 'streamable_http',
    });
  } else {
    try {
      server = updateMcpServer(WEB_SCRAPE_MCP_ID, authUser, {
        url,
        transport: 'streamable_http',
        description,
        name: 'Web Scrape',
      });
    } catch (_) {
      /* keep */
    }
  }

  try {
    getDb()
      .prepare(
        `UPDATE mcp_servers SET is_platform = 1, owner_role = 'admin', updated_at = datetime('now') WHERE id = ?`
      )
      .run(WEB_SCRAPE_MCP_ID);
  } catch (_) {}

  try {
    const result = await connectMcpServer(WEB_SCRAPE_MCP_ID, authUser);
    const status = result?.status || getMcpServer(WEB_SCRAPE_MCP_ID, authUser)?.status;
    console.info('[seed-web-scrape-mcp] connect', { id: WEB_SCRAPE_MCP_ID, status, url });
  } catch (e) {
    console.warn('[seed-web-scrape-mcp] connect failed (start web-scrape-mcp)', e.message);
  }
  return getMcpServer(WEB_SCRAPE_MCP_ID, authUser);
}

if (process.argv[1]?.includes('seed-web-scrape-mcp')) {
  seedWebScrapeMcp()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
