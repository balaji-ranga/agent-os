#!/usr/bin/env node
/**
 * Refresh COO workspace docs (AGENTS/TOOLS/SOUL) on legacy + tenant paths, then org-sync.
 * Usage: node scripts/refresh-coo-workspace-docs.js
 */
import { cpSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { initDb, getDb } from '../src/db/schema.js';
import { syncOrgContextForCeo } from '../src/services/org-context.js';
import { getOpenClawDir } from '../src/config/openclaw-paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tpl = join(__dirname, '..', '..', 'openclaw-workspace-templates', 'balserve');
const files = ['AGENTS.md', 'TOOLS.md', 'SOUL.md'];

initDb();
const openclaw = getOpenClawDir();
const legacy = join(openclaw, 'workspace-balserve');
for (const f of files) {
  const src = join(tpl, f);
  if (existsSync(src) && existsSync(legacy)) cpSync(src, join(legacy, f));
}

let refreshed = 0;
const tenantsRoot = join(openclaw, 'tenants');
if (existsSync(tenantsRoot)) {
  for (const ceo of readdirSync(tenantsRoot)) {
    const ws = join(tenantsRoot, ceo, 'workspace-balserve');
    if (!existsSync(ws)) continue;
    for (const f of ['TOOLS.md', 'SOUL.md']) {
      const src = join(tpl, f);
      if (existsSync(src)) cpSync(src, join(ws, f));
    }
    refreshed += 1;
  }
}

const ceos = getDb().prepare(`SELECT id FROM platform_users WHERE role = 'ceo'`).all();
let synced = 0;
for (const c of ceos) {
  synced += await syncOrgContextForCeo(c.id);
}

const tenantAgents = join(openclaw, 'tenants', 'ceo-bala', 'workspace-balserve', 'AGENTS.md');
const legacyAgents = join(legacy, 'AGENTS.md');
console.log(
  JSON.stringify(
    {
      refreshed_tenant_coo_ws: refreshed,
      org_synced: synced,
      tenant_has_critical: existsSync(tenantAgents) && readFileSync(tenantAgents, 'utf8').includes('CRITICAL'),
      legacy_has_critical: existsSync(legacyAgents) && readFileSync(legacyAgents, 'utf8').includes('CRITICAL'),
    },
    null,
    2
  )
);
console.log('REFRESH_COO_WORKSPACE_DOCS_OK');
