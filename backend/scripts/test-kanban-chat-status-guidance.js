/**
 * Unit tests for Kanban reopen / awaiting-confirmation chat guidance.
 * Usage: node scripts/test-kanban-chat-status-guidance.js
 */
import assert from 'assert';
import { buildKanbanChatStatusGuidance } from '../src/services/kanban-chat-status.js';

{
  const g = buildKanbanChatStatusGuidance(42, 'open');
  assert.strictEqual(g.promoteOnReply, true);
  assert.ok(g.instructions.includes('in_progress'));
  assert.ok(g.finishBlock.includes('completed'));
  console.log('PASS open → promote + finish');
}

{
  const g = buildKanbanChatStatusGuidance(42, 'in_progress');
  assert.strictEqual(g.promoteOnReply, false);
  assert.strictEqual(g.instructions, '');
  assert.ok(g.finishBlock.includes('completed'));
  console.log('PASS in_progress → finish only');
}

{
  const g = buildKanbanChatStatusGuidance(42, 'awaiting_confirmation');
  assert.strictEqual(g.awaitingUser, true);
  assert.strictEqual(g.promoteOnReply, false);
  assert.strictEqual(g.instructions, '');
  assert.ok(/awaiting user confirmation/i.test(g.finishBlock));
  assert.ok(!/new_status": "in_progress"/.test(g.instructions + g.finishBlock));
  console.log('PASS awaiting_confirmation → wait (no promote)');
}

{
  const g = buildKanbanChatStatusGuidance(7, 'completed');
  assert.strictEqual(g.promoteOnReply, false);
  assert.strictEqual(g.instructions, '');
  assert.strictEqual(g.finishBlock, '');
  console.log('PASS completed → no guidance');
}

console.log('KANBAN_CHAT_STATUS_GUIDANCE_OK');
