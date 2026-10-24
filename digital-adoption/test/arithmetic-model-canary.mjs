import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {reviewCopilotResponse} from '/candidate/integrations/maker-checker.mjs';
import {resolveGatewaySettings} from '/adoption/integrations/gateway-settings.mjs';
import {createProviderCompletion} from '/adoption/integrations/provider-completion.mjs';
import {pageUnderstandingPrompt,pageObservationEvidence} from '/candidate/src/page-understanding.mjs';
import {arithmeticEvidence} from '/candidate/src/arithmetic-evidence.mjs';
const db=new DatabaseSync('/platform/agent-os.db',{readOnly:true}),config=JSON.parse(await readFile('/config/gateway.json','utf8')),observed=JSON.parse(await readFile('/candidate/test/evidence/page-understanding-20261024/snapshots.json','utf8')).generic,trace=[],provider=createProviderCompletion();
const active=resolveGatewaySettings(db,config);assert.equal(active.quality.enabled,true);
const complete=async request=>{const out=await provider(request);trace.push({role:request.config.slot?'checker':'maker',response:JSON.parse(out.content),receivedFeedback:request.messages.at(-1).content.includes('boundedCheckerFeedback'),...(request.config.slot?{calculatedEvidence:JSON.parse(request.messages.at(-1).content).arithmeticChecks}:{})});return out;};
try{
 const result=await reviewCopilotResponse({config:active,purpose:'digital_adoption_plan',messages:[{role:'system',content:pageUnderstandingPrompt+' Return JSON {intent:"explain",message:string,actions:[]} with a concise supported calculation and no host actions.'},{role:'user',content:JSON.stringify({task:'There are 107 assets and 10 loaded rows. Explain the estimated pages assuming this capacity; show the calculation.',observed,pageEvidence:pageObservationEvidence(observed)})}],draft:JSON.stringify({intent:'explain',message:'107 / 10 = 10.2, so 11 pages are needed assuming ten rows per page.',actions:[]}),complete,signal:AbortSignal.timeout(120000)});
 const answer=JSON.parse(result.content);assert.equal(result.quality.decision,'accept');assert.ok(result.quality.checkerRevisions>=1);assert.match(answer.message,/11/);assert.ok(arithmeticEvidence(answer.message).every(c=>c.matchesRoundedValue||c.claimed===c.ceiling));assert.ok(!answer.message.includes('10.2'));assert.equal(trace[0].role,'checker');assert.equal(trace[0].response.decision,'revise');assert.equal(trace[0].calculatedEvidence[0].computed,10.7);assert.ok(trace.some(t=>t.role==='maker'&&t.receivedFeedback));
 const evidence={at:new Date().toISOString(),passed:true,message:answer.message,quality:result.quality,trace};await writeFile('/output/arithmetic-model-results.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{db.close();}
