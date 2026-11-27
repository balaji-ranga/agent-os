import {toolResultPages} from './tool-result-pages.js';
export const voiceResultPages=toolResultPages({inlineChars:4500,pageChars:2200,idPrefix:'voice-result-'});
import {getAgentToolGrants} from './openclaw-agent-tools.js';
import {getToolMeta} from './content-tools-meta.js';
import {PARAM_SCHEMAS} from '../../../openclaw-extensions/agent-os-content-tools/tool-parameter-schemas.js';
export const PRIVATE_VOICE_CONTROLS=[
 {type:'function',name:'voice_result_read',description:'Read the next exact page of a stored voice tool result. Never repeat the original action.',parameters:{type:'object',properties:{resultId:{type:'string'},offset:{type:'integer',minimum:0}},required:['resultId'],additionalProperties:false}},
 {type:'function',name:'tool_search',description:'Discover currently granted platform capabilities by meaning. Search before claiming any capability is unavailable.',parameters:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false}},
 {type:'function',name:'tool_describe',description:'Read the exact input schema for a discovered tool before invoking it.',parameters:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}},
 {type:'function',name:'tool_call',description:'Execute a described granted tool through normal owner, action-policy, approval and execution-budget checks. Preserve approval-required and incomplete outcomes.',parameters:{type:'object',properties:{id:{type:'string'},args:{type:'object',additionalProperties:true}},required:['id','args'],additionalProperties:false}}
];
export function privateVoiceCatalog(agentId,{grants=getAgentToolGrants,meta=getToolMeta}={}){
 return (grants(agentId)||[]).filter(n=>!['speech_stt','speech_tts','list_inbound_attachments'].includes(n)).map(name=>({name,...meta(name)})).filter(t=>t.enabled===1||t.enabled===true);
}
export function privateVoiceDiscovery(catalog,name,args={}){
 if(name==='tool_search'){
  const q=String(args.query||'').toLowerCase().split(/\s+/).filter(Boolean);const scored=catalog.map(t=>({t,score:q.reduce((n,w)=>n+(String(t.name+' '+t.display_name+' '+t.purpose).toLowerCase().includes(w)?1:0),0)})).filter(x=>x.score||!q.length).sort((a,b)=>b.score-a.score);
  // Discovery is an index, not the full operating guide. Keep it inline so a
  // large purpose cannot consume several voice turns just to discover tools.
  // tool_describe retains the complete guide and authoritative input schema.
  return {ok:true,tools:scored.slice(0,12).map(({t})=>({id:t.name,description:String(t.purpose||t.display_name||'').slice(0,180)})),has_more:scored.length>12};
 }
 const tool=catalog.find(t=>t.name===args.id);if(!tool)throw Object.assign(Error('Tool not granted in this voice session'),{status:403});
 if(name==='tool_describe')return {ok:true,id:tool.name,description:tool.purpose||tool.display_name,parameters:PARAM_SCHEMAS[tool.name]||{type:'object',properties:{},additionalProperties:true}};
 if(name==='tool_call')return {tool_name:tool.name,arguments:args.args&&typeof args.args==='object'&&!Array.isArray(args.args)?args.args:{}};
 throw Object.assign(Error('Unknown voice control'),{status:422});
}
// Small shared assistant surface, not an intent router. Every direct call
// still rechecks the live grant and uses the ordinary governed execution path.
export function privateVoiceManifest(catalog){
 const core=new Set(['organization_read','agent_work_history','email_send']);
 return [...PRIVATE_VOICE_CONTROLS,...catalog.filter(t=>core.has(t.name)&&PARAM_SCHEMAS[t.name]).map(t=>({type:'function',name:t.name,description:String(t.purpose||t.display_name||t.name).slice(0,300),parameters:PARAM_SCHEMAS[t.name]}))];
}
