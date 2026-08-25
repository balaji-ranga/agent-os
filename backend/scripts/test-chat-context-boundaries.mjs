import assert from 'node:assert/strict';
import { enrichTaskQueryWithPriorThread } from '../src/services/delegation-queue.js';
import {
  DASHBOARD_CONTEXT_INSTRUCTION,
  dashboardGatewaySessionUser,
} from '../src/services/dashboard-chat-context.js';
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
