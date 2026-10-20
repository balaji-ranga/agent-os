import {randomUUID} from 'node:crypto';
import {validateSnapshot} from './proposals.mjs';
const fail=code=>{throw Object.assign(new Error(code),{publicCode:code});};
// Ephemeral task-scoped RPC, never website knowledge or authority to write.
export function createPeerTasks({service,member,taskFor,live,send,enabled,clock,config}){
 const rows=new Map(),operations=new Map(),inFlight=new Map();
 const view=r=>({requestId:r.id,taskId:r.taskId,sourceInstanceId:r.source,contentRevision:r.contentRevision,mode:r.mode,status:r.status,from:r.fromOrigin,to:r.toOrigin,instruction:r.instruction,expiresAt:r.expiresAt,...(r.code?{code:r.code}:{}),...(r.result?{result:structuredClone(r.result)}:{})});
 const bound=(scope,input,side)=>{const i=member(scope,input.instanceId),r=rows.get(input.requestId);if(!r||r[side]!==i.id)fail('PEER_ACCESS_DENIED');const t=taskFor(scope,r.taskId,i.id);return {i,r,t};};
 const validate=r=>{const source=member(r.sourceScope,r.source),target=member(r.targetScope,r.target),status=service.pairStatus(r.sourceScope,{instanceId:source.id});if(enabled(source.scope,'pairing').organizationId!==source.owner||enabled(target.scope,'pairing').organizationId!==source.owner||!live(source)||!live(target)||!status.members.some(m=>m.instanceId===target.id&&m.active&&m.canHandoff))fail('RECIPIENT_OFFLINE');taskFor(r.sourceScope,r.taskId,source.id);return {source,target};};
 const packet=(scope,snapshot,values=[])=>{const s=validateSnapshot(snapshot);if(!Array.isArray(values)||values.length>60)fail('PEER_CONTEXT_INVALID');const clean=values.map(v=>{const field=s.fields.find(f=>f.ref===v.ref);if(!field||typeof v.value!=='string'||v.value.length>1000)fail('PEER_CONTEXT_INVALID');return {label:field.label,type:field.type,value:v.value};});const data={origin:scope.origin,path:s.path,forms:s.forms,fields:s.fields.map(({ref,...field})=>field),links:s.links.map(({ref,...link})=>link),values:clean};if(Buffer.byteLength(JSON.stringify(data))>16000)fail('PEER_CONTEXT_LIMIT');return data;};
 const remember=(t,id,data,reference)=>{const text=JSON.stringify(data);t.peerEvidence||=new Map();const chunks=Array.from({length:Math.ceil(text.length/2000)},(_,n)=>({filename:'Paired browser context',locator:`${data.origin||'paired goal'} ${data.path||''} · part ${n+1}`,text:text.slice(n*2000,(n+1)*2000),reference:`peer:${reference}:${n}`}));t.peerEvidence.set(id,[...(t.peerEvidence.get(id)||[]),...chunks].slice(-8));};
 const finish=(r,status,result,code)=>{if(r.status!=='pending')return; r.status=status;r.result=result;r.code=code;for(const id of [r.source,r.target]){let i;try{i=member(id===r.source?r.sourceScope:r.targetScope,id);}catch{}if(live(i))try{send(i,{type:'peer-result',...view(r)});}catch{}}};
 return {
  evidence(t,id){return structuredClone(t.peerEvidence?.get(id)||[]);},
  peerCatalog(scope,input){return service.pairStatus(scope,input).members.filter(m=>m.instanceId!==input.instanceId&&m.canHandoff&&m.active).map(m=>({instanceId:m.instanceId,websiteId:m.websiteId,origin:m.origin}));},
  async peerRequest(scope,input){
   if(!['inspect','goal'].includes(input.mode)||typeof input.instruction!=='string'||!input.instruction.trim()||input.instruction.length>8000||typeof input.operationId!=='string'||input.operationId.length>100)fail('PEER_REQUEST_INVALID');
   const source=member(scope,input.instanceId),key=source.id+':'+input.operationId,previous=rows.get(operations.get(key));
   const fingerprint=JSON.stringify([input.targetId,input.mode,input.instruction,input.sourceSnapshot,input.values]);
   if(previous){if(previous.fingerprint!==fingerprint)fail('PEER_OPERATION_CONFLICT');validate(previous);return view(previous);}
   const pending=inFlight.get(key);if(pending){if(pending.fingerprint!==fingerprint)fail('PEER_OPERATION_CONFLICT');return pending.promise;}
   const work=async()=>{
   if(rows.size>=config.tasks*12)fail('PEER_CAPACITY');
   const shared=input.sourceSnapshot?packet(scope,input.sourceSnapshot,input.values):null;
   const relayed=await service.relay(scope,input,true),t=taskFor(scope,relayed.taskId,source.id),target=member(service.peerScope(input.targetId),input.targetId);
   if([...rows.values()].filter(r=>r.taskId===t.id).length>=12)fail('PEER_CAPACITY');
   const r={id:randomUUID(),fingerprint,taskId:t.id,source:source.id,target:target.id,contentRevision:t.contentRevision||0,sourceScope:scope,targetScope:target.scope,fromOrigin:scope.origin,toOrigin:target.origin,mode:input.mode,instruction:input.instruction,status:'pending',expiresAt:t.expiresAt};
   rows.set(r.id,r);operations.set(key,r.id);if(shared){remember(t,source.id,shared,r.id);remember(t,target.id,shared,r.id);}
   try{send(target,{type:'peer-request',...view(r),from:scope.origin});}catch{finish(r,'failed',undefined,'RECIPIENT_OFFLINE');}
   return view(r);
   };
   const reservation={fingerprint,promise:work()};inFlight.set(key,reservation);try{return await reservation.promise;}finally{if(inFlight.get(key)===reservation)inFlight.delete(key);}
  },
  peerStatus(scope,input){const {r}=bound(scope,input,'source');if(r.status==='pending')try{validate(r);}catch{finish(r,'failed',undefined,'RECIPIENT_OFFLINE');}return view(r);},
  peerBinding(scope,input){const {r,t}=bound(scope,input,'target');validate(r);if(r.mode!=='goal'||r.status!=='pending')fail('PEER_REQUEST_ENDED');return {taskId:t.id,instanceId:input.instanceId,peerRequestId:r.id,delegation:{sourceInstanceId:r.source,sourceOrigin:r.fromOrigin,recipientOrigin:r.toOrigin,instruction:r.instruction}};},
  peerAnswer(scope,input,goal){const {r,t}=bound(scope,input,'target');validate(r);if(r.status==='completed'&&goal?.id===r.goalId)return view(r);if(r.status!=='pending')fail('PEER_REQUEST_ENDED');
   if(input.rejected===true){finish(r,'failed',undefined,'PEER_DECLINED');return view(r);}
   let result;
   if(r.mode==='inspect'){result=packet(scope,input.snapshot);remember(t,r.source,result,r.id);}
   else {if(!goal||goal.status!=='completed'||goal.peerRequestId!==r.id||goal.privateTask?.taskId!==t.id||goal.privateTask?.instanceId!==input.instanceId)fail('PEER_OUTCOME_REQUIRED');result={message:goal.message,clarifications:goal.clarifications||0,interruptions:goal.interruptions||[],...(input.snapshot?{observed:packet(scope,input.snapshot)}:{}),steps:goal.steps.map(s=>({title:s.title,kind:s.kind,status:s.status,effects:s.effects.map(e=>({actions:e.actions?.map(a=>({label:a.label,type:a.type,outcome:a.outcome,value:a.value}))}))}))};if(JSON.stringify(result).length>16000)result={message:goal.message,completedSteps:goal.steps.length,clarifications:goal.clarifications||0,interruptions:goal.interruptions||[]};remember(t,r.source,{origin:scope.origin,result},r.id);}
   r.goalId=goal?.id;finish(r,'completed',result);return view(r);
  },
  peerCancel(scope,input){const {r}=bound(scope,input,'source');finish(r,'failed',undefined,'PEER_CANCELLED');return view(r);},
  disconnect(id){for(const r of rows.values())if(r.status==='pending'&&(r.source===id||r.target===id))finish(r,'failed',undefined,'RECIPIENT_OFFLINE');},
  end(id){for(const [key,r]of rows)if(r.taskId===id){finish(r,'failed',undefined,'TASK_ENDED');rows.delete(key);}for(const [key,id]of operations)if(!rows.has(id))operations.delete(key);},
  maintain(){for(const r of rows.values())if(r.status==='pending')try{validate(r);}catch{finish(r,'failed',undefined,'RECIPIENT_OFFLINE');}}
 };
}
