import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'flolah-agent-mcp-binding-'));
process.env.AGENT_OS_DATA_DIR = join(root, 'data');
process.env.USERPROFILE = join(root, 'home');
process.env.HOME = join(root, 'home');
process.env.OPENCLAW_CONFIG_PATH = join(root, 'home', '.openclaw', 'openclaw.json');
process.env.OPENSEARCH_ENABLED = '0';

const observed = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const rpc = JSON.parse(body || '{}');
    observed.push({ method: rpc.method, authorization: req.headers.authorization || '' });
    let result = {};
    if (rpc.method === 'initialize') result = { protocolVersion: '2024-11-05', serverInfo: { name: 'fixture', version: '1' } };
    if (rpc.method === 'tools/call') result = { content: [{ type: 'text', text: `status:${rpc.params?.arguments?.ticket || 'none'}` }] };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

let db;
try {
  const { initDb } = await import('../src/db/schema.js');
  const {
    buildAgentMcpExecutionContext,
    callBoundMcpTool,
    classifyMcpTool,
    getAgentMcpBridgeGrants,
    listAgentMcpCapabilitySummaries,
    listAgentMcpToolAccess,
    listBoundMcpTools,
    setAgentMcpToolGrants,
  } = await import('../src/services/agent-mcp-tool-grants.js');
  const { evaluateActionPolicy, resolveRiskForTool, upsertActionPolicyOverride } = await import('../src/services/action-policy.js');
  const { bindWorkUnitExecution, routeAgentTurn } = await import('../src/services/agent-turn-router.js');
  const { assertCallerMayUseTool } = await import('../src/services/openclaw-agent-tools.js');
  const {
    installSessionToolScope,
    selectSessionContentTools,
    SESSION_TOOL_SCOPES_PATH,
  } = await import('../src/services/openclaw-session-tool-scope.js');
  const { pinSelectedMcpTarget } = await import('../../openclaw-extensions/agent-os-content-tools/runtime-access.js');
  db = initDb();
  for (const owner of ['ceo-a', 'ceo-b']) {
    db.prepare(`INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES (?,?,?,?,'ceo',1)`)
      .run(owner, `${owner}@example.invalid`, 'test-only', owner);
  }
  db.prepare(`INSERT INTO agents(id,name,openclaw_agent_id) VALUES ('research-agent','Research Agent','research')`).run();
  db.prepare(`INSERT INTO user_agents(user_id,agent_id,enabled) VALUES ('ceo-a','research-agent',1)`).run();
  db.prepare(`INSERT INTO user_agents(user_id,agent_id,enabled) VALUES ('ceo-b','research-agent',1)`).run();
  db.prepare(
    `INSERT INTO mcp_servers
     (id,name,transport,url,headers_json,owner_user_id,owner_role,is_platform,status)
     VALUES (?,?,?,?,?,'ceo-a','ceo',0,'healthy')`
  ).run('mcp-private-a', 'Private A', 'streamable_http', `http://127.0.0.1:${port}`, JSON.stringify({ Authorization: 'Bearer fixture-secret' }));
  const addTool = db.prepare(
    `INSERT INTO mcp_tools_cache(server_id,tool_name,description,input_schema_json) VALUES (?,?,?,?)`
  );
  addTool.run('mcp-private-a', 'ticket_status_get', 'Read ticket status', JSON.stringify({ type: 'object' }));
  addTool.run('mcp-private-a', 'announcement_publish', 'Publish an external announcement', JSON.stringify({ type: 'object' }));
  addTool.run('mcp-private-a', 'opaque_operation', 'Performs an operation', JSON.stringify({ type: 'object' }));

  assert.deepEqual(classifyMcpTool({ name: 'ticket_status_get' }), { risk_tier: 'R0', action_family: 'read' });
  assert.deepEqual(
    classifyMcpTool({ name: 'get_available_symbols', description: 'Returns the authoritative list of assets.' }),
    { risk_tier: 'R0', action_family: 'read' }
  );
  assert.deepEqual(classifyMcpTool({ name: 'opaque_operation' }), { risk_tier: 'R2', action_family: 'communicate_external' });

  const before = listAgentMcpToolAccess('ceo-a', 'research-agent');
  assert.equal(before.servers.length, 1);
  assert.equal(before.grants.length, 0);
  const saved = setAgentMcpToolGrants('ceo-a', 'research-agent', [
    { server_id: 'mcp-private-a', tool_name: 'ticket_status_get' },
    { server_id: 'mcp-private-a', tool_name: 'announcement_publish' },
  ]);
  assert.equal(saved.grants.length, 2);
  assert.deepEqual(getAgentMcpBridgeGrants('ceo-a', 'research-agent'), ['mcp_bound_tools_list', 'mcp_bound_tool_call']);
  assert.deepEqual(getAgentMcpBridgeGrants('ceo-b', 'research-agent'), []);
  assert.equal(assertCallerMayUseTool('t-ceo-a--research', 'mcp_bound_tool_call').ok, true);
  assert.equal(assertCallerMayUseTool('t-ceo-b--research', 'mcp_bound_tool_call').ok, false);
  assert.equal(listBoundMcpTools('ceo-a', 'research-agent').length, 2);
  assert.equal(listAgentMcpCapabilitySummaries('ceo-a', 'research-agent').length, 2);
  const selectedCapability = 'mcp:mcp-private-a:ticket_status_get';
  const executionContext = buildAgentMcpExecutionContext('ceo-a', 'research-agent', [selectedCapability]);
  assert.match(executionContext, /Do not claim they are unavailable/);
  assert.match(executionContext, /"selected_for_this_turn":true/);
  db.prepare(`INSERT OR IGNORE INTO agent_tool_grants(agent_id,tool_name) VALUES ('research-agent','brave_web_search')`).run();
  const sessionScope = selectSessionContentTools({
    ownerUserId: 'ceo-a',
    agentId: 'research-agent',
    message: 'Get the status from the bound source',
    route: { executor_evidence: { capability_names: [selectedCapability] } },
  });
  assert.equal(sessionScope.scoped, true);
  assert.deepEqual(sessionScope.tools, ['mcp_bound_tools_list', 'mcp_bound_tool_call']);
  assert.equal(sessionScope.tools.includes('brave_web_search'), false);
  const scopedSessionKey = 'agent:t-ceo-a--research:main';
  installSessionToolScope(scopedSessionKey, sessionScope);
  const savedScopes = JSON.parse(readFileSync(SESSION_TOOL_SCOPES_PATH, 'utf8'));
  assert.deepEqual(savedScopes[scopedSessionKey].selected_mcp_capabilities, [selectedCapability]);
  assert.deepEqual(
    pinSelectedMcpTarget(
      { server_id: 'mistyped-server', mcp_tool_name: 'mistyped-tool', arguments: { ticket: 'T-42' } },
      scopedSessionKey,
      savedScopes
    ),
    { server_id: 'mcp-private-a', mcp_tool_name: 'ticket_status_get', arguments: { ticket: 'T-42' } }
  );
  const originalRoute = await routeAgentTurn({
    ownerUserId: 'ceo-a',
    agent: { id: 'research-agent', name: 'Research Agent' },
    sessionId: 'mcp-route-test',
    message: 'Get the ticket status',
    history: [],
    semanticDecision: {
      relation: 'new_work', execution_mode: 'direct_tool', relevant_turn_ids: [],
      resolved_request: 'Get the ticket status', restart_requested: false,
      executor_evidence: { capability_names: [selectedCapability], reason: 'Exact bound capability' },
    },
  });
  bindWorkUnitExecution(originalRoute.id, null, 'completed');
  const correctedRoute = await routeAgentTurn({
    ownerUserId: 'ceo-a',
    agent: { id: 'research-agent', name: 'Research Agent' },
    sessionId: 'mcp-route-test',
    message: 'Use the bound MCP tool',
    history: [{ id: 1, role: 'user', content: 'Get the ticket status', work_unit_id: originalRoute.id }],
    semanticDecision: {
      relation: 'follow_up', execution_mode: 'direct_tool', relevant_turn_ids: [1],
      resolved_request: 'Use the bound MCP tool', restart_requested: false,
      executor_evidence: { capability_names: [selectedCapability], reason: 'Exact bound capability' },
    },
  });
  assert.equal(correctedRoute.execution_mode, 'direct_tool');
  assert.equal(correctedRoute.terminal_parent_guarded, false);

  const externalGrant = saved.grants.find((item) => item.tool_name === 'announcement_publish');
  const policy = resolveRiskForTool(`mcp_bound_action|${externalGrant.risk_tier}|${externalGrant.action_family}|mcp-private-a|announcement_publish`);
  assert.equal(policy.risk_tier, 'R2');
  assert.equal(policy.action_family, 'communicate_external');
  const policyToolName = `mcp_bound_action|${externalGrant.risk_tier}|${externalGrant.action_family}|mcp-private-a|announcement_publish`;
  const blocked = evaluateActionPolicy({ ownerUserId: 'ceo-a', toolName: policyToolName, context: { agentId: 'research-agent' } });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.needs_approval, true);
  upsertActionPolicyOverride('ceo-a', {
    scope_type: 'agent',
    scope_id: 'research-agent',
    action_family: 'communicate_external',
    mode: 'autonomous',
  });
  const autonomous = evaluateActionPolicy({ ownerUserId: 'ceo-a', toolName: policyToolName, context: { agentId: 'research-agent' } });
  assert.equal(autonomous.ok, true);
  assert.equal(autonomous.policy_scope, 'agent');

  await assert.rejects(
    () => callBoundMcpTool('ceo-b', 'research-agent', { server_id: 'mcp-private-a', tool_name: 'ticket_status_get' }),
    /not bound/i
  );
  const called = await callBoundMcpTool('ceo-a', 'research-agent', {
    server_id: 'mcp-private-a',
    tool_name: 'ticket_status_get',
    arguments: { ticket: 'T-42' },
  });
  assert.equal(called.ok, true);
  assert.match(called.result.text, /status:T-42/);
  assert.ok(observed.some((item) => item.method === 'tools/call' && item.authorization === 'Bearer fixture-secret'));

  setAgentMcpToolGrants('ceo-a', 'research-agent', []);
  await assert.rejects(
    () => callBoundMcpTool('ceo-a', 'research-agent', { server_id: 'mcp-private-a', tool_name: 'ticket_status_get' }),
    /not bound/i
  );
  const receipts = db.prepare(`SELECT status FROM agent_mcp_action_receipts WHERE owner_user_id='ceo-a' ORDER BY id`).all();
  assert.deepEqual(receipts.map((row) => row.status), ['ok', 'denied']);

  console.log(JSON.stringify({
    ok: true,
    tenant_visibility: 'passed',
    exact_binding: 'passed',
    selected_mcp_route_enforcement: 'passed',
    selected_mcp_target_pinning: 'passed',
    completed_turn_mcp_correction: 'passed',
    stored_auth_merge: 'passed',
    action_control_classification_and_override: 'passed',
    revocation: 'passed',
    receipts: receipts.map((row) => row.status),
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  try { db?.close(); } catch {}
  rmSync(root, { recursive: true, force: true });
}
