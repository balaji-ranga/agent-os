// Time-zone-aware wall-clock gate. Test clocks are restricted to all-simulator graphs.
export function executeTimeWindow(inputs={},config={}, {graph,owner,plane,now=Date.now()}={}) {
  const minute=value=>{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value||''))throw Error('Time window requires HH:mm');return Number(value.slice(0,2))*60+Number(value.slice(3));};
  const start=minute(config.startTime),end=minute(config.endTime);
  if(start===end)throw Error('Time window must have distinct boundaries');
  let at=now,simulated_clock=false;
  if(inputs.at!=null && inputs.at!==''){
    if(config.allowSimulationClock!==true || !plane || !owner)throw Error('Simulation clock is not enabled');
    const nodes=graph?.nodes?.filter(n=>n.type==='physical_device')||[];
    if(!nodes.length||nodes.some(n=>n.data?.taskConfig?.requireSimulated!==true||n.data?.inputBindings?.some(b=>b.id==='entity_id'&&(b.mode!=='static'||Boolean(b.value)))||!plane.owned('entities',owner,n.data.taskConfig.entityId).description.flolah.simulated))throw Error('Simulation clock requires fixed simulated devices only');
    if(typeof inputs.at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(inputs.at)||!Number.isFinite(Date.parse(inputs.at)))throw Error('Simulation clock requires an ISO timestamp with timezone');
    at=Date.parse(inputs.at);simulated_clock=true;
  }
  const time_zone=String(config.timeZone||'UTC');
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:time_zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at));
  const wall=Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
  const in_window=start<end?wall>=start&&wall<end:wall>=start||wall<end;
  return {ok:true,in_window,simulated_clock,time_zone,evaluated_at:new Date(at).toISOString(),local_time:String(Math.floor(wall/60)).padStart(2,'0')+':'+String(wall%60).padStart(2,'0'),text:in_window?'Inside time window':'Outside time window'};
}
