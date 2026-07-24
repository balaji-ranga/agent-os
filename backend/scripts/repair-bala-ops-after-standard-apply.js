/**
 * Repair: restore product workspace templates for Balaji agents that have a
 * matching openclaw-workspace-templates/<id> folder, then write Platform standard
 * AGENT-OS-OPS.md (notify_ceo guidance) on every Balaji agent.
 *
 * Usage: node scripts/repair-bala-ops-after-standard-apply.js
 */
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initDb, getDb } from '../src/db/schema.js';
import { listAgentsForUser } from '../src/services/users.js';
import { forcePushTemplateDocs, ensureTenantOpenClawAgent } from '../src/services/openclaw-tenant.js';
import {
  seedPlatformStandardWorkspaceTemplate,
  PLATFORM_STANDARD_TEMPLATE_ID,
  getTemplate,
} from '../src/services/platform-agent-workspace-templates.js';
import * as workspace from '../src/workspace/adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_ROOT = join(__dirname, '..', '..', 'openclaw-workspace-templates');

initDb();
const db = getDb();
const CEO = db.prepare(`SELECT id, name FROM platform_users WHERE id = 'ceo-bala'`).get();
if (!CEO) throw new Error('ceo-bala missing');

seedPlatformStandardWorkspaceTemplate();
const tpl = getTemplate(PLATFORM_STANDARD_TEMPLATE_ID, { includeFiles: true });
const ops = tpl.files?.ops;
if (!ops || !/notify_ceo/i.test(ops)) throw new Error('ops missing notify section');

const agents = listAgentsForUser(CEO.id);
const restored = [];
const skippedRestore = [];
for (const a of agents) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(a.id);
  if (!agent) continue;
  const tplDir = join(TEMPLATES_ROOT, agent.id);
  if (!existsSync(tplDir)) {
    skippedRestore.push(agent.id);
    continue;
  }
  const ensured = ensureTenantOpenClawAgent(agent, CEO.id);
  const r = forcePushTemplateDocs(agent.id, ensured.workspacePath, { forceIdentity: true });
  restored.push({ id: agent.id, copied: r.copied });
}

let opsWritten = 0;
for (const a of agents) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(a.id);
  if (!agent) continue;
  const ensured = ensureTenantOpenClawAgent(agent, CEO.id);
  await workspace.writeWorkspaceFile('ops', ops, { workspaceRoot: ensured.workspacePath });
  opsWritten += 1;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      ceo: CEO.id,
      restored,
      skipped_restore: skippedRestore,
      ops_written: opsWritten,
    },
    null,
    2
  )
);
console.log('REPAIR_BALA_OPS_OK');
