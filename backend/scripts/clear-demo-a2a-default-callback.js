/**
 * Clear default callback on demo async agent + empty mock inbox.
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { publishWorkflowAsA2A, getPublicationById } from '../src/services/workflow-a2a-publish.js';

initDb();

const PUBLISH_ID = process.env.PUBLISH_ID || 'wf-a2a-async-callback-demo-agent-6a74bd';
const WORKFLOW_ID = process.env.WORKFLOW_ID || 'wf-async-a2a-callback-demo';
const owner =
  getDb().prepare(`SELECT id FROM platform_users WHERE id = 'ceo-bala' LIMIT 1`).get()?.id ||
  'ceo-bala';

const pub = publishWorkflowAsA2A(
  owner,
  WORKFLOW_ID,
  {
    publish_id: PUBLISH_ID,
    name: 'Async Callback Demo Agent',
    description: 'Public async A2A — per-request callback test (no default callback)',
    invoke_mode: 'async',
    auth_mode: 'public',
    skill_id: 'default',
    callback_url: null,
    metadata: { tags: ['async', 'per-request-callback', 'demo'], version: '1.0.1' },
  },
  { id: owner, name: 'Balaji' }
);

const { token } = createSession(owner, { userAgent: 'clear-default-callback' });
await fetch('http://127.0.0.1:3001/api/a2a-callback-inbox', {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${token}` },
});

const again = getPublicationById(PUBLISH_ID);
console.log(
  JSON.stringify({
    publish_id: PUBLISH_ID,
    callback_url: again?.callback_url ?? null,
    pushNotifications: again?.agent_card?.capabilities?.pushNotifications ?? null,
  })
);
