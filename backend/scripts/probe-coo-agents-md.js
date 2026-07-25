import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { initDb, getDb } from '../src/db/schema.js';
import {
  buildOrgContextForCeo,
  buildCooAgentsMd,
  formatOrgMd,
  syncOrgContextForCeo,
  readCooAgentsMdForCeo,
  getCooAgentRow,
} from '../src/services/org-context.js';
import { resolveAgentWorkspaceRoot } from '../src/workspace/adapter.js';

initDb();
const OWNER = 'ceo-bala';
const openclaw = process.env.OPENCLAW_DIR || '/root/.openclaw';
console.log('OPENCLAW_DIR', openclaw);

const coo = getCooAgentRow();
const agent = getDb().prepare('SELECT * FROM agents WHERE id = ?').get(coo.id);
const uiRoot = resolveAgentWorkspaceRoot({ ...agent, owner_user_id: OWNER }, { ceoUserId: OWNER });
console.log('UI workspace root for COO', uiRoot);

await syncOrgContextForCeo(OWNER);

const paths = [
  join(openclaw, 'tenants', OWNER, 'workspace-balserve', 'AGENTS.md'),
  join(openclaw, 'tenants', OWNER, 'workspace-balserve', 'ORG.md'),
  join(openclaw, 'workspace-balserve', 'AGENTS.md'),
  join(uiRoot, 'AGENTS.md'),
  join(uiRoot, 'ORG.md'),
];

for (const p of paths) {
  if (!existsSync(p)) {
    console.log('MISSING', p);
    continue;
  }
  const t = readFileSync(p, 'utf8');
  const has = /External \/ A2A|a2a:|ext:/.test(t);
  console.log((has ? 'HAS_LEAF' : 'NO_LEAF '), p, 'bytes=' + t.length);
  if (has) {
    console.log(
      t
        .split(/\r?\n/)
        .filter((l) => /External \/ A2A|Member key|a2a:|ext:/.test(l))
        .join('\n')
    );
  }
}

const ctx = buildOrgContextForCeo(OWNER);
console.log('\nbuildCooAgentsMd leaf?', buildCooAgentsMd(ctx).includes('External / A2A'));
console.log('formatOrgMd leaf?', formatOrgMd(ctx).includes('External / A2A'));
console.log('readCooAgentsMdForCeo leaf?', (await readCooAgentsMdForCeo(OWNER)).includes('External / A2A'));
