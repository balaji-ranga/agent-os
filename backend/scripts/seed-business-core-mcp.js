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
    name: 'Flolah CRM (Twenty or ERPNext)',
    description:
      'CRM REST via Flolah tools (v2). When Profile CRM=Twenty → Twenty people/companies/opps/leads (crm_*). When CRM=ERPNext → same crm_* routes map to ERPNext Sales modules (Contact, Customer, Opportunity, Lead, Task). Pass X-Ceo-User-Id. Prefab CRM Makers get crm_* (Twenty) or sales erp_*/crm_* (ERPNext).',
    url,
  });

  const erp = await upsertPlatformMcp(authUser, {
    id: FLOLAH_ERP_MCP_ID,
    name: 'Flolah ERP (ERPNext)',
    description:
      'ERPNext Frappe REST via Flolah erp_* tools (v2): customers, leads, contacts, opportunities, items, quotations, sales/purchase orders & invoices, delivery notes, payments, journal, material requests, projects/tasks, GL, P&L, resource CRUD, submit/cancel, org sync. Pass X-Ceo-User-Id. Needs ERPNEXT_API_KEY/SECRET + Profile CRM or ERP = ERPNext. Makers draft; Checker submit/cancel.',
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