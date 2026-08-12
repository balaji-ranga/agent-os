/**
 * Verify Content Orchestrator can call agent_workflow_list (owner-scoped).
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';

initDb();
const owner = String(process.env.OWNER_USER_ID || 'ceo-bala').trim();
const base = String(process.env.BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');

const orch =
  getDb()
    .prepare(
      `SELECT a.id FROM agents a
       JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND COALESCE(ua.enabled,1)=1
       WHERE a.id LIKE 'video-orch-%' OR lower(a.name) = 'content orchestrator'
       LIMIT 1`
    )
    .get(owner)?.id || null;

if (!orch) {
  console.error(JSON.stringify({ ok: false, error: 'Content Orchestrator not found', owner }));
  process.exit(1);
}

const grants = getDb()
  .prepare(
    `SELECT tool_name FROM agent_tool_grants WHERE agent_id = ? AND tool_name LIKE 'agent_workflow%' ORDER BY 1`
  )
  .all(orch)
  .map((r) => r.tool_name);

const { token } = createSession(owner, { userAgent: 'verify-video-orch-workflow-tools' });
const res = await fetch(`${base}/api/tools/agent-workflow-list`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-openclaw-agent-id': orch,
  },
  body: JSON.stringify({}),
});
const body = await res.json().catch(() => ({}));
const out = {
  ok: res.status === 200 && !body?.error,
  status: res.status,
  owner,
  orchestrator: orch,
  grants,
  workflows_count: Array.isArray(body?.workflows) ? body.workflows.length : body?.count ?? null,
  error: body?.error || null,
  sample: (body?.workflows || body?.items || []).slice(0, 5).map((w) => ({
    id: w.id || w.workflow_id,
    name: w.name,
    phrase: w.chat_trigger_phrase || w.phrase,
  })),
};
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exit(1);
