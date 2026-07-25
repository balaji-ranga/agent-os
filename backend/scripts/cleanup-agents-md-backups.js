/**
 * One-time maintenance: delete AGENTS.md.bak.* / ORG.md.bak.* files from tenant workspaces.
 *
 * The COO's AGENTS.md is regenerated from the live org on every chat, and the writer used to keep a
 * timestamped backup each time, leaving hundreds of dead files inside agent workspaces.
 *
 * Usage: node backend/scripts/cleanup-agents-md-backups.js [--dry-run]
 */
import { existsSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const dryRun = process.argv.includes('--dry-run');
const BAK = /\.(md)\.bak\.\d+$/i;

function openclawDir() {
  return process.env.OPENCLAW_DIR || join(homedir(), '.openclaw');
}

function workspaceDirs() {
  const root = openclawDir();
  const dirs = [];
  const tenants = join(root, 'tenants');
  if (existsSync(tenants)) {
    for (const tenant of readdirSync(tenants)) {
      const tenantDir = join(tenants, tenant);
      if (!statSync(tenantDir).isDirectory()) continue;
      for (const ws of readdirSync(tenantDir)) {
        if (!ws.startsWith('workspace-')) continue;
        dirs.push(join(tenantDir, ws));
      }
    }
  }
  if (existsSync(root)) {
    for (const entry of readdirSync(root)) {
      if (entry.startsWith('workspace-')) dirs.push(join(root, entry));
    }
  }
  return dirs;
}

let removed = 0;
let bytes = 0;
for (const ws of workspaceDirs()) {
  let files = [];
  try {
    files = readdirSync(ws).filter((f) => BAK.test(f));
  } catch (e) {
    console.warn('[cleanup] cannot read workspace', ws, e?.message || e);
    continue;
  }
  if (!files.length) continue;
  console.log(`${ws}: ${files.length} backup file(s)`);
  for (const f of files) {
    const p = join(ws, f);
    try {
      bytes += statSync(p).size;
      if (!dryRun) rmSync(p, { force: true });
      removed += 1;
    } catch (e) {
      console.warn('[cleanup] delete failed', p, e?.message || e);
    }
  }
}

console.log(
  `${dryRun ? '[dry-run] would remove' : 'removed'} ${removed} backup file(s), ${(bytes / 1024).toFixed(1)} KB`
);
