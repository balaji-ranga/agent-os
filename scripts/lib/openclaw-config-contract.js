/**
 * Fast publication guards shared by Flolah's synchronous config writers.
 * The installed OpenClaw CLI remains authoritative for the complete schema.
 */
import {existsSync,readFileSync,writeFileSync,renameSync,unlinkSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

const AGENT_ID=/^[a-z0-9][a-z0-9_-]{0,63}$/i;
const PROFILES=new Set(['minimal','coding','messaging','full']);
const OPENAI_APIS=new Set(['openai-completions','openai-responses']);
/** Add an explicitly requested tool without creating allow/alsoAllow conflicts. */
export function addOpenClawAllowedTools(policy,names){
 tools(policy,'tools');
 const key=policy.allow?.length?'allow':(Array.isArray(policy.alsoAllow)||policy.profile?'alsoAllow':'allow');
 policy[key]=[...new Set([...(policy[key]||[]),...names])];
 return policy;
}
function invalid(path,reason){throw Object.assign(new Error('OpenClaw configuration rejected at '+path+': '+reason),{code:'OPENCLAW_CONFIG_CONTRACT_INVALID',configPath:path});}
export function assertOpenClawAgentId(id,path='agent.id'){
 if(typeof id!=='string'||!AGENT_ID.test(id))invalid(path,'agent IDs must start with a letter/digit and contain 1–64 letters, digits, underscores or hyphens');
 return id;
}
function tools(value,path){
 if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value))invalid(path,'expected a tool policy object');
 if(value.profile!==undefined&&!PROFILES.has(value.profile))invalid(path+'.profile','unsupported tool profile');
 for(const key of ['allow','alsoAllow','deny'])if(value[key]!==undefined&&(!Array.isArray(value[key])||value[key].some(t=>typeof t!=='string'||!t.trim()||t!==t.trim())))invalid(path+'.'+key,'expected an array of nonempty tool/group/plugin names');
 if(value.allow?.length&&value.alsoAllow?.length)invalid(path,'nonempty allow and alsoAllow cannot be combined; preserve the intended policy explicitly');
 if(value.byProvider)for(const [provider,policy]of Object.entries(value.byProvider))tools(policy,path+'.byProvider.'+provider);
}
export function pinFlolahAgentRuntime(config){
 // All Flolah agents use native plugin tools. The optional Codex harness
 // rejects their custom tool wire format; this never changes model or grants.
 for(const provider of Object.values(config.models?.providers||{}))if(provider&&OPENAI_APIS.has(provider.api))provider.agentRuntime={id:'openclaw'};
 return config;
}
export function assertOpenClawConfigContract(config){
 if(!config||typeof config!=='object'||Array.isArray(config))invalid('config','expected an object');
 const agents=config.agents||{};
 if(agents.entries!==undefined&&agents.list!==undefined)invalid('agents','mixed entries/list schemas are not supported');
 if(agents.entries!==undefined&&(!agents.entries||typeof agents.entries!=='object'||Array.isArray(agents.entries)))invalid('agents.entries','expected an agent map');
 if(agents.list!==undefined&&!Array.isArray(agents.list))invalid('agents.list','expected an agent array');
 const roster=agents.entries?Object.entries(agents.entries):(agents.list||[]).map(a=>[a?.id,a]);
 const seen=new Set();
 for(const [id,entry]of roster){assertOpenClawAgentId(id,'agents.'+id);if(seen.has(id.toLowerCase()))invalid('agents.'+id,'duplicate agent ID');seen.add(id.toLowerCase());if(!entry||typeof entry!=='object'||Array.isArray(entry))invalid('agents.'+id,'expected an agent object');tools(entry.tools,'agents.'+id+'.tools');}
 for(const key of ['systemAgent','sessionStore'])if(agents.defaults?.[key]?.agentId!==undefined)assertOpenClawAgentId(agents.defaults[key].agentId,'agents.defaults.'+key+'.agentId');
 for(const binding of config.bindings||[])if(binding.agentId!==undefined)assertOpenClawAgentId(binding.agentId,'bindings.agentId');
 tools(config.tools,'tools');tools(agents.defaults?.tools,'agents.defaults.tools');
 if(config.plugins?.entries!==undefined){
  if(!config.plugins.entries||typeof config.plugins.entries!=='object'||Array.isArray(config.plugins.entries))invalid('plugins.entries','expected a plugin map');
  for(const [id,entry]of Object.entries(config.plugins.entries)){if(!entry||typeof entry!=='object'||Array.isArray(entry))invalid('plugins.entries.'+id,'expected a plugin policy object');if(entry.enabled!==undefined&&typeof entry.enabled!=='boolean')invalid('plugins.entries.'+id+'.enabled','expected a boolean');}
 }
 return config;
}
export function writeValidatedOpenClawConfig(path,config,{mode=0o600}={}){
 pinFlolahAgentRuntime(config);
 assertOpenClawConfigContract(config);
 const catalogPath=dirname(path)+'/flolah-runtime-contract.json';
 if(existsSync(catalogPath)){
  const catalog=JSON.parse(readFileSync(catalogPath,'utf8'));
  if(catalog.source!=='installed-openclaw-schema-validation'||!Array.isArray(catalog.plugins))invalid('plugins','runtime plugin catalog is invalid; validate using the installed gateway');
  const known=new Set(catalog.plugins);
  const available=id=>{
   if(known.has(id))return true;
   if(!/^[a-z0-9][a-z0-9_-]*$/i.test(id))return false;
   try{return JSON.parse(readFileSync(dirname(path)+'/extensions/'+id+'/openclaw.plugin.json','utf8')).id===id;}catch{return false;}
  };
  for(const [id,entry]of Object.entries(config.plugins?.entries||{}))if(entry.enabled!==false&&!available(id))invalid('plugins.entries.'+id,'plugin is not in the validated runtime catalog or shared extension manifests');
  for(const id of config.plugins?.allow||[])if(!available(id))invalid('plugins.allow','plugin is not in the validated runtime catalog or shared extension manifests');
 }
 const serialized=JSON.stringify(config,null,2)+'\n';
 if(existsSync(path)&&readFileSync(path,'utf8')===serialized)return false;
 mkdirSync(dirname(path),{recursive:true});const temp=path+'.candidate-'+process.pid+'-'+randomUUID();
 try{writeFileSync(temp,serialized,{encoding:'utf8',mode,flag:'wx'});renameSync(temp,path);}
 catch(error){try{unlinkSync(temp);}catch{}throw error;}
 return true;
}
