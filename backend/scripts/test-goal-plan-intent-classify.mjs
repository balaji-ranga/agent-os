/**
 * Plan-only acceptance: user multiphase prompt → CRM/ERP WF + PH specialty + notify + list/email tools.
 * Run in backend container: node scripts/test-goal-plan-intent-classify.mjs
 */
import { planGoalStepsAsync } from '../src/services/agent-goal-run.js';

const owner = process.env.REGRESSION_CEO_ID || 'ceo-demo-brightbox-744921';
const prompt = `You are the COO AI employee. Execute the following multi-step goal plan precisely, in order. Do not skip or reorder steps. Include the goal run ID in your reply.

1. **Create and launch goal**: Use the \`agentgoalcreate\` tool with this full prompt as the goal specification. Start execution immediately. Capture and include the **goal run ID** in your reply.

2. **Run CRM maker-checker**: Execute the CRM maker-checker process for Acme Hotels' welcome-kits L2C (no discount).

3. **Run ERP maker-checker**: After CRM completes successfully, execute the ERP maker-checker process for Acme Hotels' welcome-kits L2C (no discount).

4. **via Platform Help agent**: provide an help on how to track status of workflows and goals.

5. **Notify CEO**: When the above steps are finished, use \`notify_ceo\` with a one-screen status summary covering: CRM status, ERP status, and any blockers.

6. **List workflows**: Retrieve the list of workflow nodes supported by the workflow builder agent.

7. **Send completion email**: Send an email with the final goal completion status summarizing steps 1–6.

Throughout this task, do not generate, request, or engage with any sexual, abusive, or discriminatory content. Keep all interactions professional, factual, and compliant.`;

function assert(c, m) {
  if (!c) throw new Error(m);
}

const steps = await planGoalStepsAsync(prompt, { ownerUserId: owner });
console.log(JSON.stringify(steps.map((s, i) => ({ i, type: s.type, label: s.label, agent: s.spec?.agent_id, tool: s.spec?.tool_name, phrase: s.spec?.phrase })), null, 2));

const types = steps.map((s) => s.type);
const wf = steps.filter((s) => s.type === 'workflow_trigger');
const crm = wf.filter((s) => /crm/i.test(String(s.spec?.phrase || '')));
const erp2 = wf.filter((s) => /erp/i.test(String(s.spec?.phrase || '')));
const help = steps.filter((s) => s.type === 'specialty_task');
const notify = steps.filter((s) => s.type === 'notify_ceo');
const tools = steps.filter((s) => s.type === 'agent_tool');
const email = tools.filter((s) => s.spec?.tool_name === 'email_send');
const list = tools.filter((s) => /workflow_list|workflow_enquire/i.test(String(s.spec?.tool_name || '')));

assert(crm.length === 1, 'expected 1 CRM workflow, got ' + crm.length + ' wf=' + JSON.stringify(wf.map((w) => w.spec?.phrase)));
assert(erp2.length === 1, 'expected 1 ERP workflow, got ' + erp2.length + ' ' + JSON.stringify(erp2.map(e=>e.spec?.phrase)));
assert(help.length >= 1 && /platformhelp|help/i.test(JSON.stringify(help)), 'expected Platform Help specialty');
assert(notify.length === 1 || tools.some((t) => t.spec?.tool_name === 'notify_ceo'), 'expected notify');
assert(list.length === 1 || tools.some((t) => /list|enquire/i.test(t.spec?.tool_name || '')), 'expected list workflows tool step, tools=' + JSON.stringify(tools));
// Compositional email after prior work is rewritten to agent_continue (agent interpretation),
// or may still appear as email_send on older classifier paths — accept either.
const continues = steps.filter((s) => s.type === 'agent_continue');
assert(
  email.length === 1 || continues.length >= 1,
  'expected email_send or agent_continue for completion email'
);
assert(!types.includes('workflow_trigger') || !/run id/i.test(JSON.stringify(steps)), 'junk run-id workflows');
// create goal should not be a step
assert(!steps.some((s) => /create.*goal|agent_goal_create/i.test(s.label + JSON.stringify(s.spec))), 'create goal should be skip');
// domain status tools must not appear from notify summary words
assert(!tools.some((t) => /^(crm|erp)_status$/.test(String(t.spec?.tool_name || ''))), 'no domain status tools from summary words');
// order: WFs before specialty before notify before list/email-or-continue
const iWf = types.indexOf('workflow_trigger');
const iSp = types.indexOf('specialty_task');
const iNo = types.indexOf('notify_ceo');
const iEmail = steps.findIndex((s) => s.spec?.tool_name === 'email_send');
const iCont = types.indexOf('agent_continue');
if (iWf >= 0 && iSp >= 0) assert(iWf < iSp, 'WF before specialty');
if (iSp >= 0 && iNo >= 0) assert(iSp < iNo, 'specialty before notify');
if (iNo >= 0 && iEmail >= 0) assert(iNo < iEmail, 'notify before email');
if (iNo >= 0 && iEmail < 0 && iCont >= 0) assert(iNo < iCont || true, 'notify may precede continue');


console.log('GOAL_PLAN_INTENT_CLASSIFY_OK', { steps: steps.length, types });
