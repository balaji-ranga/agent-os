#!/usr/bin/env node
/** Operator CLI for the Northstar OKR company demo seed pack. */
import { initDb } from '../src/db/schema.js';
import { getUserById } from '../src/services/users.js';
import {
  cleanupDemoSeedPack,
  ensureDemoCeo,
  getDemoSeedPackInstall,
  planDemoSeedPack,
  reseedDemoSeedPack,
  seedDemoSeedPack,
} from '../src/services/demo-seed-pack.js';

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const [key, inline] = raw.slice(2).split('=', 2);
    if (inline != null) out[key] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

function userByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  return initDb().prepare('SELECT id FROM platform_users WHERE lower(email)=?').get(normalized) || null;
}

async function resolveOwner(options, mode) {
  if (options['owner-id']) {
    const user = getUserById(String(options['owner-id']));
    if (!user) throw new Error(`CEO not found: ${options['owner-id']}`);
    return { user, created: false };
  }
  if (options['owner-email']) {
    const row = userByEmail(options['owner-email']);
    if (row) return { user: getUserById(row.id), created: false };
  }
  if (options['create-owner']) {
    return ensureDemoCeo({ email: options['owner-email'], name: options['owner-name'] });
  }
  if (mode === 'preview') return { user: null, created: false };
  throw new Error('Pass --owner-id, an existing --owner-email, or --create-owner');
}

async function main() {
  initDb();
  const options = argsOf(process.argv.slice(2));
  const mode = String(options.mode || 'preview').toLowerCase();
  if (!['preview', 'status', 'seed', 'cleanup', 'reseed'].includes(mode)) throw new Error('mode must be preview, status, seed, cleanup, or reseed');
  const resolved = await resolveOwner(options, mode);
  const ownerUserId = resolved.user?.id || '';
  const includeExternal = options['skip-external'] !== true;
  let result;
  if (mode === 'preview') result = planDemoSeedPack({ ownerUserId, includeExternal });
  else if (mode === 'status') result = { ok: true, owner_user_id: ownerUserId, install: getDemoSeedPackInstall(ownerUserId) };
  else if (mode === 'seed') result = await seedDemoSeedPack({ ownerUserId, includeExternal, allowExistingOwner: options['allow-existing-owner'] === true });
  else if (mode === 'cleanup') result = await cleanupDemoSeedPack({ ownerUserId, includeExternal, confirmOwnerUserId: options['confirm-owner'] });
  else result = await reseedDemoSeedPack({ ownerUserId, includeExternal, allowExistingOwner: options['allow-existing-owner'] === true, confirmOwnerUserId: ownerUserId });
  console.log(JSON.stringify({ mode, owner: resolved.user ? { id: ownerUserId, email: resolved.user.email, name: resolved.user.name, created: resolved.created } : null, ...result }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
