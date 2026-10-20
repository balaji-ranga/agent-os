// Run explicitly inside the deployed model-gateway container. No host actions.
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {resolveGatewaySettings} from '../integrations/gateway-settings.mjs';
import {reviewCopilotResponse} from '../integrations/maker-checker.mjs';
import {completeProvider} from '../integrations/provider-completion.mjs';
const db=new DatabaseSync('/platform/agent-os.db',{readOnly:true}),config=resolveGatewaySettings(db,JSON.parse(readFileSync('/config/gateway.json','utf8')));db.close();
const originalBudget=config.checker.maxTokens;config.checker={...config.checker,maxTokens:128};const calls=[];
const result=await reviewCopilotResponse({config,purpose:'digital_adoption_plan',draft:JSON.stringify({intent:'explain',message:'The observed form has a text field labeled Reference.',actions:[]}),messages:[{role:'user',content:JSON.stringify({task:'Explain which supported field is visible. Do not edit or save.',observed:{revision:1,path:'/synthetic',fields:[{ref:'r1f0',label:'Reference',type:'text'}],links:[]}})}],signal:AbortSignal.timeout(60000),complete:async request=>{try{const r=await completeProvider(request);calls.push({compact:request.config.compactVerdict===true,budget:request.maxTokens,status:'completed',diagnostics:r.diagnostics});return r;}catch(e){calls.push({compact:request.config.compactVerdict===true,budget:request.maxTokens,status:'failed',category:e.diagnosticCode,diagnostics:e.providerDiagnostics});throw e;}}});
if(result.quality.decision!=='accept'||result.quality.checkerRetries!==1)throw Error('Bounded retry acceptance was not demonstrated');
console.log(JSON.stringify({status:'passed',case:'LIVE_CHECKER_TRUNCATION_TO_BOUNDED_JSON_RECOVERY',globalSettingUnchanged:true,globalBudget:originalBudget,probeBudget:128,firstCallWasRealProvider:true,quality:result.quality,calls},null,2));
