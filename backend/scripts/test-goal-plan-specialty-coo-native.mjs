/**
 * Goal-plan specialty vs COO-native heuristic (no LLM).
 * Run: node scripts/test-goal-plan-specialty-coo-native.mjs
 */
import { isCooNativeWork } from '../src/services/coo-specialty-delegation.js';
import {
  residualIsLetteredOrNumbered,
  residualNamesRosterAgent,
  shouldSkipAllSpecialtyAsCooNative,
} from '../src/services/goal-plan-specialty.js';

const MD = `
| Agent ID | Name | Department | Purpose |
| --- | --- | --- | --- |
| businessdiscovery | Business Discovery | Research | Local business discover research act |
| crm-s1-demo | CRM Maker A | Sales | Create companies people opportunities |
`;

function assert(c, m) {
  if (!c) throw new Error(m);
}

const hybrid = `A) Business Discovery employee: research clinics. Create a Kanban card assigned to CRM Maker A.
B) CRM Maker A employee, only after A: create Company, Person, and Opportunity from that Kanban.`;

assert(isCooNativeWork(hybrid), 'expected kanban token to trip COO-native regex');
assert(residualIsLetteredOrNumbered(hybrid), 'lettered A)/B) should detect');
assert(residualNamesRosterAgent(hybrid, MD), 'roster names should detect');
assert(
  !shouldSkipAllSpecialtyAsCooNative(hybrid, MD),
  'lettered named specialists must not be dropped because residual mentions kanban'
);

const coordOnly = 'List my kanban board and standup status as COO. Resync org.md.';
assert(isCooNativeWork(coordOnly), 'coordination residual is COO-native');
assert(!residualIsLetteredOrNumbered(coordOnly), 'no lettered list');
assert(!residualNamesRosterAgent(coordOnly, MD), 'no roster employee named');
assert(
  shouldSkipAllSpecialtyAsCooNative(coordOnly, MD),
  'pure COO coordination should still skip specialty'
);

console.log('GOAL_PLAN_SPECIALTY_COO_NATIVE_OK');
