import {assertPinnedContract,projectDeviceOutputs} from './output-contracts.js';
import {createHash} from 'node:crypto';
import {renderWorkflowTemplates} from '../agent-workflow-io.js';
import {fault,validateOutputValue} from './contracts.js';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function executePhysicalWorkflowTask(inputs,config,context,{ownerUserId,workflowId,runId,nodeId,iteration=1,dispatchId='',plane,principal='owner',isRunActive=()=>true,pollMs=200}={}){
 if(!ownerUserId||runId==null||!nodeId)throw fault('Physical workflow authority required',403);
 if(!plane){const {getPhysicalControlPlane}=await import('./runtime.js');plane=getPhysicalControlPlane();}
 const render=value=>renderWorkflowTemplates(value,context||{});
 const entityId=String(inputs.entity_id||render(config.entityId)||'').trim();const asset=plane.assertResource(ownerUserId,entityId,principal);
 if(config.requireSimulated===true&&asset.description.flolah.simulated!==true)throw fault('This workflow permits simulated devices only',403);
 const outputContract=assertPinnedContract(asset,config);
 if(!asset.enabled)throw fault('Physical asset disabled',403);
 for(const [field,value]of [['siteId',config.siteId],['hubId',config.hubId]])if(value&&String(render(value))!==asset[field])throw fault('Physical asset location does not match selected site/hub',409);
 const base={entity_id:asset.id,site_id:asset.siteId,hub_id:asset.hubId,simulated:asset.description.flolah.simulated};
 if((config.operation||'invoke')==='read'){
  const property=String(render(config.property)||'');if(!asset.description.properties[property])throw fault('Unsupported physical property');
  const observation=asset.observations[property];if(observation&&(Date.now()-observation.at>60000||plane.deviceReadiness(asset).status==='unavailable'))throw fault('Physical observation is stale or device unavailable',409);if(!observation)throw fault('No observed property value is available',409);
  return {...(outputContract?projectDeviceOutputs(outputContract,{value:observation.value,at:observation.at}):{}),...base,...(outputContract?{output_contract:{version:outputContract.version,hash:outputContract.hash}}:{}),ok:true,status:'observed',property,value:observation.value,observed_at:observation.at,result:structuredClone(observation),text:'Last known observed '+property+' = '+JSON.stringify(observation.value)};
 }
 if((config.operation||'invoke')!=='invoke')throw fault('Unsupported physical workflow operation');
 const action=String(render(config.action)||'');let input=inputs.arguments;
 if(input==null||input==='')input=render(config.argumentsJson||'{}');if(typeof input==='string')input=JSON.parse(input);
 const timeoutMs=Number(config.operationTimeoutMs??30000);if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw fault('Physical operation timeout must be 1000–300000 ms');
 if(!isRunActive())throw Object.assign(Error('Workflow stopped'),{code:'PHYSICAL_WORKFLOW_STOPPED'});
 const idempotencyKey='wf-'+createHash('sha256').update(JSON.stringify([String(runId),nodeId,iteration,dispatchId])).digest('hex');
 const operation=plane.operation(ownerUserId,{entityId,action,input,idempotencyKey,timeoutMs},principal==='owner'?'workflow:'+runId+':'+nodeId:principal,principal,{workflowId});
 for(;;){
  if(!isRunActive()){
   try{plane.cancel(ownerUserId,operation.id);}catch{/* Already-dispatched device work cannot always be cancelled. Its operation/evidence remain visible. */}
   throw Object.assign(Error('Workflow stopped; inspect physical operation '+operation.id),{code:'PHYSICAL_WORKFLOW_STOPPED'});
  }
  plane.expire();const current=plane.owned('operations',ownerUserId,operation.id);
  if(current.status==='completed'&&outputContract&&current.outputContract?.hash!==outputContract.hash)throw fault('Completed operation output contract does not match the workflow pin',409);
  if(current.status==='completed'&&config.requireVisualEvidence&&!current.evidence?.attachments?.length)throw Object.assign(Error('Physical state verified, but required visual evidence is unavailable for operation '+current.id),{code:'PHYSICAL_VISUAL_EVIDENCE_REQUIRED',operationId:current.id});
  if(current.status==='completed'){
   const common={...base,ok:true,status:current.status,operation_id:current.id,evidence:structuredClone(current.evidence),text:'Verified physical operation '+current.action+' completed'};
   if(outputContract)return {...common,...structuredClone(validateOutputValue(outputContract.schema,current.outputs)),output_contract:{version:outputContract.version,hash:outputContract.hash}};
   return {...common,result:structuredClone(current),image:current.evidence?.attachments?.length?'physical-evidence:'+current.id+':0':''};
  }
  if(['failed','denied','cancelled','uncertain','timed_out'].includes(current.status))throw Object.assign(Error('Physical operation '+current.id+' '+current.status+(current.error?': '+current.error:'')),{code:'PHYSICAL_OPERATION_FAILED',operationId:current.id});
  await sleep(pollMs);
 }
}
