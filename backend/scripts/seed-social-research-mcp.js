/**
 * Register Social Research MCP (HTTP) in the platform MCP registry.
 * Run: node backend/scripts/seed-social-research-mcp.js
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

export const SOCIAL_RESEARCH_MCP_ID = 'mcp-social-research';

export function getSocialResearchMcpUrl() {
  return process.env.SOCIAL_RESEARCH_MCP_URL || 'http://social-research-mcp:8084/mcp';
}

export async function seedSocialResearchMcp() {
  const admin =
    getDb().prepare(`SELECT id, role FROM platform_users WHERE role = 'admin' AND enabled = 1 LIMIT 1`).get() ||
    getDb().prepare(`SELECT id, role FROM platform_users WHERE role = 'ceo' AND enabled = 1 LIMIT 1`).get();
  if (!admin) throw new Error('No admin/CEO user for MCP seed');
  const authUser = { id: admin.id, role: admin.role };
  const url = getSocialResearchMcpUrl();
  const description =
    'Social Research MCP (Places, Instaloader, X/Instagram post hydrate, Meta Graph). Pass X-Ceo-User-Id. Same tools as social_research_* / business_discover content tools.';

  let server = getMcpServer(SOCIAL_RESEARCH_MCP_ID, authUser);
  if (!server) {
    server = createMcpServer(authUser, {
      id: SOCIAL_RESEARCH_MCP_ID,
      name: 'Social Research',
      description,
      url,
      transport: 'streamable_http',
    });
  } else {
    try {
      server = updateMcpServer(SOCIAL_RESEARCH_MCP_ID, authUser, {
        url,
        transport: 'streamable_http',
        description,
        name: 'Social Research',
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
      .run(SOCIAL_RESEARCH_MCP_ID);
  } catch (_) {}

  try {
    const result = await connectMcpServer(SOCIAL_RESEARCH_MCP_ID, authUser);
    const status = result?.status || getMcpServer(SOCIAL_RESEARCH_MCP_ID, authUser)?.status;
    console.info('[seed-social-research-mcp] connect', { id: SOCIAL_RESEARCH_MCP_ID, status, url });
  } catch (e) {
    console.warn('[seed-social-research-mcp] connect failed (start social-research-mcp)', e.message);
  }
  return getMcpServer(SOCIAL_RESEARCH_MCP_ID, authUser);
}

if (process.argv[1]?.includes('seed-social-research-mcp')) {
  seedSocialResearchMcp()
    .then((s) => console.log('OK', SOCIAL_RESEARCH_MCP_ID, s?.status, s?.url))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
