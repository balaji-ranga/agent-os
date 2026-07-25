/**
 * End-to-end check for COO delegation to an external org leaf member.
 *
 * Stands up a mock A2A agent on localhost, registers it as an external agent for a throwaway CEO,
 * places it in the org chart, then delegates to it and asserts the Kanban card, invocation record,
 * token ledger entry, Agent View payload, and budget block all behave.
 *
 * Usage: node backend/scripts/test-org-member-delegation-e2e.js
 */
import http from 'http';
import { getDb, initDb } from '../src/db/schema.js';
import { createExternalAgent, discoverExternalAgent } from '../src/services/external-agents.js';
import { upsertOrgAgentMember } from '../src/services/org-agent-members.js';
import { delegateToOrgMembers } from '../src/services/org-member-delegation.js';
import { setAgentBudget } from '../src/services/agent-budgets.js';
import { getMonthlyTokens } from '../src/services/token-usage.js';
import { getAgentEfficiency } from '../src/services/agent-efficiency.js';

const OWNER = '__e2e_org_delegation_owner__';
const PARENT_AGENT = '__e2e_org_delegation_parent__';
// A real deliverable: a status-only sentence would (correctly) leave the card in_progress.
const REPLY =
  'Mock external agent research brief on small language models:\n' +
  '- Phi-3 and Gemma run on a single consumer GPU with 4-bit quantisation.\n' +
  '- Distillation from a larger teacher recovers most reasoning quality.\n' +
  '- Best fit: on-device assistants and high-volume classification.';

let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

function startMockAgent() {
  const server = http.createServer((req, res) => {
    if (req.url.includes('/.well-known/agent-card.json')) {
      const port = server.address().port;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          name: 'Mock Research Agent',
          description: 'Mock A2A agent for delegation e2e',
          protocolVersion: '0.3.0',
          url: `http://127.0.0.1:${port}/a2a`,
          capabilities: {},
          skills: [{ id: 'research', name: 'Research', description: 'Answers research questions' }],
        })
      );
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let id = null;
      try {
        id = JSON.parse(raw)?.id ?? null;
      } catch {
        /* ignore malformed body; mock still replies */
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            kind: 'task',
            id: 'mock-task-1',
            status: {
              state: 'completed',
              message: { role: 'agent', parts: [{ kind: 'text', text: REPLY }] },
            },
          },
        })
      );
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function cleanup(db, extId) {
  db.prepare('DELETE FROM platform_sessions WHERE user_id = ?').run(OWNER);
  db.prepare('DELETE FROM org_member_invocations WHERE owner_user_id = ?').run(OWNER);
  db.prepare('DELETE FROM org_agent_members WHERE owner_user_id = ?').run(OWNER);
  db.prepare('DELETE FROM token_usage WHERE owner_user_id = ?').run(OWNER);
  db.prepare('DELETE FROM agent_ops_budgets WHERE owner_user_id = ?').run(OWNER);
  db.prepare('DELETE FROM kanban_tasks WHERE owner_user_id = ?').run(OWNER);
  db.prepare('DELETE FROM user_agents WHERE user_id = ?').run(OWNER);
  db.prepare('DELETE FROM agents WHERE id = ?').run(PARENT_AGENT);
  if (extId) db.prepare('DELETE FROM external_agents WHERE id = ?').run(extId);
  db.prepare('DELETE FROM platform_users WHERE id = ?').run(OWNER);
}

async function main() {
  initDb();
  const db = getDb();
  const server = await startMockAgent();
  const port = server.address().port;
  let extId = null;

  try {
    cleanup(db, null);
    db.prepare(
      `INSERT INTO platform_users (id, email, password_hash, name, role)
       VALUES (?, ?, 'x', 'E2E Delegation CEO', 'ceo')`
    ).run(OWNER, `${OWNER}@example.test`);
    db.prepare(
      `INSERT OR REPLACE INTO agents (id, name, role, department, is_coo)
       VALUES (?, 'E2E Parent', 'Manager', 'Research', 0)`
    ).run(PARENT_AGENT);
    db.prepare(
      `INSERT OR REPLACE INTO user_agents (user_id, agent_id, enabled) VALUES (?, ?, 1)`
    ).run(OWNER, PARENT_AGENT);

    const authUser = { id: OWNER, role: 'ceo' };
    const created = createExternalAgent(authUser, {
      name: `E2E Mock Agent ${Date.now()}`,
      description: 'Answers research questions for the e2e test',
      card_url: `http://127.0.0.1:${port}/.well-known/agent-card.json`,
      skill_id: 'research',
    });
    extId = created.id;
    const discovered = await discoverExternalAgent(extId, authUser);
    check('external agent discovered', discovered.status === 'healthy', `status=${discovered.status}`);

    const member = upsertOrgAgentMember(OWNER, {
      kind: 'external',
      ref_id: extId,
      display_name: 'Mock Research Agent',
      purpose: 'Answers research questions',
      department: 'Research',
      parent_id: PARENT_AGENT,
      monthly_token_budget: 100000,
      error_budget_pct: 25,
    });
    check('leaf member created', member?.id === `ext:${extId}`, `id=${member?.id}`);
    check('leaf member reports to internal agent', member?.parent_id === PARENT_AGENT);

    let rejected = null;
    try {
      upsertOrgAgentMember(OWNER, {
        kind: 'external',
        ref_id: extId,
        parent_id: '__not_my_agent__',
      });
    } catch (e) {
      rejected = e.message;
    }
    check('reports-to outside the org is rejected', !!rejected, rejected || 'no error thrown');

    const outcome = await delegateToOrgMembers(OWNER, {
      [member.id]: 'Summarise the latest on small language models.',
    });
    check('delegation succeeded', outcome.delegated.length === 1 && outcome.failed.length === 0,
      `delegated=${outcome.delegated.length} failed=${outcome.failed.length} blocked=${outcome.blocked.length}`);
    check('reply text captured', outcome.delegated[0]?.text?.includes('Mock external agent'),
      outcome.delegated[0]?.text?.slice(0, 60));

    const taskId = outcome.delegated[0]?.taskId;
    const task = db.prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(taskId);
    check('kanban card completed', task?.status === 'completed', `status=${task?.status}`);
    check('kanban card is owner-scoped', task?.owner_user_id === OWNER);
    check('kanban card tracks the leaf member key', task?.assigned_member_key === member.id,
      `member_key=${task?.assigned_member_key}`);
    check('kanban card leaves assigned_agent_id null (foreign key to agents)',
      task?.assigned_agent_id == null, `assigned_agent_id=${task?.assigned_agent_id}`);

    const inv = db
      .prepare('SELECT * FROM org_member_invocations WHERE owner_user_id = ? AND member_key = ?')
      .all(OWNER, member.id);
    check('invocation recorded ok', inv.length === 1 && inv[0].status === 'ok', `rows=${inv.length}`);
    check('latency recorded', inv[0]?.latency_ms != null, `latency=${inv[0]?.latency_ms}ms`);

    const tokens = getMonthlyTokens(OWNER, member.id);
    check('token usage recorded', tokens.total_tokens > 0, `tokens=${tokens.total_tokens}`);
    check('tokens flagged estimated', tokens.estimated_tokens === tokens.total_tokens,
      `estimated=${tokens.estimated_tokens}`);

    const eff = getAgentEfficiency(OWNER, member.id, { days: 30 });
    check('agent view sees the task', eff.totals.tasks_completed === 1,
      `completed=${eff.totals.tasks_completed} failed=${eff.totals.tasks_failed}`);
    check('agent view sees tokens', eff.totals.tokens > 0, `tokens=${eff.totals.tokens}`);
    check('agent view marks member as leaf', eff.kind === 'leaf');

    setAgentBudget(OWNER, member.id, { monthly_token_budget: 1, error_budget_pct: 25 });
    const blockedOutcome = await delegateToOrgMembers(OWNER, { [member.id]: 'Another request.' });
    check('over-budget member is blocked before the outbound call',
      blockedOutcome.blocked.length === 1 && blockedOutcome.delegated.length === 0,
      blockedOutcome.blocked[0]?.reasons?.join('; '));
    const cardsAfter = db
      .prepare('SELECT COUNT(*) AS c FROM kanban_tasks WHERE owner_user_id = ?')
      .get(OWNER);
    check('blocked delegation creates no kanban card', Number(cardsAfter.c) === 1, `cards=${cardsAfter.c}`);
  } finally {
    cleanup(db, extId);
    server.close();
  }

  console.log(failures ? `[e2e] ${failures} FAILURE(S)` : '[e2e] PASS');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('[e2e] error:', e);
  process.exit(1);
});
