/**
 * Unit: living Twenty CRM workspace ids ignore ERPNext leftovers and missing users.
 *
 *   node backend/scripts/test-living-twenty-crm-holds.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { hashPassword } from '../src/services/auth/password.js';
import {
  ensureCompanyBusinessProfileSchema,
  updateBusinessProviders,
  setTwentyBind,
  listLivingTwentyCrmWorkspaceIds,
} from '../src/services/company-business-profile.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

initDb();
ensureCompanyBusinessProfileSchema();
const db = getDb();
const suffix = randomBytes(4).toString('hex');
const twentyCeo = `ceo-hold-t-${suffix}`;
const erpCeo = `ceo-hold-e-${suffix}`;
const ghost = `ceo-hold-g-${suffix}`;
const wsTwenty = '11111111-1111-4111-8111-111111111111';
const wsErpLeftover = '22222222-2222-4222-8222-222222222222';
const wsGhost = '33333333-3333-4333-8333-333333333333';
const hash = hashPassword('HoldTest!23');

function insertCeo(id, name) {
  db.prepare(
    `INSERT INTO platform_users (id, email, password_hash, name, role, enabled)
     VALUES (?, ?, ?, ?, 'ceo', 1)`
  ).run(id, `${id}@example.invalid`, hash, name);
}

try {
  insertCeo(twentyCeo, `Hold Twenty ${suffix}`);
  insertCeo(erpCeo, `Hold Erp ${suffix}`);
  updateBusinessProviders(twentyCeo, { crm_provider: 'twenty' });
  setTwentyBind(twentyCeo, { workspace_id: wsTwenty, workspace_name: 'T', bind: { mode: 'remote_created' } });
  updateBusinessProviders(erpCeo, { crm_provider: 'erpnext' });
  setTwentyBind(erpCeo, { workspace_id: wsErpLeftover, workspace_name: 'E leftover', bind: {} });
  db.prepare(
    `INSERT INTO company_business_profiles (owner_user_id, crm_provider, twenty_workspace_id)
     VALUES (?, 'twenty', ?)`
  ).run(ghost, wsGhost);

  const held = listLivingTwentyCrmWorkspaceIds();
  assert(held.includes(wsTwenty), 'living Twenty CEO workspace must be held');
  assert(!held.includes(wsErpLeftover), 'ERPNext CEO leftover Twenty bind must not hold a slot');
  assert(!held.includes(wsGhost), 'profile without platform_users must not hold a slot');
  console.log('PASS: living Twenty CRM holds', { held: held.length, suffix });
} finally {
  for (const id of [twentyCeo, erpCeo, ghost]) {
    try {
      db.prepare(`DELETE FROM company_business_profiles WHERE owner_user_id = ?`).run(id);
    } catch {
      /* ignore */
    }
    try {
      db.prepare(`DELETE FROM platform_users WHERE id = ?`).run(id);
    } catch {
      /* ignore */
    }
  }
}
