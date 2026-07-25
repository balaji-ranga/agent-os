/**
 * VPS / local smoke for A2A private visibility.
 *
 * 1. Publish a workflow as A2A with visibility=private
 * 2. Public card / invoke must be denied
 * 3. Owner bypass still works (not IP-denied)
 * 4. Org leaf: COO/parent can invoke; a non-parent peer cannot
 * 5. Flip back to public and confirm IP check passes under allow_all
 *
 * Usage:
 *   node backend/scripts/test-a2a-private-visibility.js
 */
import { getDb, initDb } from '../src/db/schema.js';
import {
  handleA2AJsonRpc,
  publishWorkflowAsA2A,
  unpublishA2APublicationById,
} from '../src/services/workflow-a2a-publish.js';
import { setA2AAccessPolicy, setA2AVisibility, checkA2AClientIp } from '../src/services/workflow-a2a-access.js';
import { upsertOrgAgentMember, deleteOrgAgentMember } from '../src/services/org-agent-members.js';
import {
  canCallerInvokeOrgMember,
  delegateToOrgMembers,
} from '../src/services/org-member-delegation.js';

const OWNER = '__e2e_a2a_private_owner__';
const PARENT = '__e2e_a2a_private_parent__';
const OTHER = '__e2e_a2a_private_other__';
const WF_ID = '__e2e_a2a_private_wf__';

let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

function cleanup(db, publishId) {
  if (publishId) {
    try {
      deleteOrgAgentMember(OWNER, `a2a:${publishId}`);
    } catch {
      /* not placed */
    }
    try {
      unpublishA2APublicationById(OWNER, publishId, { id: OWNER, name: 'e2e' });
    } catch {
      /* already gone */
    }
  }
  db.prepare('DELETE FROM org_member_invocations WHERE owner_user_id = ?').run(OWNER);
  db.prepare('DELETE FROM org_agent_members WHERE owner_user_id = ?').run(OWNER);
  db.prepare('DELETE FROM token_usage WHERE owner_user_id = ?').run(OWNER);
  db.prepare('DELETE FROM agent_ops_budgets WHERE owner_user_id = ?').run(OWNER);
  db.prepare('DELETE FROM kanban_tasks WHERE owner_user_id = ? OR assigned_agent_id IN (?, ?)').run(
    OWNER,
    PARENT,
    OTHER
  );
  db.prepare('DELETE FROM workflow_a2a_publications WHERE owner_user_id = ?').run(OWNER);
  // audit/runs lack ON DELETE CASCADE — must clear before dropping the definition
  db.prepare(
    `DELETE FROM agent_workflow_run_steps WHERE run_id IN (
       SELECT id FROM agent_workflow_runs WHERE definition_id = ? OR owner_user_id = ?
     )`
  ).run(WF_ID, OWNER);
  db.prepare('DELETE FROM agent_workflow_runs WHERE definition_id = ? OR owner_user_id = ?').run(
    WF_ID,
    OWNER
  );
  db.prepare('DELETE FROM agent_workflow_audit WHERE definition_id = ?').run(WF_ID);
  db.prepare('DELETE FROM agent_workflow_definitions WHERE id = ? OR owner_user_id = ?').run(
    WF_ID,
    OWNER
  );
  db.prepare('DELETE FROM user_agents WHERE user_id = ? OR agent_id IN (?, ?)').run(
    OWNER,
    PARENT,
    OTHER
  );
  db.prepare('DELETE FROM agents WHERE id IN (?, ?)').run(PARENT, OTHER);
  db.prepare('DELETE FROM platform_sessions WHERE user_id = ?').run(OWNER);
  db.prepare('DELETE FROM platform_user_notifications WHERE user_id = ?').run(OWNER);
  db.prepare('DELETE FROM platform_users WHERE id = ?').run(OWNER);
}

function seedWorkflow(db) {
  const now = new Date().toISOString();
  const graph = JSON.stringify({
    nodes: [
      { id: 't1', type: 'trigger', data: {} },
      { id: 'o1', type: 'output', data: { text: 'private-ok' } },
    ],
    edges: [{ id: 'e1', source: 't1', target: 'o1' }],
  });
  db.prepare(
    `INSERT OR REPLACE INTO agent_workflow_definitions
       (id, owner_user_id, name, description, status, draft_graph_json, published_graph_json, created_at, updated_at)
     VALUES (?, ?, 'Private A2A E2E', 'e2e', 'published', ?, ?, ?, ?)`
  ).run(WF_ID, OWNER, graph, graph, now, now);
}

async function main() {
  initDb();
  const db = getDb();
  let publishId = null;

  try {
    cleanup(db, null);
    db.prepare(
      `INSERT INTO platform_users (id, email, password_hash, name, role)
       VALUES (?, ?, 'x', 'E2E Private A2A CEO', 'ceo')`
    ).run(OWNER, `${OWNER}@example.test`);
    db.prepare(
      `INSERT OR REPLACE INTO agents (id, name, role, department, is_coo) VALUES (?, 'Parent Lead', 'Lead', 'Research', 0)`
    ).run(PARENT);
    db.prepare(
      `INSERT OR REPLACE INTO agents (id, name, role, department, is_coo) VALUES (?, 'Other Agent', 'Peer', 'Research', 0)`
    ).run(OTHER);
    db.prepare(`INSERT OR REPLACE INTO user_agents (user_id, agent_id, enabled) VALUES (?, ?, 1)`).run(
      OWNER,
      PARENT
    );
    db.prepare(`INSERT OR REPLACE INTO user_agents (user_id, agent_id, enabled) VALUES (?, ?, 1)`).run(
      OWNER,
      OTHER
    );
    seedWorkflow(db);

    const pub = publishWorkflowAsA2A(
      OWNER,
      WF_ID,
      {
        name: `Private E2E ${Date.now()}`,
        description: 'Private A2A smoke',
        auth_mode: 'public',
        visibility: 'private',
        as_new_agent: true,
      },
      { id: OWNER, name: 'e2e' }
    );
    publishId = pub.id;
    check('published with visibility=private', pub.visibility === 'private', pub.visibility);
    setA2AAccessPolicy(publishId, OWNER, 'allow_all'); // would be open if not private

    const row = db.prepare(`SELECT * FROM workflow_a2a_publications WHERE id = ?`).get(publishId);
    const ip = checkA2AClientIp(row, '203.0.113.10');
    check('public IP check denied for private', ip.ok === false && ip.policy === 'private', ip.reason);

    const publicInvoke = await handleA2AJsonRpc(
      publishId,
      {
        jsonrpc: '2.0',
        id: '1',
        method: 'message/send',
        params: { message: { role: 'user', messageId: 'm1', parts: [{ kind: 'text', text: 'hi' }] } },
      },
      { clientIp: '203.0.113.10', bypassAccessChecks: false }
    );
    check(
      'public JSON-RPC invoke denied',
      !!publicInvoke.error && publicInvoke.error.code === -32005,
      publicInvoke.error?.message
    );

    const ownerBypass = await handleA2AJsonRpc(
      publishId,
      {
        jsonrpc: '2.0',
        id: '2',
        method: 'message/send',
        params: { message: { role: 'user', messageId: 'm2', parts: [{ kind: 'text', text: 'hi' }] } },
      },
      { clientIp: '127.0.0.1', bypassAccessChecks: true }
    );
    // Workflow may fail for missing runner deps — ACL/bypass only cares that it is not IP-denied.
    check(
      'owner bypass is not IP-denied',
      !ownerBypass.error || ownerBypass.error.code !== -32005,
      ownerBypass.error?.message || 'ok'
    );

    const member = upsertOrgAgentMember(OWNER, {
      kind: 'a2a_publish',
      ref_id: publishId,
      display_name: 'Private Leaf',
      purpose: 'Private leaf for e2e',
      department: 'Research',
      parent_id: PARENT,
    });
    check('leaf member created under parent', member?.parent_id === PARENT, member?.id);

    const cooOk = canCallerInvokeOrgMember(OWNER, member, null);
    check('COO (implicit) may invoke private leaf', cooOk.ok === true);

    const parentOk = canCallerInvokeOrgMember(OWNER, member, PARENT);
    check('reports-to parent may invoke private leaf', parentOk.ok === true);

    const otherDenied = canCallerInvokeOrgMember(OWNER, member, OTHER);
    check('non-parent peer cannot invoke private leaf', otherDenied.ok === false, otherDenied.reason);

    const peerAttempt = await delegateToOrgMembers(
      OWNER,
      { [member.id]: 'Peer should not reach this.' },
      { callerAgentId: OTHER }
    );
    check(
      'delegateToOrgMembers blocks non-parent caller',
      peerAttempt.blocked.length === 1 && peerAttempt.delegated.length === 0,
      peerAttempt.blocked[0]?.reasons?.[0]
    );

    const parentAttempt = await delegateToOrgMembers(
      OWNER,
      { [member.id]: 'Parent lead may call.' },
      { callerAgentId: PARENT }
    );
    // May fail workflow execution, but must not be ACL-blocked.
    check(
      'parent lead is not ACL-blocked',
      parentAttempt.blocked.every((b) => b.code !== 'private_acl'),
      `blocked=${parentAttempt.blocked.length} failed=${parentAttempt.failed.length} delegated=${parentAttempt.delegated.length}`
    );

    setA2AVisibility(publishId, OWNER, 'public');
    const after = db.prepare(`SELECT * FROM workflow_a2a_publications WHERE id = ?`).get(publishId);
    const ipPublic = checkA2AClientIp(after, '203.0.113.10');
    check(
      'after flip to public + allow_all, IP check passes',
      ipPublic.ok === true,
      JSON.stringify(ipPublic)
    );
  } finally {
    cleanup(db, publishId);
  }

  console.log(failures ? `[e2e] ${failures} FAILURE(S)` : '[e2e] PASS');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('[e2e] error:', e);
  process.exit(1);
});
