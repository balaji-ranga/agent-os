import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-action-policy-'));
process.env.AGENT_OS_DATA_DIR = dataDir;

try {
  const { initDb } = await import('../src/db/schema.js');
  const db = initDb();
  const owner = 'ceo-action-policy-test';
  const other = 'ceo-action-policy-other';
  for (const id of [owner, other]) {
    db.prepare(`INSERT INTO platform_users (id,email,password_hash,name,role) VALUES (?,?,?,?,?)`)
      .run(id, `${id}@example.test`, 'x', id, 'ceo');
  }

  const {
    createActionApprovalGrant,
    ensureActionPolicyTables,
    evaluateActionPolicy,
    actionPolicyMiddleware,
    issueForwardedActionPolicyPass,
    listActionPolicyOverrides,
    upsertActionPolicyOverride,
    upsertActionFamilyPolicies,
  } = await import('../src/services/action-policy.js');
  ensureActionPolicyTables();

  const policies = [
    { family: 'read', mode: 'autonomous' },
    { family: 'write_internal', mode: 'autonomous' },
    { family: 'communicate_external', mode: 'approval_required' },
    { family: 'financial_destructive', mode: 'prohibited' },
  ];
  upsertActionFamilyPolicies(owner, policies);
  upsertActionFamilyPolicies(other, policies);

  // These are representative agent tool actions, not UI-only policy evaluations.
  const read = evaluateActionPolicy({ ownerUserId: owner, toolName: 'company_search', body: { query: 'pipeline' } });
  assert.equal(read.ok, true);
  assert.equal(read.mode, 'autonomous');
  assert.equal(read.action_family, 'read');

  const write = evaluateActionPolicy({ ownerUserId: owner, toolName: 'kanban_create', body: { title: 'Follow up' } });
  assert.equal(write.ok, true);
  assert.equal(write.mode, 'autonomous');
  assert.equal(write.action_family, 'write_internal');

  const selfApproved = evaluateActionPolicy({
    ownerUserId: owner,
    toolName: 'email_send',
    body: { to: 'buyer@example.test', ceo_approved: true, confirm: true },
  });
  assert.equal(selfApproved.ok, false, 'an agent cannot self-approve using caller-supplied booleans');
  assert.equal(selfApproved.needs_approval, true);

  const grant = createActionApprovalGrant(owner, {
    family: 'communicate_external',
    toolName: 'email_send',
    constraints: { allowed_recipients: ['buyer@example.test'], campaign_id: 'launch-1' },
    uses: 1,
  });
  const wrongContext = evaluateActionPolicy({
    ownerUserId: owner,
    toolName: 'email_send',
    body: { to: 'other@example.test', campaign_id: 'launch-1', approval_token: grant.token },
  });
  assert.equal(wrongContext.ok, false);
  assert.match(wrongContext.error, /context_mismatch/);

  const approved = evaluateActionPolicy({
    ownerUserId: owner,
    toolName: 'email_send',
    body: { to: 'buyer@example.test', campaign_id: 'launch-1', approval_token: grant.token },
  });
  assert.equal(approved.ok, true);
  assert.equal(approved.approval_grant_id, grant.id);

  const replay = evaluateActionPolicy({
    ownerUserId: owner,
    toolName: 'email_send',
    body: { to: 'buyer@example.test', campaign_id: 'launch-1', approval_token: grant.token },
  });
  assert.equal(replay.ok, false, 'single-use approval cannot be replayed');

  const crossOwner = createActionApprovalGrant(owner, { family: 'communicate_external', toolName: 'email_send' });
  assert.equal(evaluateActionPolicy({
    ownerUserId: other,
    toolName: 'email_send',
    body: { approval_token: crossOwner.token },
  }).ok, false, 'approval grants are owner scoped');

  const prohibited = evaluateActionPolicy({
    ownerUserId: owner,
    toolName: 'delete_customer',
    body: { ceo_approved: true, approval_token: crossOwner.token },
  });
  assert.equal(prohibited.ok, false);
  assert.equal(prohibited.mode, 'prohibited');
  assert.equal(prohibited.needs_approval, false);

  db.prepare(
    `INSERT INTO content_tools_meta
      (name,display_name,endpoint,method,purpose,enabled,is_builtin,risk_tier,action_family)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run('innocent_lookup_name', 'Fixture destructive action', '/fixture', 'POST', 'fixture', 1, 1, 'R3', 'financial_destructive');
  const metadataClassified = evaluateActionPolicy({ ownerUserId: owner, toolName: 'innocent_lookup_name', body: {} });
  assert.equal(metadataClassified.ok, false, 'explicit metadata overrides a misleading tool name');
  assert.equal(metadataClassified.action_family, 'financial_destructive');

  // A bounded recurring tool grant overrides the company R2 approval requirement.
  const recurringEmail = upsertActionPolicyOverride(owner, {
    scope_type: 'tool', scope_id: 'email_send', action_family: 'communicate_external', mode: 'autonomous',
    constraints: { permitted_email_ids: ['daily@example.test'] }, max_uses: 2,
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  });
  const wrongRecurringRecipient = evaluateActionPolicy({
    ownerUserId: owner, toolName: 'email_send', body: { to: 'intruder@example.test' },
  });
  assert.equal(wrongRecurringRecipient.ok, false);
  assert.equal(wrongRecurringRecipient.policy_scope, 'tool');
  for (let i = 0; i < 2; i += 1) {
    const allowed = evaluateActionPolicy({ ownerUserId: owner, toolName: 'email_send', body: { to: 'daily@example.test' } });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.mode, 'autonomous');
    assert.equal(allowed.override_id, recurringEmail.id);
  }
  const exhausted = evaluateActionPolicy({ ownerUserId: owner, toolName: 'email_send', body: { to: 'daily@example.test' } });
  assert.equal(exhausted.ok, false, 'exhausted recurring grant falls back to company approval-required policy');
  assert.equal(exhausted.needs_approval, true);

  // A proxy invocation consumes a bounded rule once. Its trusted, one-time
  // forward pass reuses that decision at the concrete route without consuming
  // the same allowance a second time.
  const oneUseCleanup = upsertActionPolicyOverride(owner, {
    scope_type: 'tool', scope_id: 'gmail_mailbox_cleanup', action_family: 'financial_destructive',
    mode: 'autonomous', max_uses: 1,
  });
  const cleanupDecision = evaluateActionPolicy({ ownerUserId: owner, toolName: 'gmail_mailbox_cleanup', body: { plan_id: 'gcp-test' } });
  assert.equal(cleanupDecision.ok, true);
  const policyPass = issueForwardedActionPolicyPass({ ownerUserId: owner, toolName: 'gmail_mailbox_cleanup', decision: cleanupDecision });
  let forwarded = false;
  const forwardedReq = {
    method: 'POST', path: '/gmail-mailbox-cleanup', body: { plan_id: 'gcp-test' }, isInternalService: true,
    headers: { 'x-ceo-user-id': owner, 'x-flolah-action-policy-pass': policyPass },
    authUser: { role: 'ceo', internal: true },
  };
  const forwardedRes = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  actionPolicyMiddleware(forwardedReq, forwardedRes, () => { forwarded = true; });
  assert.equal(forwarded, true);
  assert.equal(forwardedReq.actionPolicy.forwarded_policy_pass, true);
  let replayForwarded = false;
  const replayRes = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  actionPolicyMiddleware(forwardedReq, replayRes, () => { replayForwarded = true; });
  assert.equal(replayForwarded, false, 'forward pass cannot be replayed');
  assert.equal(replayRes.statusCode, 403);
  assert.equal(listActionPolicyOverrides(owner).find((row) => row.id === oneUseCleanup.id).use_count, 1);
  assert.equal(evaluateActionPolicy({ ownerUserId: owner, toolName: 'gmail_mailbox_cleanup', body: { plan_id: 'gcp-test' } }).ok, false);

  // Re-saving an exhausted bounded rule explicitly rearms it from zero; a
  // permanent rule is represented by a null maximum-use cap.
  const rearmedCleanup = upsertActionPolicyOverride(owner, {
    scope_type: 'tool', scope_id: 'gmail_mailbox_cleanup', action_family: 'financial_destructive',
    mode: 'autonomous', max_uses: 2,
  });
  assert.equal(rearmedCleanup.use_count, 0);
  assert.equal(rearmedCleanup.max_uses, 2);
  const permanentCleanup = upsertActionPolicyOverride(owner, {
    scope_type: 'tool', scope_id: 'gmail_mailbox_cleanup', action_family: 'financial_destructive',
    mode: 'autonomous', max_uses: null, expires_at: null,
  });
  assert.equal(permanentCleanup.max_uses, null);

  upsertActionPolicyOverride(owner, {
    scope_type: 'tool', scope_id: 'social_post', action_family: 'communicate_external', mode: 'autonomous',
    constraints: { permitted_websites: ['linkedin.com'] }, max_uses: 5,
  });
  assert.equal(evaluateActionPolicy({
    ownerUserId: owner, toolName: 'social_post', body: { url: 'https://www.linkedin.com/feed/' },
  }).ok, true);
  assert.equal(evaluateActionPolicy({
    ownerUserId: owner, toolName: 'social_post', body: { url: 'https://evil.example/post' },
  }).ok, false, 'website constraint fails closed');

  // Narrowest context wins: goal > workflow > agent > tool > company.
  upsertActionPolicyOverride(owner, {
    scope_type: 'agent', scope_id: 'status-agent', action_family: 'communicate_external', mode: 'autonomous',
    constraints: { permitted_email_ids: ['daily@example.test'] },
  });
  upsertActionPolicyOverride(owner, {
    scope_type: 'workflow', scope_id: 'wf-freeze', action_family: 'communicate_external', mode: 'prohibited',
  });
  upsertActionPolicyOverride(owner, {
    scope_type: 'goal', scope_id: 'goal-freeze', action_family: 'communicate_external', mode: 'prohibited',
  });
  const agentAllowed = evaluateActionPolicy({
    ownerUserId: owner, toolName: 'email_send', body: { to: 'daily@example.test' }, context: { agentId: 'status-agent' },
  });
  assert.equal(agentAllowed.ok, true);
  assert.equal(agentAllowed.policy_scope, 'agent');
  const workflowBlocked = evaluateActionPolicy({
    ownerUserId: owner, toolName: 'email_send', body: { to: 'daily@example.test' },
    context: { agentId: 'status-agent', workflowId: 'wf-freeze' },
  });
  assert.equal(workflowBlocked.ok, false);
  assert.equal(workflowBlocked.policy_scope, 'workflow');
  const goalBlocked = evaluateActionPolicy({
    ownerUserId: owner, toolName: 'email_send', body: { to: 'daily@example.test' },
    context: { agentId: 'status-agent', workflowId: 'wf-other', goalId: 'goal-freeze' },
  });
  assert.equal(goalBlocked.ok, false);
  assert.equal(goalBlocked.policy_scope, 'goal');
  assert.equal(listActionPolicyOverrides(other).length, 0, 'scoped overrides remain owner isolated');

  const events = db.prepare(
    `SELECT payload_json FROM goal_mission_events WHERE owner_user_id = ? AND event_type = 'policy_decision'`
  ).all(owner).map((row) => JSON.parse(row.payload_json));
  assert(events.some((event) => event.allow === true));
  assert(events.some((event) => event.allow === false));

  const middlewareSource = readFileSync(new URL('../src/services/action-policy.js', import.meta.url), 'utf8');
  assert(!middlewareSource.includes("req.method === 'GET') return next()"), 'GET agent tools must also pass policy enforcement');

  console.log(JSON.stringify({
    passed: true,
    autonomous: ['company_search', 'kanban_create'],
    approval_required: { tool: 'email_send', self_approval_blocked: true, scoped_grant_consumed: true, replay_blocked: true },
    prohibited: ['delete_customer', 'innocent_lookup_name'],
    owner_isolation: true,
    scoped_overrides: {
      precedence: ['goal', 'workflow', 'agent', 'tool', 'company'],
      recurring_email_max_uses: 2,
      permitted_email_enforced: true,
      permitted_website_enforced: true,
    },
    audited_decisions: events.length,
  }, null, 2));
  db.close();
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
