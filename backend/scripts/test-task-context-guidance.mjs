import assert from 'node:assert/strict';
import {composeTaskGuidance} from '../../openclaw-extensions/agent-os-content-tools/task-context-guidance.js';
const hints={timezoneHint:'clock',physicalHint:'devices',physicalDiscoveryHint:'device discovery',scheduledHint:'schedules',speechHint:'audio',recoveryHint:'connectors',skillHint:'assigned skill',budgetHint:'budget'};
assert.deepEqual(composeTaskGuidance(hints),{personalContext:'',systemContext:'clock\ndevices\ndevice discovery\nschedules\naudio\nconnectors\nassigned skill\nbudget'});
assert.deepEqual(composeTaskGuidance({...hints,reviewHint:'source contract'}),{personalContext:'',systemContext:'clock\naudio\nconnectors\nassigned skill\nbudget\nsource contract'});
assert.deepEqual(composeTaskGuidance({...hints,statusHint:'status only'}),{personalContext:'status only\nclock',systemContext:'clock\naudio\nassigned skill\nbudget'});
assert.deepEqual(composeTaskGuidance({...hints,speechTurn:'transcribe'}),{personalContext:'transcribe',systemContext:'clock\ndevices\ndevice discovery\nschedules\naudio\nassigned skill\nbudget'});
assert.deepEqual(composeTaskGuidance({}),{personalContext:'',systemContext:''});
console.log('TASK_CONTEXT_GUIDANCE_OK: direct review excludes unrelated tutorials; source contract last; normal device, scheduling, status and speech guidance preserved');

const policy=composeTaskGuidance({...hints,discoveryHint:'search authorized platform'});
assert.equal(policy.personalContext,'','unrelated domain instructions cannot become a user assignment');
assert.match(policy.systemContext,/search authorized platform/);
