// Reusable manual simulation: only registered simulated assets can be actuated.
export function virtualRoomWorkflow({cameraId,tvId}) {
 const node=(id,type,label,taskConfig={},inputBindings=[])=>({id,type,position:{x:0,y:0},data:{label,taskConfig,inputBindings:type==='physical_device'?[{id:'entity_id',mode:'static',value:''},{id:'arguments',mode:'static',value:''}]:inputBindings}});
 const binding=(id,sourceNodeId,sourceOutputKey)=>({id,mode:'dynamic',sourceNodeId,sourceOutputKey});
 const device=(entityId,action,argumentsJson='{}')=>({entityId,action,argumentsJson,requireSimulated:true,requireVisualEvidence:true,operationTimeoutMs:300000,nodeTimeoutMs:300000,timeoutAction:'fail'});
 const condition=(sourceNodeId,sourceOutputKey,operator,compareValue)=>({sourceNodeId,sourceOutputKey,operator,compareValue});
 const schema={type:'object',properties:{tv_state:{type:'string',enum:['on','off','unknown']},confidence:{type:'number',minimum:0,maximum:1},reason:{type:'string',minLength:1,maxLength:800}},required:['tv_state','confidence','reason']};
 const nodes=[
  node('start','trigger','Ad hoc only - virtual room'),
  node('capture','physical_device','Virtual camera - capture room',device(cameraId,'capture')),
  node('vision','analyze_image','Brain / vision LLM - inspect room',{mode:'describe',resultSchemaJson:JSON.stringify(schema),prompt:'Inspect only the attached room image. Is the television screen visibly displaying a picture and therefore on? A black unlit screen means off. If the screen is hidden, absent or ambiguous report unknown with low confidence. Do not infer state from the filename or metadata. Return tv_state, confidence from 0 to 1, and a concise visible reason.',nodeTimeoutMs:90000,timeoutAction:'fail'},[binding('image','capture','image')]),
  node('is-on','if','TV visibly on?',condition('vision','result.tv_state','eq','on')),
  node('confident','if','Vision confidence at least 0.85?',condition('vision','result.confidence','gte','0.85')),
  node('clock','time_window','Singapore time - 13:00 to 18:00',{timeZone:'Asia/Singapore',startTime:'13:00',endTime:'18:00',allowSimulationClock:true},[binding('at','start','trigger_input.simulation_time')]),
  node('in-hours','if','Within permitted hours?',condition('clock','in_window','eq','true')),
  node('power-off','physical_device','Virtual TV - power off',device(tvId,'set_power','{"on":false}')),
  node('after','physical_device','Virtual camera - capture after off',device(cameraId,'capture')),
  node('continue','merge','Continue without switching off')
 ];
 nodes.forEach((n,i)=>n.position={x:(i%5)*290,y:Math.floor(i/5)*260});
 const link=(source,target,sourceHandle)=>({id:source+'-'+target,source,target,...(sourceHandle?{sourceHandle}:{})});
 const edges=[link('start','capture'),link('capture','vision'),link('vision','is-on'),link('is-on','confident','true'),link('is-on','continue','false'),link('confident','clock','true'),link('confident','continue','false'),link('clock','in-hours'),link('in-hours','power-off','true'),link('in-hours','continue','false'),link('power-off','after')];
 return {nodes,edges};
}
