/**
 * Unit tests for Kanban reopen / awaiting-confirmation / complete-on-reply guidance.
 * Usage: node scripts/test-kanban-chat-status-guidance.js
 */
import assert from 'assert';
import {
  buildKanbanChatStatusGuidance,
  looksLikeClosedFollowUp,
  looksLikeLongRunningWork,
} from '../src/services/kanban-chat-status.js';

{
  const g = buildKanbanChatStatusGuidance(42, 'open', { userText: 'what model are you using?' });
  assert.strictEqual(g.promoteOnReply, true);
  assert.strictEqual(g.completeOnReply, true);
  assert.ok(g.instructions.includes('in_progress'));
  assert.ok(g.finishBlock.includes('completed'));
  console.log('PASS open Q&A → promote + complete');
}

{
  const g = buildKanbanChatStatusGuidance(42, 'in_progress', { userText: 'what model you are using?' });
  assert.strictEqual(g.promoteOnReply, false);
  assert.strictEqual(g.completeOnReply, true);
  console.log('PASS in_progress Q&A → complete');
}

{
  const g = buildKanbanChatStatusGuidance(42, 'open', {
    userText: 'Please research and compare all DeepSeek V4 options and draft a detailed report',
  });
  assert.strictEqual(g.promoteOnReply, true);
  assert.strictEqual(g.completeOnReply, false);
  assert.ok(looksLikeLongRunningWork('Please research and compare all options and draft a detailed report'));
  assert.ok(looksLikeLongRunningWork('do a deep space research'));
  console.log('PASS research deliverable → promote only, NO auto-complete');
}

{
  const g = buildKanbanChatStatusGuidance(42, 'open', {
    userText: 'Keep working on the auth regression across tenants — I will come back later',
  });
  assert.strictEqual(g.promoteOnReply, true);
  assert.strictEqual(g.completeOnReply, false);
  assert.ok(looksLikeLongRunningWork('Keep working on the auth regression across tenants'));
  console.log('PASS explicit continue → promote only, no auto-complete');
}

{
  const g = buildKanbanChatStatusGuidance(42, 'awaiting_confirmation', { userText: 'ok?' });
  assert.strictEqual(g.awaitingUser, false);
  assert.strictEqual(g.promoteOnReply, true);
  assert.strictEqual(g.completeOnReply, true);
  assert.ok(g.instructions.includes('Resume this same task'));
  console.log('PASS awaiting_confirmation + user reply → resume same task');
}

{
  assert.ok(looksLikeClosedFollowUp('just tell me what model in use'));
  assert.ok(!looksLikeClosedFollowUp('Investigate the full auth regression across tenants and implement a fix'));
  console.log('PASS heuristics');
}

{
  // Regression: short CEO nudge on a research/RAG card must NOT auto-complete.
  const g = buildKanbanChatStatusGuidance(99, 'in_progress', {
    userText: 'please answer',
    title: 'is the platform RAG embedding or keyword based?',
    description: 'owner_user_id: ceo-bala',
  });
  assert.strictEqual(g.completeOnReply, false);
  assert.strictEqual(g.expectsDeliverable, true);
  console.log('PASS short nudge on RAG card → no auto-complete');
}

console.log('KANBAN_CHAT_STATUS_GUIDANCE_OK');
