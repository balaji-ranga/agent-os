/**
 * Offboard all platform users except protected keepers.
 * Keep: Balaji Ranganathan, Admin, Aru, Senthil Loganathan (+ any admin role / ceo-bala).
 *
 * Usage:
 *   node scripts/offboard-users-except-keepers.js --dry-run
 *   node scripts/offboard-users-except-keepers.js --confirm
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb } from '../src/db/schema.js';
import {
  offboardAllExceptProtected,
  PROTECTED_OFFBOARD_NAMES,
} from '../src/services/user-offboard.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || !args.includes('--confirm');

initDb();
console.log('Protected names:', PROTECTED_OFFBOARD_NAMES.join(', '));
console.log(dryRun ? 'DRY RUN (pass --confirm to delete)' : 'CONFIRM — offboarding…');

const result = offboardAllExceptProtected({
  dryRun,
  actor: { id: 'system', name: 'offboard-script' },
});

console.log('KEPT', result.kept.length);
for (const u of result.kept) console.log('  keep', u.id, u.name, u.email, u.role);
console.log(dryRun ? 'WOULD REMOVE' : 'REMOVED', result.removed.length);
for (const u of result.removed) console.log('  rm', u.id, u.name, u.email);
if (result.errors.length) {
  console.log('ERRORS', result.errors.length);
  for (const e of result.errors) console.log('  err', e.id, e.name, e.error);
  process.exit(1);
}
console.log(dryRun ? 'PASS dry-run' : 'PASS offboard complete');
