/**
 * Admin bulk provision: runtime tokens + connection slots for all CEOs.
 *
 * Run on VPS:
 *   docker compose exec -T -w /opt/agent-os/backend backend node scripts/provision-openconnector-ceos.js
 *
 * Env: OPENCONNECTOR_URL, OPENCONNECTOR_ADMIN_TOKEN (for auto token creation)
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { provisionOpenConnectorForUser } from '../src/services/openconnector.js';

initDb();
const db = getDb();
const appIds = String(process.env.OPENCONNECTOR_PROVISION_APPS || 'hackernews,github,gmail')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ceos = db
  .prepare(`SELECT id, email, name, role FROM platform_users WHERE role = 'ceo' ORDER BY rowid`)
  .all();

if (!ceos.length) {
  console.log('No CEO users found.');
  process.exit(0);
}

console.log(`Provisioning OpenConnector for ${ceos.length} CEO(s), apps: ${appIds.join(', ')}`);
let ok = 0;
let fail = 0;
for (const ceo of ceos) {
  try {
    const result = await provisionOpenConnectorForUser(ceo, { ensureConnections: true, appIds });
    console.log(
      `  OK ${ceo.email || ceo.id}: linked=${result.runtime_token_set} slots=${(result.connection_slots || []).length}`
    );
    ok += 1;
  } catch (e) {
    console.error(`  FAIL ${ceo.email || ceo.id}: ${e.message}`);
    fail += 1;
  }
}
console.log(`Done: ${ok} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
