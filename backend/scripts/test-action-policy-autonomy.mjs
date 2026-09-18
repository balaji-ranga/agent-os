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
  db.prepare('UPDATE platform_users SET mobile=? WHERE id=?').run('+6590057664', owner);

  const {
    createActionApprovalGrant,
    ensureActionPolicyTables,
    evaluateActionPolicy,
    previewActionPolicy,
    actionPolicyMiddleware,
    issueForwardedActionPolicyPass,
    listActionPolicyOverrides,
    upsertActionPolicyOverride,
    upsertActionFamilyPolicies,
  } = await import('../src/services/action-policy.js');
  const {
    recordPendingChatAction,
    decideChatActionApproval,
    decidePendingChatActionFromMessage,
    consumeApprovedChatAction,
    executeApprovedChatAction,
    kanbanActionDecisionFromMessage,
  } = await import('../src/services/chat-action-approval.js');
  const { resolveChannelActor } = await import('../src/services/channel-user-identity.js');
  const { resolveCompanyEmailRecipients } = await import('../src/services/email-send.js');
  ensureActionPolicyTables();

  assert.deepEqual(
    resolveCompanyEmailRecipients({ to: owner }, owner).to,
    [`${owner}@example.test`],
    'a company user id resolves to its profile mailbox before SMTP'
  );
  assert.deepEqual(
    resolveCompanyEmailRecipients({ to: 'CEO' }, owner).to,
    [`${owner}@example.test`],
    'the CEO alias resolves within the authenticated company'
  );
  assert.throws(
    () => resolveCompanyEmailRecipients({ to: 'not-a-mailbox-or-user' }, owner),
    /Invalid email recipient/,
    'an unresolved recipient fails before SMTP RCPT'
  );

  assert.equal(kanbanActionDecisionFromMessage({
    task: { status: 'awaiting_confirmation', description: '[CHAT_ACTION_APPROVAL]' },
    role: 'user', message: 'Approved',
  }), 'approve');
  assert.equal(kanbanActionDecisionFromMessage({
    task: { status: 'awaiting_confirmation', description: '[GOAL_ACTION_APPROVAL]' },
    role: 'user', message: 'Reject',
  }), 'reject');
  assert.equal(kanbanActionDecisionFromMessage({
    task: { status: 'open', description: '[CHAT_ACTION_APPROVAL]' },
    role: 'user', message: 'Approved',
  }), null, 'only a pending approval task may interpret chat as a decision');
  assert.equal(kanbanActionDecisionFromMessage({
    task: { status: 'awaiting_confirmation', description: 'ordinary task' },
    role: 'user', message: 'Approved',
  }), null, 'ordinary task chat must remain a comment');

  const { seedErpToolsIfMissing, seedEmailSendToolIfMissing } = await import('../src/db/seed-content-tools-meta.js');
  seedErpToolsIfMissing();
  seedEmailSendToolIfMissing();

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

  // A normal chat confirmation is bound to the exact blocked action. It is
  // owner + agent scoped, permits one identical retry, and cannot authorize a
  // changed recipient/content or a replay.
  const statusEmail = {
    to: 'ceo@example.test',
    subject: 'COO status report',
    html: '<h1>Status</h1><p>Exact generated digest</p>',
  };
  const pendingChatAction = recordPendingChatAction({
    ownerUserId: owner,
    agentId: 'balserve',
    sessionKey: 'agent::t-ceo-action-policy-test--balserve:chat-test',
    channel: 'web',
    toolName: 'email_send',
    actionFamily: 'communicate_external',
    body: statusEmail,
  });
  assert(pendingChatAction?.id);
  const chatDecision = decidePendingChatActionFromMessage({
    ownerUserId: owner,
    agentId: 'balserve',
    actor: { id: owner, role: 'ceo' },
    channel: 'web',
    message: 'Approved',
  });
  assert.equal(chatDecision?.decision, 'approved');
  assert.equal(consumeApprovedChatAction({
    ownerUserId: owner,
    agentId: 'balserve',
    toolName: 'email_send',
    body: { ...statusEmail, to: 'changed@example.test' },
  }), null, 'changed arguments cannot consume the bound approval');
  const boundChatGrant = consumeApprovedChatAction({
    ownerUserId: owner,
    agentId: 'balserve',
    toolName: 'email_send',
    body: statusEmail,
  });
  assert.equal(boundChatGrant?.ok, true);
  assert.equal(evaluateActionPolicy({
    ownerUserId: owner,
    toolName: 'email_send',
    body: statusEmail,
    approvalGrant: boundChatGrant,
  }).ok, true, 'the identical approved email passes the execution gate');
  assert.equal(consumeApprovedChatAction({
    ownerUserId: owner,
    agentId: 'balserve',
    toolName: 'email_send',
    body: statusEmail,
  }), null, 'bound chat approval is one-use');

  const whatsappEmail = { ...statusEmail, subject: 'WhatsApp-approved status report' };
  const whatsappPending = recordPendingChatAction({
    ownerUserId: owner, agentId: 'balserve', channel: 'whatsapp', toolName: 'email_send',
    actionFamily: 'communicate_external', body: whatsappEmail,
  });
  const whatsappActor = resolveChannelActor({ ownerUserId: owner, senderId: 'whatsapp:+6590057664', channel: 'whatsapp' });
  decideChatActionApproval({
    ownerUserId: owner, approvalId: whatsappPending.id, decision: 'approve', actor: whatsappActor,
    channel: 'whatsapp', evidence: 'Approved',
  });
  assert.equal(consumeApprovedChatAction({
    ownerUserId: owner, agentId: 'balserve', toolName: 'email_send', body: whatsappEmail,
  })?.ok, true, 'mapped WhatsApp CEO approval is accepted for the exact pending action');

  const middlewareEmail = { ...statusEmail, subject: 'Middleware-bound status report' };
  recordPendingChatAction({
    ownerUserId: owner, agentId: 'balserve', channel: 'web', toolName: 'email_send',
    actionFamily: 'communicate_external', body: middlewareEmail,
  });
  decidePendingChatActionFromMessage({
    ownerUserId: owner, agentId: 'balserve', actor: { id: owner, role: 'ceo' },
    channel: 'web', message: 'yes proceed',
  });
  const middlewareRequest = {
    method: 'POST', path: '/email-send', body: middlewareEmail,
    headers: { 'x-ceo-user-id': owner, 'x-openclaw-agent-id': `t-${owner}--balserve` },
    authUser: { role: 'ceo', internal: true },
  };
  const responseStub = () => ({
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  let middlewareAllowed = false;
  actionPolicyMiddleware(middlewareRequest, responseStub(), () => { middlewareAllowed = true; });
  assert.equal(middlewareAllowed, true, 'middleware consumes the exact approved chat action');
  assert.equal(middlewareRequest.actionPolicy.approval_grant_id?.startsWith('caa-'), true);
  let middlewareReplayAllowed = false;
  const middlewareReplayResponse = responseStub();
  actionPolicyMiddleware({ ...middlewareRequest, actionPolicy: undefined }, middlewareReplayResponse, () => { middlewareReplayAllowed = true; });
  assert.equal(middlewareReplayAllowed, false, 'middleware blocks replay after the bound approval is consumed');
  assert.equal(middlewareReplayResponse.body?.needs_approval, true);

  const exactExecutionEmail = {
    to: 'ceo@example.test',
    subject: 'Exact saved payload',
    html: '<p>Do not regenerate this body.</p>',
  };
  const exactPending = recordPendingChatAction({
    ownerUserId: owner, agentId: 'balserve', channel: 'web', toolName: 'email_send',
    actionFamily: 'communicate_external', body: exactExecutionEmail,
  });
  assert.throws(() => decideChatActionApproval({
    ownerUserId: owner,
    approvalId: exactPending.id,
    decision: 'approve',
    actor: { id: 'ordinary-employee', role: 'org_user' },
    channel: 'web',
    evidence: 'Approved',
  }), /Only the CEO or a CEO delegate/);
  decideChatActionApproval({
    ownerUserId: owner, approvalId: exactPending.id, decision: 'approve',
    actor: { id: owner, role: 'ceo' }, channel: 'web', evidence: 'Approved',
  });
  const realFetch = globalThis.fetch;
  let capturedApprovedRequest = null;
  globalThis.fetch = async (url, options) => {
    capturedApprovedRequest = { url: String(url), options };
    return { ok: true, status: 200, json: async () => ({ sent: true, to: [exactExecutionEmail.to], subject: exactExecutionEmail.subject }) };
  };
  try {
    const executed = await executeApprovedChatAction({ ownerUserId: owner, approvalId: exactPending.id });
    assert.equal(executed.result.sent, true);
    assert.deepEqual(JSON.parse(capturedApprovedRequest.options.body), exactExecutionEmail,
      'approval continuation dispatches the exact saved payload rather than model-regenerated arguments');
    assert.equal(capturedApprovedRequest.options.headers['x-ceo-user-id'], owner);
    assert.equal(capturedApprovedRequest.options.headers['x-agent-id'], 'balserve');
  } finally {
    globalThis.fetch = realFetch;
  }

  const failedExecution = recordPendingChatAction({
    ownerUserId: owner, agentId: 'balserve', channel: 'web', toolName: 'email_send',
    actionFamily: 'communicate_external', body: { to: owner, subject: 'Failure state', body: 'test' },
  });
  decideChatActionApproval({
    ownerUserId: owner, approvalId: failedExecution.id, decision: 'approve',
    actor: { id: owner, role: 'ceo' }, channel: 'web', evidence: 'Approved',
  });
  globalThis.fetch = async () => ({
    ok: false, status: 502, json: async () => ({ error: 'SMTP rejected recipient' }),
  });
  try {
    await assert.rejects(
      executeApprovedChatAction({ ownerUserId: owner, approvalId: failedExecution.id }),
      /SMTP rejected recipient/
    );
    assert.equal(
      db.prepare('SELECT status FROM kanban_tasks WHERE id=?').get(failedExecution.kanban_task_id).status,
      'failed',
      'a failed external execution must not leave the approval task completed'
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  const prohibited = evaluateActionPolicy({
    ownerUserId: owner,
    toolName: 'delete_customer',
    body: { ceo_approved: true, approval_token: crossOwner.token },
  });
  assert.equal(prohibited.ok, false);
  assert.equal(prohibited.mode, 'prohibited');
  assert.equal(prohibited.needs_approval, false);

  for (const toolName of ['erp_create_payment_entry', 'erp_create_journal_entry', 'erp_submit_doc', 'erp_cancel_doc']) {
    const financial = evaluateActionPolicy({ ownerUserId: owner, toolName, body: { amount: 100 } });
    assert.equal(financial.ok, false, `${toolName} must be blocked at the execution boundary`);
    assert.equal(financial.mode, 'prohibited');
    assert.equal(financial.risk_tier, 'R3');
    assert.equal(financial.action_family, 'financial_destructive');
  }
  const paymentRead = evaluateActionPolicy({ ownerUserId: owner, toolName: 'erp_list_payment_entries', body: {} });
  assert.equal(paymentRead.ok, true, 'read-only payment listing remains available');
  assert.equal(paymentRead.action_family, 'read');

  const preview = previewActionPolicy({ ownerUserId: owner, toolName: 'erp_create_payment_entry' });
  assert.equal(preview.ok, false);
  assert.equal(preview.mode, 'prohibited');
  const { preflightRoutedCapabilities } = await import('../src/services/route-action-policy.js');
  const routedPayment = preflightRoutedCapabilities({
    ownerUserId: owner,
    requestText: 'Make a payment from my card',
    route: {
      target_agent_id: 'erp-invoice-agent',
      executor_evidence: { capability_names: ['erp_list_payment_entries', 'erp_create_payment_entry'] },
    },
  });
  assert.equal(routedPayment.ok, false, 'prohibited routed capability must stop before delegation');
  assert.equal(routedPayment.blocked.tool_name, 'erp_create_payment_entry');
  const routedRead = preflightRoutedCapabilities({
    ownerUserId: owner,
    route: { target_agent_id: 'erp-invoice-agent', executor_evidence: { capability_names: ['erp_list_payment_entries'] } },
  });
  assert.equal(routedRead.ok, true, 'read-only delegation remains available');

  upsertActionFamilyPolicies(owner, [{ family: 'financial_destructive', mode: 'autonomous' }]);
  const autonomousPaymentRoute = preflightRoutedCapabilities({
    ownerUserId: owner,
    requestText: 'Record the approved payment',
    route: {
      target_agent_id: 'erp-invoice-agent',
      executor_evidence: { capability_names: ['erp_create_payment_entry'] },
    },
  });
  assert.equal(autonomousPaymentRoute.ok, true, 'Autonomous company policy permits ERP payment delegation');
  const autonomousPaymentExecution = evaluateActionPolicy({
    ownerUserId: owner,
    toolName: 'erp_create_payment_entry',
    body: { paid_amount: 100, received_amount: 100 },
  });
  assert.equal(autonomousPaymentExecution.ok, true, 'Autonomous company policy permits ERP payment execution');
  assert.equal(autonomousPaymentExecution.mode, 'autonomous');
  upsertActionFamilyPolicies(owner, [{ family: 'financial_destructive', mode: 'prohibited' }]);
  assert.equal(
    preflightRoutedCapabilities({
      ownerUserId: owner,
      route: { target_agent_id: 'erp-invoice-agent', executor_evidence: { capability_names: ['erp_create_payment_entry'] } },
    }).ok,
    false,
    'restoring Prohibited closes the delegation gate again'
  );

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
    approval_required: {
      tool: 'email_send', self_approval_blocked: true, scoped_grant_consumed: true,
      chat_confirmation_bound: true, exact_saved_payload_dispatched: true,
      whatsapp_identity_verified: true, unauthorized_employee_blocked: true,
      changed_action_blocked: true, replay_blocked: true,
    },
    prohibited: ['delete_customer', 'innocent_lookup_name', 'erp_create_payment_entry', 'erp_create_journal_entry', 'erp_submit_doc', 'erp_cancel_doc'],
    routed_financial_preflight: true,
    autonomous_financial_route_and_execution: true,
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
  try { rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
}
