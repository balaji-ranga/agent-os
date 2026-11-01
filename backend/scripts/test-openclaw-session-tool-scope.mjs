import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'flolah-session-tool-scope-'));
process.env.AGENT_OS_DATA_DIR = join(root, 'data');
process.env.HOME = join(root, 'home');
process.env.USERPROFILE = join(root, 'home');
process.env.OPENCLAW_DIR = join(root, 'home', '.openclaw');
process.env.OPENSEARCH_ENABLED = '0';

let handle;
try {
  const { initDb } = await import('../src/db/schema.js');
  const {
    MAX_SESSION_CONTENT_TOOLS,
    SESSION_TOOL_SCOPES_PATH,
    installSessionToolScope,
    removeSessionToolScope,
    selectSessionContentTools,
  } = await import('../src/services/openclaw-session-tool-scope.js');
  handle = initDb();
  handle.prepare("INSERT OR REPLACE INTO agents(id,name,role,is_coo,is_orchestrator) VALUES ('scope-agent','Scope Agent','Coordinator',1,1)").run();
  const insertMeta = handle.prepare(`INSERT OR REPLACE INTO content_tools_meta
    (name,display_name,endpoint,method,purpose,enabled,is_builtin) VALUES (?,?,?,'POST',?,1,0)`);
  const insertGrant = handle.prepare('INSERT OR IGNORE INTO agent_tool_grants(agent_id,tool_name) VALUES (?,?)');
  for (let index = 0; index < 140; index += 1) {
    const name = index === 139 ? 'calendar_list_events' : `fixture_tool_${String(index).padStart(3, '0')}`;
    insertMeta.run(name, name, `/fixture/${name}`, name === 'calendar_list_events' ? 'List calendar events read only' : `Fixture capability ${index}`);
    insertGrant.run('scope-agent', name);
  }
  const selection = selectSessionContentTools({
    agentId: 'scope-agent',
    message: 'List Microsoft calendar events for the next 24 hours read only',
    route: { executor_evidence: { capability_names: ['calendar_list_events'] } },
  });
  assert.equal(selection.scoped, true);
  assert.equal(selection.grants_count, 140);
  assert.ok(selection.tools.length <= MAX_SESSION_CONTENT_TOOLS);
  assert.ok(selection.tools.includes('calendar_list_events'), 'router-selected capability must survive bounding');
  for(const name of ['physical_entities_list','physical_invoke','physical_operation_get']){
    insertMeta.run(name,name,`/fixture/${name}`,'Registered physical device capability');insertGrant.run('scope-agent',name);
  }
  const physical=selectSessionContentTools({agentId:'scope-agent',message:'Operate a registered device',route:{executor_evidence:{capability_names:['physical_invoke']}}});
  for(const name of ['physical_entities_list','physical_invoke','physical_operation_get'])assert.ok(physical.tools.includes(name),'physical request must retain discovery/invoke/verification tools');
  assert.ok(!physical.tools.includes('physical_evidence_get'),'protocol family must not grant unassigned tools');
  assert.ok(physical.tools.every(name=>name.startsWith('physical_')),'a single physical-device route cannot fall back to desktop browser or unrelated tools');
  const physicalRead=selectSessionContentTools({agentId:'scope-agent',message:'Inspect registered capabilities',route:{executor_evidence:{capability_names:['physical_entities_list']}}});
  assert.ok(!physicalRead.tools.includes('physical_invoke'),'a read-only device route does not gain an action tool');
  const key = 'agent:t-fixture--scope-agent:request-1';
  installSessionToolScope(key, selection);
  assert.equal(existsSync(SESSION_TOOL_SCOPES_PATH), true);
  assert.equal(removeSessionToolScope(key), true);
  assert.equal(removeSessionToolScope(key), false);
  installSessionToolScope(key,{...selection,floassist_module:'followups',floassist_sources:['gmail','gmail','unknown']});
  assert.equal(JSON.parse(readFileSync(SESSION_TOOL_SCOPES_PATH,'utf8'))[key].floassist_module,'followups');
  assert.deepEqual(JSON.parse(readFileSync(SESSION_TOOL_SCOPES_PATH,'utf8'))[key].floassist_sources,['gmail']);
  removeSessionToolScope(key);
  console.log('OpenClaw session tool scope: OK');
} finally {
  try { handle?.close(); } catch {}
  rmSync(root, { recursive: true, force: true });
}
