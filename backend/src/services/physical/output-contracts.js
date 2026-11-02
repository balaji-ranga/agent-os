import {fault,fingerprint,validateActionOutput,validateOutputValue} from './contracts.js';
const common=[['ok','boolean'],['status','string'],['operation_id','string'],['entity_id','string'],['site_id','string'],['hub_id','string'],['simulated','boolean'],['evidence','object'],['text','string'],['output_contract','object']].map(([id,type])=>({id,label:id,type}));
export function physicalWorkflowContract(asset,{operation='invoke',action='',property=''}={}){
 let output,input;
 if(operation==='read'){const schema=asset.description.properties[property];if(!schema)throw fault('Unknown property',404);output={version:1,schema:{type:'object',properties:{reading:schema,reported_at:{type:'number'}},required:['reading','reported_at']},bindings:{reading:{source:'observation_value'},reported_at:{source:'observation_time'}}};input={type:'object',properties:{}};}
 else if(operation==='invoke'){const spec=asset.description.actions[action];if(!spec)throw fault('Unknown action',404);if(!spec.output)throw fault('This device operation has no declared output contract',409);output=validateActionOutput(spec.output);input=spec.input;}
 else throw fault('Unsupported physical operation');
 const identity={entityId:asset.id,operation,action:operation==='invoke'?action:'',property:operation==='read'?property:''};
 const hash=fingerprint({...identity,input,output,expected:operation==='invoke'?asset.description.actions[action].expected:null});
 const ports=Object.entries(output.schema.properties).map(([id,s])=>({id,label:s.title||id,type:s.type,mediaType:s.mediaType||null,schema:structuredClone(s),required:(output.schema.required||[]).includes(id)}));
 return {...identity,version:output.version,hash,input:structuredClone(input),schema:structuredClone(output.schema),bindings:structuredClone(output.bindings),ports:[...common,...ports]};
}
export function assertPinnedContract(asset,config){
 const pinned=config.outputContract;if(!pinned)return null;
 const current=physicalWorkflowContract(asset,config);
 if(!pinned.schema||!Array.isArray(pinned.ports)||pinned.entityId!==asset.id||pinned.hash!==current.hash||pinned.version!==current.version||fingerprint(pinned.schema)!==fingerprint(current.schema)||fingerprint(pinned.ports)!==fingerprint(current.ports))throw fault('Device output contract changed; refresh outputs and review workflow bindings',409);
 return current;
}
export function projectDeviceOutputs(output,{value,at,attachments=[],result,operationId,simulated}){
 validateActionOutput(output);const data={};
 for(const [key,b]of Object.entries(output.bindings)){
  let v;
  if(b.source==='observation_value')v=value;
  else if(b.source==='observation_time')v=at;
  else if(b.source==='device_result'){v=result;for(const segment of b.path)v=v&&typeof v==='object'&&Object.hasOwn(v,segment)?v[segment]:undefined;}
  else if(b.source==='evidence_image'){const a=attachments[b.index];if(a)v={kind:'image',ref:'physical-evidence:'+operationId+':'+b.index,mime_type:a.mimeType,sha256:a.sha256,captured_at:a.at,simulated};}
  if(v!==undefined)data[key]=structuredClone(v);
 }
 return validateOutputValue(output.schema,data);
}
