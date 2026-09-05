// Focused contract checks. No live providers, connectors or business writes.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const fixture = mkdtempSync(join(tmpdir(), 'flolah-plan-relevance-'));
process.env.AGENT_OS_DATA_DIR = fixture;
const { runGoalPlanRounds, validateCoverage } = await import('../src/services/goal-plan-rounds.js');
const { applyRelevanceVerdict, filterRelevantEvidence, RELEVANCE_PROMPT } = await import('../src/services/retrieval-relevance.js');
const { getDb } = await import('../src/db/schema.js');
const { assessRetrievedWrite } = await import('../src/services/retrieval-write-guard.js');
const { expandLexicalQuery } = await import('../src/services/opensearch/documents.js');
let checks = 0;
function check(label, fn) { fn(); checks++; console.log('PASS ' + label); }
const prompt = 'Find relevant businesses, create verified leads, and save email drafts.';
const steps = [{key:'discover'},{key:'leads'},{key:'drafts'}];
const approved = {approved:true,issues:[],coverage:[
  {requirement_id:'r1',covered:true,step_keys:['discover','leads','drafts']},
]};
const response = value => ({content:JSON.stringify(value),modelUsed:'fixture'});
const base = {prompt,normalize:JSON.parse,validate: value=>({ok:value.every(x=>x.key),errors:['invalid key']})};
try {
  check('product help is valid evidence for product how-to tasks',()=>assert.match(RELEVANCE_PROMPT,/valid evidence when the task itself asks how to use that product/i));
  check('lexical RAG expands common plurals',()=>{assert.match(expandLexicalQuery('policies document'),/\bpolicy\b/);assert.match(expandLexicalQuery('contracts'),/\bcontract\b/);});
  let makerCalls=0, checkerCalls=0;
  const first=await runGoalPlanRounds({...base,make:async()=>{makerCalls++;return response(steps);},check:async()=>{checkerCalls++;return response(approved);}});
  check('complete plan exits after first approval',()=>{assert.equal(makerCalls,1);assert.equal(checkerCalls,1);assert.equal(first.quality.llm_maker_checker_succeeded,true);});
  const invalidSeen=[],semanticSeen=[];
  await runGoalPlanRounds({...base,
    make:async context=>{invalidSeen.push(context);return response(context.attempt===1?[{wrong_field:true}]:steps);},
    check:async context=>{semanticSeen.push(context);return response(context.attempt===1?{approved:false,issues:['Include the missing draft outcome']}:approved);},
  });
  check('schema and semantic corrections reach maker together without wasting a round',()=>{
    assert.equal(semanticSeen.length,2);
    assert.deepEqual(semanticSeen[0].validationErrors,['invalid key']);
    assert(invalidSeen[1].errors.includes('invalid key'));
    assert(invalidSeen[1].errors.includes('Include the missing draft outcome'));
  });
  const seen=[];
  const rejection={approved:false,issues:['Draft output is missing'],revised_steps:[{wrong_field:true}]};
  const repaired=await runGoalPlanRounds({...base,make:async context=>{seen.push(context);return response(steps);},check:async({attempt})=>response(attempt===3?approved:rejection)});
  check('invalid checker correction returns to maker with full context up to round 3',()=>{
    assert.equal(repaired.quality.maker_attempts,3);assert.deepEqual(seen[1].previous.checker_response,rejection);
    assert.deepEqual(seen[1].previous.steps,steps);assert(seen[1].errors.includes('Draft output is missing'));
  });
  let attempts=0;
  await assert.rejects(()=>runGoalPlanRounds({...base,make:async()=>{attempts++;return response(steps);},check:async()=>response(rejection)}),e=>e.code==='GOAL_PLAN_UNVERIFIED'&&e.details.business_steps_executed===0);
  check('three rejections stop without executing a catalog fallback',()=>assert.equal(attempts,3));
  check('approval must contain coverage referencing actual steps',()=>{
    assert(validateCoverage({approved:true,issues:[]},prompt,steps).length);
    assert(validateCoverage({...approved,coverage:[{requirement:'save email drafts',covered:true,step_keys:['invented']}]},prompt,steps).length);
    assert(validateCoverage({...approved,issues:['not complete']},prompt,steps).length);
  });
  const chunks=[
    {document_id:'resume-fixture',content:'Alex is a software engineer living in Tampines. Contact details are available.'},
    {document_id:'clinic-fixture',content:'Example Dental Clinic operates in Tampines, Singapore. Website: https://clinic.example.'},
  ];
  const verdict={assessments:[{index:0,supports_task:false,quote:'',reason:'A person is not a dental clinic.'},{index:1,supports_task:true,quote:'Example Dental Clinic operates in Tampines, Singapore.',reason:'This excerpt identifies the requested kind of business in the requested location.'}]};
  const accepted=applyRelevanceVerdict(chunks,verdict);
  check('unrelated person removed; accepted evidence retains source and quote',()=>{assert.equal(accepted.chunks.length,1);assert.equal(accepted.chunks[0].document_id,'clinic-fixture');assert.equal(accepted.rejected[0].document_id,'resume-fixture');});
  check('fabricated supporting quote cannot pass',()=>assert.equal(applyRelevanceVerdict([chunks[0]],{assessments:[{index:0,supports_task:true,quote:'Alex runs a dental clinic',reason:'Claims unsupported ownership.'}]}).chunks.length,0));
  check('incomplete verdict rejects omissions while duplicate verdict is rejected',()=>{
    const omitted=applyRelevanceVerdict(chunks,{assessments:[verdict.assessments[1]]});
    assert.equal(omitted.chunks.length,1);
    assert.equal(omitted.rejected.length,1);
    assert.match(omitted.rejected[0].reason,/omitted/i);
    assert.throws(()=>applyRelevanceVerdict(chunks,{assessments:[verdict.assessments[0],verdict.assessments[0]]}));
  });
  let received;
  const filtered=await filterRelevantEvidence('fixture-owner','dental clinics in Tampines',chunks,{callModel:async args=>{received=args;return response(verdict);}});
  check('relevance model receives scoped query and untrusted excerpts',()=>{assert.equal(received.ownerUserId,'fixture-owner');assert.equal(JSON.parse(received.messages[1].content).task,'dental clinics in Tampines');assert.equal(filtered.chunks.length,1);});
  const unavailable=await filterRelevantEvidence('fixture-owner','dental clinics',chunks,{callModel:async()=>{throw new Error('simulated timeout');}});
  check('model failure never exposes unvetted search hits',()=>{assert.deepEqual(unavailable.chunks,[]);assert.equal(unavailable.relevance.status,'validation_unavailable');});
  let bareLookupModelCalled=false;
  const bareLookup=await filterRelevantEvidence('fixture-owner','Raji',[{document_id:'resume',content:'Candidate: RAJISRI is listed in this resume.'},{document_id:'other',content:'Rajesh is a different name.'}],{callModel:async()=>{bareLookupModelCalled=true;throw new Error('must not be called');}});
  check('bare identifier lookup returns grounded prefix occurrences without an LLM relevance guess',()=>{assert.equal(bareLookupModelCalled,false);assert.equal(bareLookup.chunks.length,1);assert.equal(bareLookup.chunks[0].document_id,'resume');assert.equal(bareLookup.relevance.mode,'identifier_lookup');});
  const deniedWrite=await assessRetrievedWrite({ownerUserId:'fixture-owner',action:{name:'Unrelated Person'},retrieval:{chunks:[]},callModel:async()=>response({approved:false,unsupported_fields:['name'],reason:'No task-relevant identity evidence.'})});
  const unvalidatedWrite=await assessRetrievedWrite({ownerUserId:'fixture-owner',action:{},retrieval:{},callModel:async()=>{throw new Error('timeout');}});
  const validWrite=await assessRetrievedWrite({ownerUserId:'fixture-owner',action:{},retrieval:{},callModel:async()=>response({approved:true,unsupported_fields:[],reason:'All proposed fields have supporting evidence.'})});
  check('evidence write gate rejects unsupported facts and checker outage',()=>{assert.equal(deniedWrite.ok,false);assert.equal(unvalidatedWrite.ok,false);assert.equal(validWrite.ok,true);});
  console.log(`PASS ${checks} planner/relevance checks; no external actions.`);
} finally { getDb().close(); rmSync(fixture,{recursive:true,force:true}); }
