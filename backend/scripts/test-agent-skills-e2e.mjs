import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'flolah-agent-skills-'));
process.env.AGENT_OS_DATA_DIR = join(root, 'data');
process.env.USERPROFILE = join(root, 'home');
process.env.HOME = join(root, 'home');
process.env.OPENCLAW_CONFIG_PATH = join(root, 'home', '.openclaw', 'openclaw.json');
process.env.OPENSEARCH_ENABLED = '0';

let database;
try {
  const { initDb } = await import('../src/db/schema.js');
  const {
    buildAgentSkillRuntimeInstruction,
    compactAgentSkillManifest,
    createCompanySkill,
    extractSkillUsageMarker,
    listAgentSkillAssignments,
    listAgentSkillsCatalog,
    listSkillExecutionAudit,
    recordSkillExecutionSelection,
    recommendAgentSkills,
    setAgentSkillAssignments,
    syncAgentSkillsToWorkspace,
  } = await import('../src/services/agent-skills.js');
  const { validateTypedGoalPlan } = await import('../src/services/goal-plan-quality.js');

  database = initDb();
  for (const owner of ['ceo-skills-a', 'ceo-skills-b']) {
    database.prepare(`INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES (?,?,?,?,'ceo',1)`)
      .run(owner, `${owner}@example.invalid`, 'test-only', owner);
  }
  database.prepare(`INSERT INTO agents(id,name,role,openclaw_agent_id) VALUES ('skills-agent','Researcher','Revenue research','research')`).run();
  database.prepare(`INSERT INTO user_agents(user_id,agent_id,enabled) VALUES ('ceo-skills-a','skills-agent',1)`).run();
  database.prepare(`INSERT INTO user_agents(user_id,agent_id,enabled) VALUES ('ceo-skills-b','skills-agent',1)`).run();

  const created = createCompanySkill('ceo-skills-a', {
    name: 'Qualified account research',
    description: 'Research and qualify target accounts with cited evidence.',
    trigger_hints: ['account research', 'qualify leads'],
    required_tools: ['brave_web_search'],
    required_mcp_tools: ['research-mcp::lookup_account'],
    skill_md: `---\nname: qualified-account-research\ndescription: Research and qualify accounts.\n---\n\n# Procedure\n\nUse the approved research tool and cite evidence.\n`,
  }, 'ceo-skills-a');
  assert.equal(created.scope, 'company');
  assert.equal(created.version, 1);
  assert.ok(listAgentSkillsCatalog('ceo-skills-a').some((skill) => skill.id === created.id));
  assert.ok(!listAgentSkillsCatalog('ceo-skills-b').some((skill) => skill.id === created.id), 'company skill must be tenant isolated');

  let assignments = setAgentSkillAssignments('ceo-skills-a', 'skills-agent', [{ skill_id: created.id }], 'ceo-skills-a');
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].ready, false, 'missing required tool keeps skill unavailable for execution');
  assert.deepEqual(assignments[0].missing_tools, ['brave_web_search']);
  assert.deepEqual(assignments[0].missing_mcp_tools, ['research-mcp::lookup_account']);
  database.prepare(`INSERT INTO agent_tool_grants(agent_id,tool_name) VALUES ('skills-agent','brave_web_search')`).run();
  assignments = listAgentSkillAssignments('ceo-skills-a', 'skills-agent', { includeMarkdown: true });
  assert.equal(assignments[0].ready, false, 'missing required MCP tool keeps skill unavailable for execution');
  database.prepare(`INSERT INTO mcp_servers(id,name,owner_user_id,owner_role,status) VALUES ('research-mcp','Research MCP','ceo-skills-a','ceo','healthy')`).run();
  database.prepare(`INSERT INTO mcp_tools_cache(server_id,tool_name,description,input_schema_json) VALUES ('research-mcp','lookup_account','Look up an account','{}')`).run();
  database.prepare(`INSERT INTO agent_mcp_tool_grants(owner_user_id,agent_id,server_id,tool_name,risk_tier,action_family) VALUES ('ceo-skills-a','skills-agent','research-mcp','lookup_account','R0','read')`).run();
  assignments = listAgentSkillAssignments('ceo-skills-a', 'skills-agent', { includeMarkdown: true });
  assert.equal(assignments[0].ready, true);
  assert.equal(compactAgentSkillManifest('ceo-skills-a', 'skills-agent')[0].id, created.id);

  const recommended = recommendAgentSkills('ceo-skills-a', 'skills-agent', 'Research and qualify leads for our target accounts');
  assert.equal(recommended[0].id, created.id);
  const runtime = buildAgentSkillRuntimeInstruction('ceo-skills-a', 'skills-agent', 'Please qualify target accounts');
  assert.match(runtime.instruction, /FLOLAH SKILL CONTRACT/);
  assert.match(runtime.instruction, /skills\/qualified-account-research\/SKILL\.md/);
  const parsed = extractSkillUsageMarker(`Finished.\n[FLOLAH_SKILLS_USED: ${created.id}@v1]`, runtime.allowed);
  assert.equal(parsed.reply, 'Finished.');
  assert.equal(parsed.used[0].skill_id, created.id);

  const workspace = join(root, 'workspace');
  const sync = syncAgentSkillsToWorkspace('ceo-skills-a', 'skills-agent', workspace);
  assert.equal(sync.assigned, 1);
  assert.ok(existsSync(join(workspace, 'skills', 'qualified-account-research', 'SKILL.md')));
  assert.match(readFileSync(join(workspace, 'SKILLS.md'), 'utf8'), /Qualified account research/);

  const auditId = recordSkillExecutionSelection({
    ownerUserId: 'ceo-skills-a',
    agentId: 'skills-agent',
    skillRefs: parsed.used,
    selectedBy: 'agent',
    selectionReason: 'Matched account research request.',
    workUnitId: 'work-skill-1',
    status: 'completed',
  });
  assert.ok(auditId);
  assert.equal(listSkillExecutionAudit('ceo-skills-a', 'skills-agent')[0].skill_refs[0].skill_id, created.id);
  assert.equal(listSkillExecutionAudit('ceo-skills-b', 'skills-agent').length, 0, 'execution audit must be tenant isolated');

  const catalog = {
    agents: [{ id: 'skills-agent', skills: compactAgentSkillManifest('ceo-skills-a', 'skills-agent') }],
    tools: [], workflows: [], humans: [],
  };
  const validPlan = validateTypedGoalPlan([{
    key: 'research', type: 'specialty_task', label: 'Research accounts', depends_on: [], required_inputs: [], produces: ['qualified_accounts'],
    spec: { agent_id: 'skills-agent', message: 'Research and qualify target accounts', skill_refs: [{ skill_id: created.id, version_id: created.version_id, version: 1 }] },
  }], catalog);
  assert.deepEqual(validPlan.errors, []);
  const invalidPlan = validateTypedGoalPlan([{
    key: 'research', type: 'specialty_task', label: 'Research accounts', depends_on: [], required_inputs: [], produces: ['qualified_accounts'],
    spec: { agent_id: 'skills-agent', message: 'Research accounts', skill_refs: [{ skill_id: 'skill-other-tenant' }] },
  }], catalog);
  assert.ok(invalidPlan.errors.some((message) => /not assigned/.test(message)));

  assert.throws(
    () => setAgentSkillAssignments('ceo-skills-b', 'skills-agent', [{ skill_id: created.id }], 'ceo-skills-b'),
    /unavailable/i,
  );

  console.log(JSON.stringify({
    ok: true,
    registry_and_versioning: 'passed',
    tenant_isolation: 'passed',
    permission_readiness: 'passed',
    deterministic_recommendation: 'passed',
    runtime_marker_and_audit: 'passed',
    workspace_materialization: 'passed',
    goal_plan_skill_contract: 'passed',
  }, null, 2));
} finally {
  try { database?.close(); } catch {}
  rmSync(root, { recursive: true, force: true });
}
