/**
 * Unit tests: status-only replies must not auto-complete specialty Kanban cards.
 * Usage: node scripts/test-kanban-status-only-reply.js
 */
import assert from 'assert';
import {
  looksStatusOnlyReply,
  shouldCompleteKanbanForReply,
  taskExpectsRichDeliverable,
  buildDelegationKanbanFinishPrompt,
} from '../src/services/kanban-reply-enrich.js';

{
  assert.ok(
    looksStatusOnlyReply(
      'The task has been successfully marked as completed. If you need anything else or further clarification on this topic, feel free to ask!'
    )
  );
  assert.ok(looksStatusOnlyReply('The Kanban task has been marked as completed. If there\'s anything else you need, feel free to ask!'));
  assert.ok(looksStatusOnlyReply('The task was successfully marked as completed.'));
  assert.ok(!looksStatusOnlyReply(''));
  assert.ok(
    !looksStatusOnlyReply(
      '## Answer\n\nFlolah Master Data RAG is **keyword-based** (chunk RAG over uploaded docs), not embedding retrieval. Use `master_data_rag` with a query string.'
    )
  );
  assert.ok(!shouldCompleteKanbanForReply('The task has been successfully marked as completed.'));
  assert.ok(
    shouldCompleteKanbanForReply(
      'Platform RAG is keyword chunk retrieval via master_data_rag — not vector embeddings.'
    )
  );
  console.log('PASS status-only detection');
}

{
  assert.ok(
    taskExpectsRichDeliverable(
      'is the platform RAG embedding retrieval based or keyword based?',
      '',
      ''
    )
  );
  assert.ok(!taskExpectsRichDeliverable('hi', '', ''));
  console.log('PASS expects deliverable for RAG Q');
}

{
  const p = buildDelegationKanbanFinishPrompt(1637);
  assert.ok(p.includes('1637'));
  assert.ok(/will NOT treat a status-only/i.test(p));
  assert.ok(!/backend also marks/i.test(p));
  console.log('PASS delegation finish prompt no longer claims auto-complete');
}

console.log('KANBAN_STATUS_ONLY_REPLY_OK');
