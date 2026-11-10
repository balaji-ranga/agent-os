import {getDb} from '../db/schema.js';
import {readOpenClawConfigSafe} from './openclaw-config-safe.js';

const initialized=new WeakSet();
function ensure(db){
 if(initialized.has(db))return;
 db.exec(`CREATE TABLE IF NOT EXISTS agent_model_preferences (
 owner_user_id TEXT NOT NULL, agent_id TEXT NOT NULL, runtime_agent_id TEXT NOT NULL,
 model TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(owner_user_id,agent_id), UNIQUE(owner_user_id,runtime_agent_id))`);
 initialized.add(db);
}
// Only configured shared models are selectable. Never expose another company's
// BYOK provider, credentials, endpoint URLs or authentication profiles.
export function configuredAgentModels(config){
 const models=new Map();
 for(const [provider,value] of Object.entries(config?.models?.providers||{})){
  if(provider.startsWith('byok-'))continue;
  for(const model of value.models||[]){
   if(!model?.id||model.enabled===false)continue;
   const id=`${provider}/${model.id}`;
   models.set(id,{id,name:model.name||model.id,provider});
  }
 }
 return [...models.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export function getAgentModelPreference(owner,agent,{db=getDb(),config=readOpenClawConfigSafe()}={}){
 ensure(db);const row=db.prepare('SELECT model FROM agent_model_preferences WHERE owner_user_id=? AND agent_id=?').get(owner,agent);
 const defaultModel=config?.agents?.defaults?.model;
 return {model:row?.model||'',configured:!!row,default_model:typeof defaultModel==='string'?defaultModel:defaultModel?.primary||'',models:configuredAgentModels(config)};
}
export function setAgentModelPreference(owner,agent,runtime,model,{db=getDb(),config=readOpenClawConfigSafe()}={}){
 ensure(db);
 if(typeof model!=='string'||model.length>300)throw Object.assign(new Error('Select a configured model or leave it blank.'),{status:400});
 model=model.trim();
 if(model&&!configuredAgentModels(config).some(x=>x.id===model))throw Object.assign(new Error('This model is not available in the configured shared model catalog.'),{status:400});
 db.prepare(`INSERT INTO agent_model_preferences(owner_user_id,agent_id,runtime_agent_id,model) VALUES(?,?,?,?)
 ON CONFLICT(owner_user_id,agent_id) DO UPDATE SET runtime_agent_id=excluded.runtime_agent_id,model=excluded.model,updated_at=datetime('now')`).run(owner,agent,runtime,model);
 return getAgentModelPreference(owner,agent,{db,config});
}
export function applyAgentModelPreference(entry,owner,{db=getDb()}={}){
 ensure(db);const row=db.prepare('SELECT model FROM agent_model_preferences WHERE owner_user_id=? AND runtime_agent_id=?').get(owner,entry.id);
 // Absent preference preserves existing BYOK behavior. An explicitly saved
 // blank opts into the live platform default rather than pinning today's slot.
 if(!row)return entry;
 if(row.model)entry.model={primary:row.model};else delete entry.model;
 return entry;
}
