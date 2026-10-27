// Opt-in local-model quality/latency probe. Disposable database, synthetic text,
// no connector/WhatsApp calls, and mandatory caller-level local-only routing.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
if(process.env.FLOASSIST_LOCAL_MODEL_TEST!=='1')throw Error('Set FLOASSIST_LOCAL_MODEL_TEST=1 to run the synthetic local-model probe.');
const root=mkdtempSync(join(tmpdir(),'floassist-local-live-'));
process.env.AGENT_OS_DATA_DIR=root;process.env.OPENCLAW_DIR=root;process.env.OPENSEARCH_ENABLED='0';
const {getDb}=await import('../src/db/schema.js');
const db=getDb();
try{
 const owner='synthetic-local-test';
 db.prepare('INSERT INTO platform_users(id,email,password_hash,name,role,llm_efficiency_mode) VALUES (?,?,?,?,?,1)').run(owner,'synthetic@example.test','unusable','Synthetic fixture','ceo');
 const {assessFloAssistSource,summarizeFloAssistNotification}=await import('../src/services/floassist/local-assistance.js');
 const {efficiencyReport,localEfficiencyModel}=await import('../src/services/efficiency-control-plane.js');
 const {chatCompletions}=await import('../src/config/llm.js');
 const quote='Please review the quotation and reply with approval.';
 const start=Date.now(),input={owner,scope:{owner,run:'synthetic-priority',origin:'floassist:priority',agent_id:'synthetic'},metadata:{app_id:'outlook',account_id:'synthetic@example.test',source_id:'synthetic-thread',provider_complete:true},text:quote,preferences:{timezone:'Asia/Singapore'}};
 const assessment=await assessFloAssistSource(input,{complete:options=>chatCompletions({...options,validateResponse:content=>{
  const value=JSON.parse(content);console.log(JSON.stringify({check:'synthetic_source_contract',keys:Object.keys(value),uncertain:value.uncertain,confidence:value.confidence,findings:value.findings?.map(f=>({kind:f.kind,quoteMatches:f.quote===quote}))}));return options.validateResponse(content);
 }})});
 if(!assessment)console.log(JSON.stringify({check:'synthetic_source_failure',events:efficiencyReport(owner).events.map(e=>({status:e.status,reason:e.fallback_reason,latencyMs:e.latency_ms}))}));
 assert.ok(assessment?.findings?.some(f=>f.quote===quote),'Local source extraction must pass exact evidence validation');
 const sourceMs=Date.now()-start;
 const reused=await assessFloAssistSource({...input,scope:{...input.scope,run:'synthetic-deadlines',origin:'floassist:deadlines'}});
 assert.equal(reused?.reused,true,'The second module must reuse the same assessment');
 const first='The supplier is waiting for your review before the team can continue.';
 const context=first+' Earlier messages discuss background details and the original request at greater length.';
 const text=`*FloAssist · Priority Alerts*\n\n*#42 · Review quotation*\n*Due:* 28 Oct 2026, 15:00 (Asia/Singapore)\n*Context:* ${context}\n*Next action:* Review quotation\n*Reply:* #42 done, stop tracking, or snooze.`;
 const began=Date.now(),shortened=await summarizeFloAssistNotification(owner,text,{runId:'synthetic-delivery',complete:options=>chatCompletions({...options,validateResponse:content=>{
  const value=JSON.parse(content);console.log(JSON.stringify({check:'synthetic_wording_contract',keys:Object.keys(value),selections:value.selections?.map(s=>({index:s.index,sentenceCount:s.sentence_count}))}));return options.validateResponse(content);
 }})});
 assert.equal(shortened,text.replace(context,first),'Local wording must preserve all fixed metadata and choose the exact first sentence');
 const report=efficiencyReport(owner);
 assert.equal(report.events.length,2);assert.ok(report.events.every(e=>e.local===1&&e.status==='success'),'Only local successful calls should be recorded');
 console.log(JSON.stringify({check:'FLOASSIST_LOCAL_MODEL_OK',model:localEfficiencyModel('ollama-efficiency').model,sourceMs,wordingMs:Date.now()-began,localCalls:report.events.length,sharedAssessmentReused:true,hostedCalls:0,metadataPreserved:true,inputTokens:report.events.reduce((s,e)=>s+e.input_tokens,0),outputTokens:report.events.reduce((s,e)=>s+e.output_tokens,0)}));
}finally{db.close();rmSync(root,{recursive:true,force:true});}
