import assert from 'node:assert/strict';
import {
  beginChatActivity,
  updateChatActivity,
  finishChatActivity,
  getChatActivity,
  clearChatActivitiesForTests,
} from '../src/services/chat-live-activity.js';

clearChatActivitiesForTests();
const scope = { ownerUserId: 'ceo-a', agentId: 'coo', turnId: 'turn-12345678' };
assert.equal(beginChatActivity(scope).current.label, 'Understanding request');
updateChatActivity(scope, { phase: 'maker', label: 'Building executable plan', detail: 'Maker round 1 of 3' });
updateChatActivity(scope, { phase: 'checker', label: 'Validating plan independently' });
const visible = getChatActivity(scope);
assert.equal(visible.status, 'running');
assert.equal(visible.current.phase, 'checker');
assert.equal(visible.events.at(-2).status, 'completed');
assert.equal(getChatActivity({ ...scope, ownerUserId: 'ceo-b' }), null, 'activity is owner scoped');
finishChatActivity(scope);
assert.equal(getChatActivity(scope).status, 'completed');
assert.equal(getChatActivity(scope).current.label, 'Response ready');
assert.equal(beginChatActivity({ ...scope, turnId: '../invalid' }), null, 'unsafe turn ids are rejected');

console.log('chat live activity tests: PASS');
