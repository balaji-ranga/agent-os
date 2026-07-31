/**
 * Smoke tests for Kanban watch helpers (no DB / gateway).
 * Run: node backend/scripts/test-kanban-watch-helpers.js
 */
import {
  buildKanbanWatchNotifyText,
  cronJobMentionsTask,
} from '../src/services/kanban-watch.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const notify = buildKanbanWatchNotifyText(
  { id: 4126, title: 'Platform Help 3D', status: 'completed' },
  'Formats documented.'
);
assert(notify.includes('#4126'), 'notify includes task id');
assert(notify.includes('completed'), 'notify includes status');
assert(notify.includes('Formats documented'), 'notify includes note');

assert(
  cronJobMentionsTask({ name: 'Monitor Platform Help 3D formats task #4126' }, 4126),
  'name #id match'
);
assert(
  cronJobMentionsTask(
    { payload: { kind: 'agentTurn', message: 'call kanban_watch_tick with {"task_id":4126}' } },
    4126
  ),
  'payload task_id match'
);
assert(!cronJobMentionsTask({ name: 'Watch Kanban #99' }, 4126), 'other task no match');

console.log('kanban-watch helpers OK');
