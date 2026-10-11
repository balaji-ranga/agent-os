import assert from 'node:assert/strict';
import { answerConnectedKnowledge as runAnswer, evidenceGroups, validateAnswerDecision, knowledgeDateContext, evidenceDateFacts, citationRelationships } from '../src/services/knowledge-answer.js';
assert.deepEqual(knowledgeDateContext(new Date('2026-10-11T00:00:00Z')).next_month,{start_inclusive:'2026-11-01',end_exclusive:'2026-12-01'});
assert.deepEqual(knowledgeDateContext(new Date('2026-12-31T00:00:00Z')).next_month,{start_inclusive:'2027-01-01',end_exclusive:'2027-02-01'});
assert.equal(evidenceDateFacts('Renews 2026-11-15',knowledgeDateContext(new Date('2026-10-11T00:00:00Z')))[0].in_next_month,true);
// Legacy citation fixtures are wrapped in the new explicit eligibility contract.
async function answerConnectedKnowledge(owner,input,deps){
  const complete=deps.complete;
  return runAnswer(owner,input,{...deps,complete:async options=>{
    const result=await complete({...options,messages:[{role:'system',content:options.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n')},options.messages.at(-1)]});
    return {content:JSON.stringify({eligible:true,conditions:[{requirement:'Requested fact',met:true,reason:'Supplied evidence',citations:['K1']}],answer:result.content})};
  }});
}
assert.equal(validateAnswerDecision(JSON.stringify({eligible:true,conditions:[{requirement:'Active overdue invoice',met:false,reason:'Cancelled',citations:['K1']}],answer:'Incorrect inclusion [K1]'}),[{id:'K1'}]).status,'invalid_decision');
assert.equal(validateAnswerDecision(JSON.stringify({eligible:false,conditions:[{requirement:'Active overdue invoice',met:false,reason:'Cancelled',citations:['K1']}],answer:''}),[{id:'K1'}]).status,'insufficient_evidence');
assert.equal(validateAnswerDecision('Plain prose [K1]',[{id:'K1'}]).status,'invalid_decision');
for(const [reason,status] of [['Evidence [K1]','eligible'],['Evidence [K99]','invalid_decision'],['No reference','invalid_decision']]){
  assert.equal(validateAnswerDecision(JSON.stringify({conditions:[{requirement:'Fact',met:true,reason}],answer:'Fact [K1]'}),[{id:'K1'}]).status,status);
}
assert.equal(validateAnswerDecision(JSON.stringify({conditions:[null],answer:'Fact [K1]'}),[{id:'K1'}]).status,'invalid_decision');
assert.equal(validateAnswerDecision(JSON.stringify({conditions:[{requirement:'Fact',met:true,reason:'Supplied evidence',citations:['K1']}],answer:'Supported [K1]'}),[{id:'K1'}]).status,'eligible');
assert.equal(validateAnswerDecision(JSON.stringify({conditions:[{requirement:'Fact',met:false,reason:'Missing evidence',citations:[]}],answer:'Should not be published'}),[{id:'K1'}]).status,'insufficient_evidence');
assert.equal(validateAnswerDecision(JSON.stringify({eligible:true,conditions:[{requirement:'Fact',met:true,reason:'Fact',citations:['K99']}],answer:'Fact [K1]'}),[{id:'K1'}]).status,'invalid_decision');
const retrieve=async()=>({evidence:[{entity:'e1',text:'Renewal November 2026',source:'s1',object_id:'contract'}],relationships:[],sources:[],note:'Snapshot only.'});
const input={query:'When is renewal?'};
let calls=0;
const complete=async options=>{calls++;assert.equal(options.ownerUserId,'alice');assert.equal(options.timeoutMs,30000);return {content:'November 2026 [K1]'};};
assert.equal((await answerConnectedKnowledge('alice',input,{retrieve,complete})).answer_status,'generated_from_evidence');
assert.equal((await answerConnectedKnowledge('alice',input,{retrieve,complete:async()=>({content:'Made-up citation [K99]'})})).answer_status,'invalid_citations');
const linked=await answerConnectedKnowledge('alice',input,{retrieve,complete:async()=>({content:'Renewal November 2026 [K1](https://invented.example/source)'})});
assert.equal(linked.answer,'Renewal November 2026 [K1]');
assert.equal(linked.citations[0].url,undefined);
const labelledLink=await answerConnectedKnowledge('alice',input,{retrieve,complete:async()=>({content:'[Contract](https://invented.example/source) confirms November [K1]'})});
assert.equal(labelledLink.answer,'[Contract] confirms November [K1]');
assert.equal((await answerConnectedKnowledge('alice',input,{retrieve,complete:async()=>({content:'INSUFFICIENT_EVIDENCE'})})).answer_status,'insufficient_evidence');
assert.equal((await answerConnectedKnowledge('alice',input,{retrieve,complete:async()=>({content:'Historical data [K1]. Final output: **INSUFFICIENT_EVIDENCE**'})})).answer_status,'insufficient_evidence');
assert.equal((await answerConnectedKnowledge('alice',input,{retrieve,complete:async()=>({content:'Facts [K1, K99]'})})).answer_status,'invalid_citations');
assert.equal((await answerConnectedKnowledge('alice',input,{retrieve,complete:async()=>({content:'Facts [K1, K1]'})})).answer,'Facts [K1] [K1]');
await answerConnectedKnowledge('alice',input,{retrieve:async()=>({...await retrieve(),evidence:[{entity:'cancelled',text:'Past due, 4750',fields:{status:'Cancelled',docstatus:2,secret:'never include'}}]}),complete:async options=>{
  const context=JSON.parse(options.messages[1].content);
  assert.deepEqual(context.citations[0].lifecycle,{status:'Cancelled',docstatus:2});
  assert.ok(!options.messages[1].content.includes('never include'));
  assert.match(options.messages[0].content,/not active obligations/);
  return {content:'INSUFFICIENT_EVIDENCE'};
}});
assert.equal((await answerConnectedKnowledge('alice',input,{retrieve,complete:async()=>({content:'Unverified [K99](https://invented.example/source)'})})).answer_status,'invalid_citations');
assert.equal((await answerConnectedKnowledge('alice',input,{retrieve,complete:async()=>{throw new Error('private provider detail');}})).answer_status,'unavailable');
const empty=await answerConnectedKnowledge('alice',input,{retrieve:async()=>({evidence:[]}),complete});
assert.equal(empty.answer_status,'insufficient_evidence');assert.equal(calls,1);
console.log('Knowledge answer: scoped bounded generation, citation checks, empty evidence and provider failure passed.');
const mixed=[{entity:'a',source:'crm',text:'Customer A'},{entity:'b',source:'erp',text:'Invoice A'},{entity:'c',source:'erp',text:'Unrelated customer B'}];
assert.equal(evidenceGroups(mixed,[{from:'a',to:'b'}]).length,2);
assert.deepEqual(citationRelationships([{entity:'a',id:'K1',title:'Account'},{entity:'b',id:'K2',title:'Invoice'}],[{from:'b',to:'a',relation:'customer',evidence:{origin:'native_record'}},{from:'a',to:'unavailable',relation:'other'}]),[{from:'K2',to:'K1',relation:'customer',from_title:'Invoice',to_title:'Account',provenance:{origin:'native_record'}}]);
const contexts=[];
await answerConnectedKnowledge('alice',input,{retrieve:async()=>({evidence:mixed,relationships:[{from:'a',to:'b'}],sources:[],note:'Snapshot'}),complete:async options=>{contexts.push(options.messages[1].content);return {content:'Supported [K1]'};}});
assert.equal(contexts.length,2);
assert.ok(contexts.every(context=>!(context.includes('Customer A')&&context.includes('Unrelated customer B'))));
console.log('Knowledge answer: disconnected customer records never share an LLM generation context.');
let repairs=0;
const repaired=await runAnswer('alice',input,{retrieve,complete:async options=>{
  repairs++;assert.ok(options.timeoutMs<=30000);
  return {content:JSON.stringify({eligible:repairs>1,conditions:[{requirement:'Renewal date',met:true,reason:'Document states November',citations:['K1']}],answer:repairs>1?'November [K1]':''})};
}});
assert.equal(repaired.answer_status,'generated_from_evidence');assert.equal(repairs,2);
repairs=0;
const rejected=await runAnswer('alice',input,{retrieve,complete:async()=>{repairs++;return {content:'malformed'};}});
assert.equal(rejected.answer_status,'invalid_decision');assert.equal(repairs,2);
console.log('Knowledge answer: contradictory decisions get one bounded repair; persistent invalid decisions are not published.');
