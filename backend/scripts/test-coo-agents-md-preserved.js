/**
 * Regression check: the COO's org-generated AGENTS.md must survive tenant workspace doc sync.
 *
 * ensureTenantOpenClawAgent() refreshes product docs from openclaw-workspace-templates on every
 * chat. The balserve template carries a fixed internal-agent table and no external/A2A leaf
 * members, so copying it over the generated file used to wipe every leaf delegation target — the
 * intent classifier then saw no `ext:` / `a2a:` keys and the COO answered specialist work itself.
 *
 * Usage: node backend/scripts/test-coo-agents-md-preserved.js
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { buildCooAgentsMd, isGeneratedCooAgentsMd } from '../src/services/org-context.js';
import { syncEssentialWorkspaceDocs } from '../src/services/openclaw-tenant.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_AGENTS_MD = join(__dirname, '..', '..', 'openclaw-workspace-templates', 'balserve', 'AGENTS.md');

const LEAF_KEY = 'ext:test-ops-echo';

let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

function fakeOrgContext() {
  return {
    ceo: { id: 'test-ceo', name: 'Test CEO', email: 'ceo@example.com' },
    coo_id: 'balserve',
    coo_name: 'BalServe',
    agents: [],
    departments: [],
    delegatees: [{ id: 'techresearcher', name: 'TechResearcher', role: 'Research', department: 'R&D' }],
    leaf_members: [
      {
        id: LEAF_KEY,
        display_name: 'Ops Echo Service',
        kind: 'external',
        department: 'Operations',
        purpose: 'Operations status desk: acknowledges a request and returns a status line.',
        parent_id: 'balserve',
      },
    ],
  };
}

async function main() {
  console.log('== COO AGENTS.md preserved across template sync ==');

  const generated = buildCooAgentsMd(fakeOrgContext());
  check('generated COO AGENTS.md is marked as generated', isGeneratedCooAgentsMd(generated));
  check('generated COO AGENTS.md lists the leaf member key', generated.includes(LEAF_KEY));

  const template = readFileSync(TEMPLATE_AGENTS_MD, 'utf8');
  check('static template is not marked as generated', !isGeneratedCooAgentsMd(template));

  const ws = mkdtempSync(join(tmpdir(), 'agent-os-coo-ws-'));
  try {
    const agentsPath = join(ws, 'AGENTS.md');

    writeFileSync(agentsPath, generated, 'utf8');
    syncEssentialWorkspaceDocs('balserve', ws);
    const afterSync = readFileSync(agentsPath, 'utf8');
    check('template sync keeps the generated AGENTS.md byte-identical', afterSync === generated);
    check('leaf member key survives template sync', afterSync.includes(LEAF_KEY));
    check('template sync still refreshes other product docs', existsSync(join(ws, 'TOOLS.md')));

    // A workspace that never had an org sync must still get the product template.
    rmSync(agentsPath, { force: true });
    syncEssentialWorkspaceDocs('balserve', ws);
    check('fresh workspace still receives the template AGENTS.md', existsSync(agentsPath));

    // A stale template copy is replaceable (the read path regenerates it from the live org).
    writeFileSync(agentsPath, template, 'utf8');
    check('stale template copy is detectable as not generated', !isGeneratedCooAgentsMd(readFileSync(agentsPath, 'utf8')));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('test failed:', e);
  process.exit(1);
});
