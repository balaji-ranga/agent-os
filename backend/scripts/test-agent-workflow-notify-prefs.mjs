/**
 * Unit checks for agent_workflow_notify_prefs matching (no DB).
 * Run: node backend/scripts/test-agent-workflow-notify-prefs.mjs
 */
import { matchWorkflowPattern } from '../src/services/agent-workflow-notify-prefs.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(matchWorkflowPattern('video-reasoning-ceo-bala', 'video-reasoning-ceo-bala'), 'exact');
assert(matchWorkflowPattern('video-reasoning*', 'video-reasoning-ceo-bala'), 'glob prefix');
assert(matchWorkflowPattern('video-*', 'video-media-ceo-bala'), 'video-*');
assert(matchWorkflowPattern('storyboard', 'Video: Story → Cast (storyboard)'), 'substring name');
assert(!matchWorkflowPattern('video-reasoning*', 'crm-mc-ceo-bala'), 'no crm');
assert(matchWorkflowPattern('*', 'anything'), 'star all');
assert(!matchWorkflowPattern('', 'x'), 'empty pattern');

console.log('OK agent-workflow-notify-prefs match patterns');
