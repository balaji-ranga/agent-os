import assert from 'node:assert/strict';
import { getDb } from '../src/db/schema.js';
import { enrichTaskQueryWithPriorThread } from '../src/services/delegation-queue.js';
import {
  DASHBOARD_CONTEXT_INSTRUCTION,
  dashboardGatewaySessionUser,
} from '../src/services/dashboard-chat-context.js';
import { bindWorkUnitExecution, routeAgentTurn, validateRouteDecision } from '../src/services/agent-turn-router.js';
import { isPromptAuthoringAskForAgent } from '../src/services/specialty-referral.js';

const polluted = [
  'Open LinkedIn in my Chrome and summarize the last two days.',
  'Navigate to the Flolah weekly digest and capture a screenshot.',
  'Create a CRM lead-generation prompt using web search and CRM lead creation.',
];

assert.equal(
  enrichTaskQueryWithPriorThread(
    'Generate the requested prompt.',
    polluted,
    'Create a CRM lead-generation prompt using web search and CRM lead creation.'
  ),
  'Create a CRM lead-generation prompt using web search and CRM lead creation.',
  'substantive current ask must be the handoff boundary'
);

const referential = enrichTaskQueryWithPriorThread(
  'Delegate that to Prompt Agent.',
  polluted,
  'Delegate that to Prompt Agent.'
);
assert.match(referential, /CRM lead-generation prompt/);
assert.doesNotMatch(referential, /Open LinkedIn/);
assert.match(referential, /weekly digest/);

const stableThread = 'thread-123';
const first = dashboardGatewaySessionUser('balserve', 'ceo-bala', stableThread, 'request-a');
const second = dashboardGatewaySessionUser('balserve', 'ceo-bala', stableThread, 'request-b');
assert.notEqual(first, second, 'each Dashboard request must have an isolated gateway session');
assert.match(DASHBOARD_CONTEXT_INSTRUCTION, /final user message as the current ask/i);
assert.match(DASHBOARD_CONTEXT_INSTRUCTION, /Do not call sessions_history/i);

const staleDashboardHistory = [
  { id: 901, role: 'user', content: 'Open the weekly digest in Chrome.', work_unit_id: 'wu-old' },
  { id: 902, role: 'assistant', content: 'The browser task failed.', work_unit_id: 'wu-old' },
];
assert.equal(validateRouteDecision(null, []).ok, false, 'non-object router output is rejected');
assert.equal(validateRouteDecision({ execution_mode: 'chat' }, []).ok, false, 'partial router output is rejected');
assert.equal(validateRouteDecision({
  relation: 'new_work', execution_mode: 'chat', relevant_turn_ids: [], resolved_request: 'test', restart_requested: false, confidence: 0,
}, []).ok, true, 'zero confidence is syntactically valid so the runtime can explicitly trigger repair');
assert.equal(validateRouteDecision({
  relation: 'new_work', execution_mode: 'goal_plan', relevant_turn_ids: [999], resolved_request: 'test', restart_requested: false, confidence: 0.9,
}, [901]).ok, false, 'unknown history IDs are rejected');
const routeBase = {
  ownerUserId: `router-test-${Date.now()}`,
  agent: { id: 'test-agent', name: 'Test Agent', role: 'Tester', is_coo: 0 },
  sessionId: `session-${Date.now()}`,
  history: staleDashboardHistory,
};
const cleanupRouterRows = () => {
  try { getDb().prepare('DELETE FROM chat_work_units WHERE owner_user_id=?').run(routeBase.ownerUserId); } catch (_) {}
};
process.on('exit', cleanupRouterRows);
const conversation = await routeAgentTurn({
  ...routeBase,
  message: 'A fresh greeting',
  semanticDecision: { relation: 'conversation', execution_mode: 'chat', relevant_turn_ids: [901, 902], resolved_request: 'A fresh greeting' },
});
assert.equal(conversation.selected_turns.length, 0, 'conversation mode receives no stale execution history');

const goal = await routeAgentTurn({
  ...routeBase,
  message: 'A complete multi-stage specification containing ordinary pronouns.',
  semanticDecision: { relation: 'new_work', execution_mode: 'goal_plan', relevant_turn_ids: [901], resolved_request: 'Complete multi-stage specification.' },
});
assert.equal(goal.execution_mode, 'goal_plan');
assert.equal(goal.selected_turns.length, 0, 'new goal is isolated even when prose contains pronouns');

bindWorkUnitExecution(goal.id, 'goal-test-terminal', 'completed');
const terminalHistory = [
  { id: 903, role: 'user', content: 'Run a completed plan.', work_unit_id: goal.id },
  { id: 904, role: 'assistant', content: 'The plan completed.', work_unit_id: goal.id },
];
const statusOnly = await routeAgentTurn({
  ...routeBase,
  history: terminalHistory,
  message: 'Give me its status.',
  semanticDecision: { relation: 'follow_up', execution_mode: 'direct_tool', relevant_turn_ids: [903, 904], resolved_request: 'Report the completed plan status.', restart_requested: false },
});
assert.equal(statusOnly.execution_mode, 'chat', 'terminal work cannot be relaunched by a status-only follow-up');
assert.equal(statusOnly.terminal_parent_guarded, true);

const explicitRetry = await routeAgentTurn({
  ...routeBase,
  history: terminalHistory,
  message: 'Retry that completed plan.',
  semanticDecision: { relation: 'follow_up', execution_mode: 'goal_plan', relevant_turn_ids: [903, 904], resolved_request: 'Retry the completed plan.', restart_requested: true },
});
assert.equal(explicitRetry.execution_mode, 'goal_plan', 'semantic explicit retry may relaunch terminal work');
assert.equal(explicitRetry.restart_requested, true);

const followUp = await routeAgentTurn({
  ...routeBase,
  message: 'Retry the prior work unit.',
  semanticDecision: { relation: 'follow_up', execution_mode: 'direct_tool', relevant_turn_ids: [901, 902], resolved_request: 'Retry the prior digest work.' },
});
assert.deepEqual(followUp.relevant_turn_ids, [901, 902]);
assert.equal(followUp.parent_work_unit_id, 'wu-old');

const correction = await routeAgentTurn({
  ...routeBase,
  message: 'Correct the prior result.',
  semanticDecision: { relation: 'correction', execution_mode: 'chat', relevant_turn_ids: [902], resolved_request: 'Correct the prior digest result.' },
});
assert.deepEqual(correction.relevant_turn_ids, [902]);

for (const executionMode of ['chat', 'direct_tool', 'delegate', 'goal_plan']) {
  const modeRoute = await routeAgentTurn({
    ...routeBase,
    message: `Independent ${executionMode} scenario.`,
    semanticDecision: {
      relation: executionMode === 'chat' ? 'conversation' : 'new_work',
      execution_mode: executionMode,
      relevant_turn_ids: [],
      resolved_request: `Independent ${executionMode} scenario.`,
      restart_requested: false,
      confidence: 1,
    },
  });
  assert.equal(modeRoute.execution_mode, executionMode, `${executionMode} mode is preserved by the shared router`);
  assert.equal(modeRoute.selected_turns.length, 0);
}

assert.equal(
  isPromptAuthoringAskForAgent(
    { id: 'video-prompt-ceobala', name: 'Prompt Agent', role: 'Flow/Veo prompt writer' },
    'Pick a CRM lead generation prompt which includes web search and CRM lead creation.'
  ),
  true,
  'Prompt Agent must own prompt composition regardless of the subject domain'
);
assert.equal(
  isPromptAuthoringAskForAgent(
    { id: 'video-prompt-ceobala', name: 'Prompt Agent', role: 'Flow/Veo prompt writer' },
    'Create fifty leads in CRM now.'
  ),
  false,
  'Prompt Agent must still refer actual CRM execution'
);

console.log('CHAT_CONTEXT_BOUNDARIES_OK');
cleanupRouterRows();
