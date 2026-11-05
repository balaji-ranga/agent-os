import {setTimeout as delay} from 'node:timers/promises';
import {TERMINAL} from './contracts.js';

// Wait only for the existing operation. Never retry actuation to obtain evidence.
export async function physicalOperationResponse(plane,owner,id,{waitMs=15000,pollMs=100}={}){
 const deadline=Date.now()+waitMs;
 let operation;
 do{
  plane.expire();operation=plane.owned('operations',owner,id);
  if(TERMINAL.has(operation.status)||operation.status==='awaiting_approval'||Date.now()>=deadline)break;
  await delay(Math.min(pollMs,Math.max(1,deadline-Date.now())));
 }while(true);
 return {...structuredClone(operation),operationId:operation.id,
  nextAction:TERMINAL.has(operation.status)?'report_result':operation.status==='awaiting_approval'?'request_approval':'read_operation_status',
  instruction:TERMINAL.has(operation.status)
   ? 'Report this result and its evidence scope. A delivery receipt does not prove the physical state. Do not repeat the action, including after failure or uncertainty, without a new explicit user request.'
   : `Do not invoke this action again. ${operation.status==='awaiting_approval'?'Request the required approval.':'Use physical_operation_get'} with operationId ${operation.id}; an acknowledgement is not completion.`};
}
