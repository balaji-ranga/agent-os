/**
 * Re-seed Platform standard template and apply AGENT-OS-OPS.md (ops only) to all Balaji agents.
 * Does not overwrite SOUL/AGENTS/TOOLS/IDENTITY for any agent — use product templates for those.
 *
 * Usage: node scripts/apply-platform-standard-to-bala.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { listAgentsForUser } from '../src/services/users.js';
import { ensureTenantOpenClawAgent } from '../src/services/openclaw-tenant.js';
import * as workspace from '../src/workspace/adapter.js';
import {
  seedPlatformStandardWorkspaceTemplate,
  PLATFORM_STANDARD_TEMPLATE_ID,
} from '../src/services/platform-agent-workspace-templates.js';

initDb();
const db = getDb();
const CEO =
  db.prepare(`SELECT id, name, role FROM platform_users WHERE id = 'ceo-bala'`).get() ||
  db.prepare(`SELECT id, name, role FROM platform_users WHERE name = ?`).get('Balaji Ranganathan');
if (!CEO) throw new Error('Balaji / ceo-bala not found');

const tpl = seedPlatformStandardWorkspaceTemplate();
const ops = String(tpl.files?.ops || '');
if (!/notify_ceo/i.test(ops) || !/Do NOT call notify_ceo/i.test(ops)) {
  throw new Error('Platform standard ops missing notify_ceo / noise rules');
}

const agents = listAgentsForUser(CEO.id);
const results = [];
for (const a of agents) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(a.id);
  if (!agent) continue;
  try {
    const ensured = ensureTenantOpenClawAgent(agent, CEO.id);
    await workspace.writeWorkspaceFile('ops', ops, { workspaceRoot: ensured.workspacePath });
    results.push({ id: agent.id, ok: true, written: ['ops'] });
  } catch (e) {
    results.push({ id: agent.id, ok: false, error: e.message });
  }
}

const failed = results.filter((r) => !r.ok);
console.log(
  JSON.stringify(
    {
      ceo: CEO.id,
      template: PLATFORM_STANDARD_TEMPLATE_ID,
      mode: 'ops-only',
      applied: results.filter((r) => r.ok).length,
      failed: failed.length,
      results,
    },
    null,
    2
  )
);
if (failed.length) process.exit(1);
console.log('APPLY_PLATFORM_STANDARD_BALA_OK');
