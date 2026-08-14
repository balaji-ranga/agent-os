/**
 * Refresh live-org roster plus lean Priorities/Tools defaults (AGENT-OS-OPS pointers).
 * Preserves Role, Guardrails, and custom ## sections the CEO edited by hand.
 *
 * Usage: node backend/scripts/test-coo-agents-md-merge.js
 */
import {
  buildCooAgentsMd,
  mergeCooAgentsMd,
  isGeneratedCooAgentsMd,
  COO_AGENTS_MD_MANAGED_HEADINGS,
} from '../src/services/org-context.js';

let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

function fakeCtx(overrides = {}) {
  return {
    ceo: { id: 'ceo-test', name: 'Test CEO', email: 'ceo@example.com' },
    coo_id: 'balserve',
    coo_name: 'BalServe',
    agents: [],
    departments: [],
    delegatees: [
      {
        id: 'techresearcher',
        name: 'TechResearcher',
        role: 'Research',
        department: 'R&D',
        openclaw_agent_id: 'techresearcher',
      },
    ],
    leaf_members: [
      {
        id: 'ext:ops-echo',
        display_name: 'Ops Echo Service',
        kind: 'external',
        department: 'Operations',
        purpose: 'Echo status lines',
        parent_id: 'balserve',
      },
    ],
    ...overrides,
  };
}

const CUSTOM_GUARD =
  '- CUSTOM GUARDRAIL: never invent budget numbers without CEO confirmation.';
const CUSTOM_SECTION = `## My private notes

Keep the Friday ops checklist here — do not wipe on sync.`;

console.log('== COO AGENTS.md merge preserves manual sections ==');

const empty = mergeCooAgentsMd('', fakeCtx());
check('empty file gets a full default build', isGeneratedCooAgentsMd(empty) && empty.includes('## Role'));
check('empty build lists leaf member', empty.includes('ext:ops-echo'));

const customized = `${buildCooAgentsMd(fakeCtx())}

## Guardrails

${CUSTOM_GUARD}

${CUSTOM_SECTION}
`;

// Simulate a hand-edit to Role as well.
const withRoleEdit = customized.replace(
  /## Role\n\n[\s\S]*?\n\n## CEO for this org/,
  '## Role\n\nCUSTOM ROLE: I coordinate only research escalations.\n\n## CEO for this org'
);

const after = mergeCooAgentsMd(withRoleEdit, fakeCtx({
  delegatees: [
    {
      id: 'techresearcher',
      name: 'TechResearcher',
      role: 'Research',
      department: 'R&D',
      openclaw_agent_id: 'techresearcher',
    },
    {
      id: 'socialasstant',
      name: 'SocialAssistant',
      role: 'Social',
      department: 'Social',
      openclaw_agent_id: 'socialasstant',
    },
  ],
}));

check('merge keeps org-sync marker', isGeneratedCooAgentsMd(after));
check('merge keeps custom Role text', after.includes('CUSTOM ROLE: I coordinate only research escalations'));
check('merge keeps custom Guardrails text', after.includes(CUSTOM_GUARD));
check('merge keeps custom ## section', after.includes('Keep the Friday ops checklist here'));
check('merge refreshes agent roster with new agent', after.includes('socialasstant'));
check('merge still lists leaf member', after.includes('ext:ops-echo'));
check('merge still has session keys section', after.includes('## Session keys (sessions_send — required)'));
check('merge refreshes Tools to point at AGENT-OS-OPS', after.includes('AGENT-OS-OPS.md'));

const withoutLeaves = mergeCooAgentsMd(after, fakeCtx({ leaf_members: [] }));
check(
  'merge removes leaf section when org has no leaf members',
  !withoutLeaves.includes('## External / A2A agents you can delegate to (leaf members)')
);
check('merge still keeps custom notes after leaf removal', withoutLeaves.includes('Friday ops checklist'));

for (const h of COO_AGENTS_MD_MANAGED_HEADINGS) {
  if (h.startsWith('External')) continue; // optional when no leaves
  check(`managed heading present: ${h}`, after.includes(`## ${h}`));
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
