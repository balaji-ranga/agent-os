import {getDb} from '../db/schema.js';
import {readOpenClawConfigSafe} from './openclaw-config-safe.js';
import {byokProviderId,secondaryByokProviderId} from './byok-provider-id.js';

const initialized=new WeakSet();
function ensure(db){
 if(initialized.has(db))return;
 db.exec(`CREATE TABLE IF NOT EXISTS agent_model_preferences (
 owner_user_id TEXT NOT NULL, agent_id TEXT NOT NULL, runtime_agent_id TEXT NOT NULL,
 model TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(owner_user_id,agent_id), UNIQUE(owner_user_id,runtime_agent_id))`);
 initialized.add(db);
}
// Suggestions and route evidence never expose another company's BYOK provider,
// credentials, endpoint URLs or authentication profiles. Input remains free text.
export function configuredAgentModels(config,owner){
 const models=new Map();
 const privateProviders=owner?new Set([byokProviderId(owner),secondaryByokProviderId(owner)]):new Set();
 for(const [provider,value] of Object.entries(config?.models?.providers||{})){
  if(provider.startsWith('byok-')&&!privateProviders.has(provider))continue;
  for(const model of value.models||[]){
   if(!model?.id||model.enabled===false)continue;
   const id=`${provider}/${model.id}`;
   models.set(id,{id,name:model.name||model.id,provider,credential_source:privateProviders.has(provider)?'byok':'platform'});
  }
 }
 return [...models.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
function ownerByokProviders(config,owner){
 return [byokProviderId(owner),secondaryByokProviderId(owner)].filter(id=>config?.models?.providers?.[id]).map((id)=>({id,label:id===byokProviderId(owner)?'Your primary BYOK key':'Your secondary BYOK key'}));
}
export function resolveAgentModelChoice(config,owner,model){
 const defaults=config?.agents?.defaults?.model;
 const defaultSlug=typeof defaults==='string'?defaults:defaults?.primary||'';
 if(!model)return {model:defaultSlug,credential_source:'platform',inherited:true};
 if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,299}$/.test(model)||model.endsWith('/'))throw Object.assign(new Error('Enter a valid model ID or leave it blank.'),{status:400});
 const own=ownerByokProviders(config,owner),slash=model.indexOf('/'),prefix=slash>0?model.slice(0,slash):'';
 if(prefix.startsWith('byok-')&&!own.some(p=>p.id===prefix))throw Object.assign(new Error('This BYOK provider is not available for your account.'),{status:400});
 if(own.length){
  const provider=own.some(p=>p.id===prefix)?prefix:own[0].id;
  const id=provider===prefix?model.slice(slash+1):model;
  return {model:`${provider}/${id}`,provider,model_id:id,credential_source:'byok',inherited:false};
 }
 const catalog=configuredAgentModels(config);
 const exact=catalog.find(m=>m.id===model);
 const matches=catalog.filter(m=>m.id.slice(m.provider.length+1)===model);
 const selected=exact||(matches.length===1?matches[0]:null);
 const provider=selected?.provider||defaultSlug.split('/')[0];
 if(!provider||!config?.models?.providers?.[provider])throw Object.assign(new Error('No configured provider is available for this model.'),{status:400});
 const id=selected?selected.id.slice(provider.length+1):model;
 return {model:`${provider}/${id}`,provider,model_id:id,credential_source:'platform',inherited:false};
}
export function getAgentModelPreference(owner,agent,{db=getDb(),config=readOpenClawConfigSafe()}={}){
 ensure(db);const row=db.prepare('SELECT model FROM agent_model_preferences WHERE owner_user_id=? AND agent_id=?').get(owner,agent);
 const defaultModel=config?.agents?.defaults?.model;
 let routing;
 try{routing=resolveAgentModelChoice(config,owner,row?.model||'');}catch(e){routing={error:e.message};}
 return {model:row?.model||'',configured:!!row,default_model:typeof defaultModel==='string'?defaultModel:defaultModel?.primary||'',models:configuredAgentModels(config,owner),routing};
}
export function setAgentModelPreference(owner,agent,runtime,model,{db=getDb(),config=readOpenClawConfigSafe()}={}){
 ensure(db);
 if(typeof model!=='string'||model.length>300)throw Object.assign(new Error('Enter a model ID or leave it blank.'),{status:400});
 model=model.trim();
 resolveAgentModelChoice(config,owner,model);
 db.prepare(`INSERT INTO agent_model_preferences(owner_user_id,agent_id,runtime_agent_id,model) VALUES(?,?,?,?)
 ON CONFLICT(owner_user_id,agent_id) DO UPDATE SET runtime_agent_id=excluded.runtime_agent_id,model=excluded.model,updated_at=datetime('now')`).run(owner,agent,runtime,model);
 return getAgentModelPreference(owner,agent,{db,config});
}
export function applyAgentModelPreference(entry,owner,{db=getDb(),config=readOpenClawConfigSafe(),runtimeAgentId=entry?.id}={}){
 if(!entry||!runtimeAgentId)return entry;
 ensure(db);const row=db.prepare('SELECT model FROM agent_model_preferences WHERE owner_user_id=? AND runtime_agent_id=?').get(owner,runtimeAgentId);
 // Absent preference preserves existing BYOK behavior. An explicitly saved
 // blank opts into the live platform default rather than pinning today's slot.
 if(!row)return entry;
 if(row.model){
  let route;
  try{route=resolveAgentModelChoice(config,owner,row.model);}catch{entry.model={primary:row.model,fallbacks:[]};return entry;}
  const provider=config.models.providers[route.provider];
  provider.models ||= [];
  if(!provider.models.some(m=>m.id===route.model_id))provider.models.push({id:route.model_id,name:route.model_id});
  // A requested model must not silently change model or credential source.
  entry.model={primary:route.model,fallbacks:[]};
 }else delete entry.model;
 return entry;
}
