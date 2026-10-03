import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-tool-risk-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
let testDb;

try {
  const { initDb } = await import('../src/db/schema.js');
  const db = initDb();
  testDb = db;
  const {
    TOOL_RISK_TIERS,
    listToolRiskMappings,
    resolveToolRiskMapping,
    setToolRiskMappingOverride,
    clearToolRiskMappingOverride,
    syncToolRiskMappingCandidates,
  } = await import('../src/services/tool-risk-mappings.js');
  const {
    ensureActionPolicyTables,
    previewActionPolicy,
    upsertActionFamilyPolicies,
  } = await import('../src/services/action-policy.js');
  ensureActionPolicyTables();

  db.prepare(`INSERT INTO content_tools_meta
    (name, display_name, endpoint, purpose, enabled, is_builtin, risk_tier, action_family)
    VALUES (?, ?, ?, ?, 1, 1, ?, ?)`)
    .run('fixture_status', 'Fixture status', '/fixture/status', 'Read fixture status', 'R0', 'read');
  db.prepare(`INSERT INTO content_tools_meta
    (name, display_name, endpoint, purpose, enabled, is_builtin, risk_tier, action_family)
    VALUES (?, ?, ?, ?, 1, 1, ?, ?)`)
    .run('production_secret_rotate', 'Rotate production secret', '/fixture/rotate', 'Rotate a production credential', 'R3', 'financial_destructive');

  assert.deepEqual(TOOL_RISK_TIERS.map((row) => row.id), ['R0', 'R1', 'R2', 'R3', 'R4']);
  const ownerA = 'ceo-risk-a';
  const ownerB = 'ceo-risk-b';
  let rowsA = listToolRiskMappings(ownerA);
  const critical = rowsA.find((row) => row.capability_id === 'production_secret_rotate');
  assert.equal(critical.risk_tier, 'R4', 'critical privileged operations are interpreted as R4');

  upsertActionFamilyPolicies(ownerA, [
    { family: 'read', mode: 'autonomous' },
    { family: 'write_internal', mode: 'autonomous' },
    { family: 'communicate_external', mode: 'autonomous' },
    { family: 'financial_destructive', mode: 'autonomous' },
  ]);
  const r4Decision = previewActionPolicy({ ownerUserId: ownerA, toolName: 'production_secret_rotate' });
  assert.equal(r4Decision.risk_tier, 'R4');
  assert.equal(r4Decision.mode, 'prohibited', 'R4 remains fail-closed even when the family is autonomous');

  const lowered = setToolRiskMappingOverride(ownerA, {
    capability_type: 'content_tool', capability_key: 'production_secret_rotate', risk_tier: 'R1',
  });
  assert.equal(lowered.mapping_source, 'user_override');
  assert.equal(previewActionPolicy({ ownerUserId: ownerA, toolName: 'production_secret_rotate' }).mode, 'autonomous');
  assert.equal(
    resolveToolRiskMapping(ownerB, 'content_tool', 'production_secret_rotate', { risk_tier: 'R3' }).risk_tier,
    'R4',
    'one company override must not change another company mapping'
  );
  assert.equal(clearToolRiskMappingOverride(ownerA, {
    capability_type: 'content_tool', capability_key: 'production_secret_rotate',
  }).risk_tier, 'R4');

  syncToolRiskMappingCandidates(ownerA, [
    { capability_type: 'connector_action', capability_id: 'gmail.delete_draft', description: 'Permanently delete a Gmail draft', risk_tier: 'R3' },
    { capability_type: 'mcp_tool', source_id: 'mcp-fixture', capability_id: 'get_symbols', description: 'List crypto symbols', risk_tier: 'R0' },
  ]);
  setToolRiskMappingOverride(ownerA, {
    capability_type: 'connector_action', capability_key: 'gmail.delete_draft', risk_tier: 'R2',
  });
  assert.equal(resolveToolRiskMapping(ownerA, 'connector_action', 'gmail.delete_draft', { risk_tier: 'R3' }).risk_tier, 'R2');

  db.prepare(`INSERT INTO platform_users (id,email,password_hash,name,role) VALUES (?,?,?,?,?)`)
    .run(ownerA, 'risk-a@example.test', 'x', 'Risk A', 'ceo');
  db.prepare(`INSERT INTO agents (id,name,role,openclaw_agent_id) VALUES (?,?,?,?)`)
    .run('risk-agent', 'Risk Agent', 'Tester', 'risk-agent');
  db.prepare(`INSERT INTO user_agents (user_id,agent_id,enabled) VALUES (?,?,1)`).run(ownerA, 'risk-agent');
  db.prepare(`INSERT INTO agent_tool_grants (agent_id,tool_name) VALUES (?,?)`).run('risk-agent', 'fixture_status');
  db.prepare(`INSERT INTO mcp_servers
    (id,name,owner_user_id,owner_role,is_platform,status) VALUES (?,?,?,?,?,?)`)
    .run('mcp-fixture', 'Fixture MCP', ownerA, 'ceo', 0, 'healthy');
  db.prepare(`INSERT INTO mcp_tools_cache (server_id,tool_name,description,input_schema_json) VALUES (?,?,?,?)`)
    .run('mcp-fixture', 'get_symbols', 'List crypto symbols', '{}');

  const { listToolsCatalogForAgent } = await import('../src/services/openclaw-agent-tools.js');
  setToolRiskMappingOverride(ownerA, { capability_type: 'content_tool', capability_key: 'fixture_status', risk_tier: 'R1' });
  const contentAccess = listToolsCatalogForAgent('risk-agent', ownerA).find((row) => row.name === 'fixture_status');
  assert.equal(contentAccess.risk_tier, 'R1');
  assert.equal(contentAccess.mapping_source, 'user_override');

  const { setAgentMcpToolGrants, listAgentMcpToolAccess, getBoundMcpPolicy } = await import('../src/services/agent-mcp-tool-grants.js');
  setAgentMcpToolGrants(ownerA, 'risk-agent', [{ server_id: 'mcp-fixture', tool_name: 'get_symbols' }]);
  setToolRiskMappingOverride(ownerA, { capability_type: 'mcp_tool', capability_key: 'mcp-fixture::get_symbols', risk_tier: 'R2' });
  const mcpAccess = listAgentMcpToolAccess(ownerA, 'risk-agent').servers[0].tools[0];
  assert.equal(mcpAccess.risk_tier, 'R2');
  assert.equal(mcpAccess.mapping_source, 'user_override');
  assert.equal(getBoundMcpPolicy(ownerA, 'risk-agent', 'mcp-fixture', 'get_symbols').risk_tier, 'R2');

  rowsA = listToolRiskMappings(ownerA);
  assert(rowsA.some((row) => row.capability_type === 'connector_action' && row.capability_id === 'gmail.delete_draft'));
  assert(rowsA.some((row) => row.capability_type === 'mcp_tool' && row.capability_id === 'get_symbols'));
  console.log(`tool risk mappings tests: PASS (${rowsA.length} mapped capabilities)`);
} finally {
  try { testDb?.close(); } catch (_) {}
  rmSync(dataDir, { recursive: true, force: true });
}
