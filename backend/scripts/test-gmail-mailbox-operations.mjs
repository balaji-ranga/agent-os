import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-gmail-ops-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
let testDb;

try {
  const { initDb } = await import('../src/db/schema.js');
  testDb = initDb();
  const {
    GMAIL_QUERIES,
    reviewGmailMailbox,
    executeGmailMailboxCleanup,
    getGmailCleanupPlan,
  } = await import('../src/services/gmail-mailbox-operations.js');
  const { inferRiskForTool } = await import('../src/services/action-policy.js');
  const { planRecipePublishFromChat } = await import('../src/services/agent-workflow-recipes.js');

  assert.equal(GMAIL_QUERIES.recent(7), 'newer_than:7d -in:spam -in:trash');
  assert.match(GMAIL_QUERIES.stale_marketing(7), /older_than:7d/);
  assert.equal(inferRiskForTool('gmail_mailbox_review').action_family, 'read');
  assert.equal(inferRiskForTool('gmail_mailbox_cleanup').action_family, 'financial_destructive');
  assert.equal(inferRiskForTool('gmail_mailbox_cleanup_status').action_family, 'read');
  const recipe = planRecipePublishFromChat(
    'Create a workflow to organize Gmail, summarize it, and delete spam and promotions older than 7 days'
  );
  assert.equal(recipe.ok, true);
  assert.equal(recipe.recipe_id, 'gmail-mailbox-operations');
  const graph = recipe.actions.find((action) => action.action === 'create_workflow')?.graph;
  assert.deepEqual(graph.nodes.map((node) => node.data?.toolName).filter(Boolean), [
    'gmail_mailbox_review',
    'gmail_mailbox_cleanup',
  ]);
  assert.equal(
    graph.nodes.find((node) => node.id === 'gmail-cleanup-1').data.inputBindings[0].sourceOutputKey,
    'result.plan_id'
  );

  const calls = [];
  const execute = async (owner, action, input) => {
    calls.push({ owner, action, input });
    if (action === 'gmail.move_to_trash') {
      if (input.messageId === 'fail-me') throw new Error('simulated Gmail rejection');
      return { ok: true };
    }
    const query = input.query || '';
    if (query === 'in:spam') return { data: { messages: [{ messageId: 'spam-1', subject: 'Spam', sender: 'bad@example.test', messageText: 'junk' }] } };
    if (query.includes('older_than')) return { data: { messages: [
      { messageId: 'promo-1', subject: 'Old sale', sender: 'shop@example.test', messageText: 'promotion content' },
      { messageId: 'fail-me', subject: 'Another sale', sender: 'shop2@example.test', messageText: 'promotion content' },
    ] } };
    return { data: { messages: [{ messageId: 'recent-1', subject: 'Project decision', sender: 'colleague@example.test', messageText: 'Please approve the proposal.' }] } };
  };
  const llm = async () => ({ content: 'Recent: one project decision. Cleanup: one spam and two old promotions.' });
  const reviewed = await reviewGmailMailbox('ceo-a', { days: 7 }, { executeConnectorAction: execute, chatCompletions: llm });
  assert.equal(reviewed.report.recent_count, 1);
  assert.equal(reviewed.report.candidate_count, 3);
  assert.match(reviewed.summary, /project decision/i);
  assert.equal(getGmailCleanupPlan('ceo-b', reviewed.plan_id), null, 'plans must be tenant isolated');

  const result = await executeGmailMailboxCleanup('ceo-a', { plan_id: reviewed.plan_id }, { executeConnectorAction: execute });
  assert.equal(result.status, 'partial');
  assert.equal(result.trashed, 2);
  assert.equal(result.failed, 1);
  assert.equal(calls.filter((call) => call.action === 'gmail.move_to_trash').length, 3);
  assert.ok(calls.filter((call) => call.action === 'gmail.move_to_trash').every((call) => call.owner === 'ceo-a'));
  assert.match(result.pre_delete_summary, /Cleanup:/);

  await assert.rejects(
    executeGmailMailboxCleanup('ceo-b', { plan_id: reviewed.plan_id }, { executeConnectorAction: execute }),
    /not found for this company/
  );
  console.log('gmail mailbox operations tests: PASS');
} finally {
  try { testDb?.close(); } catch (_) {}
  rmSync(dataDir, { recursive: true, force: true });
}
