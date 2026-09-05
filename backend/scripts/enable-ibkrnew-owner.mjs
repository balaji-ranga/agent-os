/**
 * Enable the complete IBKRNew0 paper feature for one existing CEO owner.
 *
 * Usage:
 *   node scripts/enable-ibkrnew-owner.mjs --owner-id ceo-example
 *   node scripts/enable-ibkrnew-owner.mjs --user-name "Example Owner"
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
config({ path: join(scriptDir, '..', '.env') });

const { initDb, getDb } = await import('../src/db/schema.js');
const { enrollIbkrNewOwner } = await import('../src/services/ibkrnew-owner-enrollment.js');
initDb();

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

const requestedId = valueAfter('--owner-id');
const requestedName = valueAfter('--user-name');
if ((!requestedId && !requestedName) || (requestedId && requestedName)) {
  console.error('Specify exactly one of --owner-id or --user-name');
  process.exit(2);
}

const db = getDb();
let ownerId = requestedId;
if (requestedName) {
  const matches = db.prepare(
    `SELECT id FROM platform_users WHERE lower(name) = lower(?) ORDER BY id`
  ).all(requestedName);
  if (matches.length !== 1) {
    console.error(matches.length ? 'User name is ambiguous; use --owner-id' : 'User was not found');
    process.exit(2);
  }
  ownerId = matches[0].id;
}

const result = await enrollIbkrNewOwner(ownerId);
console.log(JSON.stringify(result, null, 2));
