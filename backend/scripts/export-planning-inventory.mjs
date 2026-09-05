/** Read-only, credential-free tenant metadata export. Run through stdin in backend. */
import Database from 'better-sqlite3';
const db = new Database(process.env.PLANNING_EXPORT_DB || '/data/agent-os/agent-os.db', {readonly:true});
const owner='ceo-bala';
const tables={};
function take(table, columns, where='', params=[]) {
  const present=new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(c=>c.name));
  const selected=columns.split(',').filter(c=>present.has(c));
  if(!selected.length) return;
  tables[table]=db.prepare(`SELECT ${selected.map(c=>`"${c}"`).join(',')} FROM "${table}" ${where}`).all(...params);
}
take('user_agents','user_id,agent_id,enabled','WHERE user_id=?',[owner]);
const ids=tables.user_agents.filter(a=>a.enabled).map(a=>a.agent_id);
const inAgents=`IN (${ids.map(()=>'?').join(',')})`;
take('agents','id,name,role,department,parent_id,is_coo,is_orchestrator,planning_status,openclaw_agent_id',`WHERE id ${inAgents}`,ids);
take('agent_tool_grants','agent_id,tool_name',`WHERE agent_id ${inAgents}`,ids);
take('content_tools_meta','name,display_name,purpose,enabled');
take('agent_connector_action_grants','agent_id,action_id',`WHERE agent_id ${inAgents}`,ids);
take('connector_action_registry','action_id,risk_tier,action_family,description');
take('platform_users','id,name,role,role_title,department,specialty,purpose,owner_user_id,enabled','WHERE id=? OR owner_user_id=?',[owner,owner]);
take('work_assignment_policies','owner_user_id,mode,high_risk_to_human,default_eta_hours,standard_eta_hours,complex_eta_hours','WHERE owner_user_id=?',[owner]);
take('agent_workflow_definitions','id,owner_user_id,name,description,status,paused,trigger_modes,trigger_modes_json,chat_trigger_phrase,graph_json','WHERE owner_user_id=?',[owner]);
const settings=db.prepare("SELECT * FROM platform_settings WHERE key='llm_active_endpoint'").all();
console.log(JSON.stringify({owner,exported_at:new Date().toISOString(),tables,active_slot:settings[0]?.value||'primary'}));
db.close();
