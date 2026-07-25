/**
 * Unit checks for Brain-node token attribution (which org member gets billed).
 *
 * A workflow published over A2A is the leaf member doing the work, so an A2A-invoked run must bill
 * the `a2a:<publishId>` leaf instead of an orphan `workflow:<definition_id>` bucket that no Agent
 * View row or budget can ever see.
 *
 * Usage: node backend/scripts/test-brain-token-attribution.js
 */
import { resolveBrainMemberKey } from '../src/services/agent-workflow-brain.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label} — got ${actual}${ok ? '' : `, expected ${expected}`}`);
  if (!ok) failures += 1;
}

const DEF = 'wf-def-123';

check(
  'A2A-invoked run bills the a2a leaf member',
  resolveBrainMemberKey({
    definition_id: DEF,
    actor: { id: 'a2a:wf-a2a-patent-prior-art-checker-6303c2', type: 'a2a_client', name: 'Patent' },
  }),
  'a2a:wf-a2a-patent-prior-art-checker-6303c2'
);

check(
  'COO tool-triggered run bills the calling agent',
  resolveBrainMemberKey({ definition_id: DEF, actor: { id: 'balserve', type: 'coo' } }),
  'balserve'
);

check(
  'agent-triggered run bills that agent',
  resolveBrainMemberKey({ definition_id: DEF, actor: { id: 'resumetailor', type: 'agent' } }),
  'resumetailor'
);

check(
  'workflow builder run bills the builder agent',
  resolveBrainMemberKey({ definition_id: DEF, actor: { id: 'workflowbuilder', type: 'workflow_builder' } }),
  'workflowbuilder'
);

check(
  'explicit context.agent_id wins over actor type',
  resolveBrainMemberKey({ definition_id: DEF, agent_id: 'techresearcher', actor: { id: 'scheduler', type: 'system' } }),
  'techresearcher'
);

check(
  'explicit member_key overrides everything',
  resolveBrainMemberKey({ definition_id: DEF, member_key: 'ext:ops-echo', agent_id: 'techresearcher' }),
  'ext:ops-echo'
);

check(
  'scheduled run falls back to the workflow bucket',
  resolveBrainMemberKey({ definition_id: DEF, actor: { id: 'scheduler', type: 'system' } }),
  `workflow:${DEF}`
);

check(
  'manual CEO run falls back to the workflow bucket',
  resolveBrainMemberKey({ definition_id: DEF, actor: { id: 'ceo-bala', type: 'user' } }),
  `workflow:${DEF}`
);

check('no context at all is still safe', resolveBrainMemberKey({}), 'workflow:unknown');

check(
  'non-a2a actor claiming an a2a id is not trusted as a leaf',
  resolveBrainMemberKey({ definition_id: DEF, actor: { id: 'a2a:spoof', type: 'system' } }),
  `workflow:${DEF}`
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
