#!/usr/bin/env node
/**
 * Heal agents.workspace_path when DB has host Windows paths that do not exist on this machine
 * (common after copying SQLite from laptop → VPS). Remaps via resolveAgentWorkspaceRoot.
 *
 * Usage: node scripts/heal-agent-workspace-paths.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { healAgentWorkspacePaths, resolveAgentWorkspaceRoot } from '../src/workspace/adapter.js';
import { existsSync } from 'fs';

initDb();
const out = healAgentWorkspacePaths(getDb());
console.log('heal:', out);

const sample = getDb()
  .prepare(`SELECT id, workspace_path, openclaw_agent_id, owner_user_id FROM agents ORDER BY rowid LIMIT 8`)
  .all();
for (const a of sample) {
  try {
    const root = resolveAgentWorkspaceRoot(a, { healDb: false });
    const soul = `${root.replace(/\\/g, '/')}/SOUL.md`;
    console.log(a.id, '→', root, existsSync(soul) ? 'SOUL.md OK' : 'SOUL.md missing');
  } catch (e) {
    console.log(a.id, 'ERR', e.message);
  }
}
console.log('HEAL_WORKSPACE_PATHS_OK');
