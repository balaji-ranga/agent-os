#!/usr/bin/env node
/**
 * Push CRM/ERP Maker-Checker workspace templates (incl. DOMAIN.md SME cards)
 * for every CEO whose Profile already enables platform Twenty / ERPNext.
 * Usage: node scripts/refresh-business-core-workspace-docs.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { getBusinessProfile } from '../src/services/company-business-profile.js';
import { ensurePrefabCrmAgents } from '../src/services/prefab-crm-agents.js';
import { ensurePrefabErpAgents } from '../src/services/prefab-erp-agents.js';

initDb();

const ceos = getDb().prepare(`SELECT id FROM platform_users WHERE role = 'ceo'`).all();
const summary = { ceos: ceos.length, crm: 0, erp: 0, skipped: 0, errors: [] };

for (const row of ceos) {
  const owner = row.id;
  try {
    const profile = getBusinessProfile(owner);
    let did = false;
    if (profile.crm_provider === 'twenty' || profile.crm_provider === 'erpnext') {
      const crm = await ensurePrefabCrmAgents(owner);
      summary.crm += 1;
      did = true;
      console.info('[refresh-bc-ws] crm owner=%s agents=%s', owner, (crm.agents || []).join(','));
    }
    if (profile.erp_provider === 'erpnext') {
      const erp = await ensurePrefabErpAgents(owner);
      summary.erp += 1;
      did = true;
      console.info('[refresh-bc-ws] erp owner=%s agents=%s', owner, (erp.agents || []).join(','));
    }
    if (!did) summary.skipped += 1;
  } catch (e) {
    summary.errors.push({ owner, error: e?.message || String(e) });
    console.warn('[refresh-bc-ws] owner=%s err=%s', owner, e?.message || e);
  }
}

console.log(JSON.stringify(summary, null, 2));
if (summary.errors.length) {
  console.log('REFRESH_BUSINESS_CORE_WORKSPACE_DOCS_WARN');
  process.exitCode = 0;
} else {
  console.log('REFRESH_BUSINESS_CORE_WORKSPACE_DOCS_OK');
}
