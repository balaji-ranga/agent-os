/**
 * Smoke test: notify_ceo content tool (user-scoped in-app notification).
 * Usage: node scripts/test-notify-ceo-tool.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { seedNotifyCeoToolIfMissing } from '../src/db/seed-content-tools-meta.js';
import { grantNotifyCeoToAllAgents } from '../src/services/agent-feedback.js';
import { executeNotifyCeo } from '../src/services/notify-ceo.js';
import { listNotificationsForUser } from '../src/services/platform-notifications.js';
import { bodyWithoutSpoofedOwner } from '../src/services/tool-owner-scope.js';

initDb();
seedNotifyCeoToolIfMissing();
grantNotifyCeoToAllAgents();

const meta = getDb().prepare(`SELECT name, endpoint, enabled FROM content_tools_meta WHERE name = 'notify_ceo'`).get();
if (!meta) throw new Error('notify_ceo not in content_tools_meta');
console.log('OK: content_tools_meta', meta);

const grants = getDb().prepare(`SELECT COUNT(*) AS n FROM agent_tool_grants WHERE tool_name = 'notify_ceo'`).get().n;
if (!grants) throw new Error('notify_ceo not granted to any agents');
console.log('OK: agent_tool_grants count', grants);

const stripped = bodyWithoutSpoofedOwner({
  title: 't',
  user_id: 'spoof',
  ceo_user_id: 'spoof-ceo',
  owner_user_id: 'spoof-owner',
});
if (stripped.user_id || stripped.ceo_user_id || stripped.owner_user_id) {
  throw new Error('bodyWithoutSpoofedOwner failed to strip target user fields');
}
console.log('OK: spoofed user fields stripped');

const missing = executeNotifyCeo({ body: 'no title' }, { ownerUserId: 'ceo-test' });
if (missing.sent || !missing.error) throw new Error('expected title required error');
console.log('OK: title required');

const noOwner = executeNotifyCeo({ title: 'Hi' }, {});
if (noOwner.sent || !noOwner.error) throw new Error('expected owner resolve error');
console.log('OK: owner required');

const ceo =
  getDb().prepare(`SELECT id, name FROM platform_users WHERE role = 'ceo' ORDER BY id LIMIT 1`).get() ||
  getDb().prepare(`SELECT id, name FROM platform_users ORDER BY id LIMIT 1`).get();
if (!ceo) throw new Error('no platform_users row for smoke test');

const sourceKey = `notify-ceo-smoke:${Date.now()}`;
const out = executeNotifyCeo(
  {
    title: 'notify_ceo smoke test',
    body: 'Agent needs CEO attention.',
    link_url: '/kanban',
    source_key: sourceKey,
  },
  { ownerUserId: ceo.id, callerAgentId: 'balserve', callerAgentName: 'BalServe COO' }
);
if (!out.sent) throw new Error(`notify failed: ${out.error || JSON.stringify(out)}`);
if (out.notified_user_id !== ceo.id) throw new Error('notified wrong user');
console.log('OK: notification created', out);

const listed = listNotificationsForUser(ceo.id, { limit: 20 });
const hit = listed.find((n) => n.source_key === sourceKey || n.title === 'notify_ceo smoke test');
if (!hit) throw new Error('notification not listed for CEO user');
if (!hit.created_by_is_agent && hit.source !== 'agent_notify') {
  throw new Error('expected agent_notify / agent sender flags');
}
console.log('OK: listed for CEO', { id: hit.id, created_by_name: hit.created_by_name, source: hit.source });

const other =
  getDb()
    .prepare(`SELECT id FROM platform_users WHERE id != ? ORDER BY id LIMIT 1`)
    .get(ceo.id);
if (other) {
  const otherList = listNotificationsForUser(other.id, { limit: 50 });
  const leak = otherList.find((n) => n.source_key === sourceKey);
  if (leak) throw new Error('notification leaked to another user');
  console.log('OK: not visible to other user', other.id);
}

console.log('\nALL notify_ceo TESTS PASSED');
