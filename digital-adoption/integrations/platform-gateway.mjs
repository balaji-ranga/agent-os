import { timingSafeEqual } from 'node:crypto';
import {MODEL_GATEWAY_TIMEOUT_MS} from '../web/model-timeouts.mjs';
import { reviewCopilotResponse } from './maker-checker.mjs';
import {goalResponseSchema} from '../src/goal-contract.mjs';
import {assistantResponseSchema} from '../src/assistant-contract.mjs';
import {validateSnapshot} from '../src/proposals.mjs';

// Optional platform backend adapter, not mounted automatically. Inject the
// platform's active-endpoint resolver and completion function at installation.
// No dependency on Platform Help and no model keys returned to the caller.
export function createPlatformGateway({serviceToken,resolveActive,complete}) {
 if(typeof serviceToken!=='string'||serviceToken.length<32)throw new Error('Service credential required');
 return async function handle({authorization,body,signal=AbortSignal.timeout(MODEL_GATEWAY_TIMEOUT_MS)}){
  const supplied=Buffer.from(String(authorization||'')),expected=Buffer.from(`Bearer ${serviceToken}`);
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw new Error('Access denied');
  if(!['digital_adoption_plan','digital_adoption_knowledge','digital_adoption_review','digital_adoption_goal'].includes(body?.purpose)||body.selection!=='platform_active'||!Array.isArray(body.messages)||!body.messages.length||body.messages.length>14||
     Buffer.byteLength(JSON.stringify(body))>32_768||Object.keys(body).some(k=>!['purpose','selection','messages','maxTokens',...(body.purpose==='digital_adoption_review'?['draft']:[])].includes(k))||body.purpose==='digital_adoption_review'&&(!body.draft||typeof body.draft!=='object'))throw new Error('Invalid gateway request');
  for(const message of body.messages){if(!['system','user','assistant'].includes(message.role)||typeof message.content!=='string')throw new Error('Invalid messages');}
  const config=await resolveActive(); // Resolve for every call; no cached primary/secondary choice.
  if(!config||!['primary','secondary'].includes(config.active))throw new Error('Active model unavailable');
  if(config.quality?.enabled&&(!config.checker?.baseUrl||!config.checker?.model||!config.checker?.apiKey))throw Object.assign(new Error('Checker unavailable'),{code:'COPILOT_CHECKER_UNAVAILABLE'});
  const goalContext=body.purpose==='digital_adoption_goal'?JSON.parse(body.messages.at(-1).content):null;
  const planContext=body.purpose==='digital_adoption_plan'?JSON.parse(body.messages.at(-1).content):null;
  const outputSchema=goalContext?goalResponseSchema(goalContext.stage,goalContext.peerGuidance):planContext?assistantResponseSchema(validateSnapshot(planContext.observed),{goalStep:!!planContext.goalContext?.currentStep,allowedActionTypes:planContext.goalContext?.allowedActionTypes}):undefined;
  const result=body.purpose==='digital_adoption_review'?{content:JSON.stringify(body.draft)}:await complete({config,messages:body.messages,maxTokens:2000,signal,...(outputSchema?{outputSchema}:{})});
  if(!config.quality?.enabled)return {content:result.content,active:config.active,quality:{enabled:false}};
  const reviewed=await reviewCopilotResponse({config,messages:body.messages,purpose:body.purpose,draft:result.content,complete,signal});
  return {...reviewed,active:config.active};
 };
}
