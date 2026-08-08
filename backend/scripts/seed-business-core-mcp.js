/**
 * Seed platform MCP rows: Flolah CRM + Flolah ERP (same business-core-mcp container).
 * Run: node backend/scripts/seed-business-core-mcp.js
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

export const FLOLAH_CRM_MCP_ID = 'mcp-flolah-crm';
export const FLOLAH_ERP_MCP_ID = 'mcp-flolah-erp';

export function getBusinessCoreMcpUrl() {
  return process.env.BUSINESS_CORE_MCP_URL || 'http://business-core-mcp:8082/mcp';
}

function adminAuth() {
  const admin =
    getDb().prepare(`SELECT id, role FROM platform_users WHERE role = 'admin' AND enabled = 1 LIMIT 1`).get() ||
    getDb().prepare(`SELECT id, role FROM platform_users WHERE role = 'ceo' AND enabled = 1 LIMIT 1`).get();
  if (!admin) throw new Error('No admin/CEO user for MCP seed');
  return { id: admin.id, role: admin.role };
}

async function upsertPlatformMcp(authUser, { id, name, description, url }) {
  let server = getMcpServer(id, authUser);
  if (!server) {
    server = createMcpServer(authUser, {
      id,
      name,
      description,
      url,
      transport: 'streamable_http',
    });
  } else {
    try {
      getDb()
        .prepare(
          `UPDATE mcp_servers SET url = ?, description = ?, name = ?, transport = 'streamable_http',
             is_platform = 1, owner_role = 'admin', updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(url, description, name, id);
      server = getMcpServer(id, authUser);
    } catch (e) {
      try {
        server = updateMcpServer(id, authUser, { url, description, name, transport: 'streamable_http' });
      } catch (_) {
        console.warn('[seed-business-core-mcp] update skipped', id, e?.message);
      }
    }
  }
  try {
    const result = await connectMcpServer(id, authUser);
    console.info('[seed-business-core-mcp] connect', {
      id,
      status: result?.status || getMcpServer(id, authUser)?.status,
      url,
    });
  } catch (e) {
    console.warn('[seed-business-core-mcp] connect failed (start business-core-mcp)', {
      id,
      error: e.message,
      url,
    });
  }
  return getMcpServer(id, authUser);
}

export async function seedBusinessCoreMcps() {
  const authUser = adminAuth();
  const url = getBusinessCoreMcpUrl();

  const crm = await upsertPlatformMcp(authUser, {
    id: FLOLAH_CRM_MCP_ID,
    name: 'Flolah CRM (Twenty)',
    description:
      'Twenty CRM REST via Flolah tools (v2). Status, people, companies, opportunities/deals, leads (early-stage opportunities), notes, tasks, org sync. Pass X-Ceo-User-Id. Needs platform TWENTY_APP_SECRET + SSO (per-company workspace access tokens) and company Profile CRM = Twenty. Prefab CRM agents use matching crm_* content tools.',
    url,
  });

  const erp = await upsertPlatformMcp(authUser, {
    id: FLOLAH_ERP_MCP_ID,
    name: 'Flolah ERP (ERPNext)',
    description:
      'ERPNext Frappe REST via Flolah tools (v2). Status, customers, leads, items, quotations, sales orders, projects, generic resource list/create/get, org sync. Pass X-Ceo-User-Id. Needs ERPNext API key/secret + company Profile ERP = ERPNext. Prefab ERP agents use matching erp_* content tools.',
    url,
  });

  return { crm, erp, url };
}

if (process.argv[1]?.includes('seed-business-core-mcp')) {
  seedBusinessCoreMcps()
    .then((r) => {
      console.log('OK', FLOLAH_CRM_MCP_ID, r.crm?.status, FLOLAH_ERP_MCP_ID, r.erp?.status, r.url);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}