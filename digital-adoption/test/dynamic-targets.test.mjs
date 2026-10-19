import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSnapshot,createProposalStore} from '../src/proposals.mjs';
import {parseAssistantResponse} from '../src/assistant-contract.mjs';
import {fieldGuidance} from '../src/field-guidance.mjs';
import {deterministicReview} from '../integrations/checker-contract.mjs';
import {openRepository} from '../src/repository.mjs';
const observed={revision:1,path:'/directory',fields:[{ref:'r1f0',label:'Supplier search',type:'combobox'}],targets:[{ref:'r1t0',kind:'content',role:'article',label:'Orchid Trading',text:'Orchid Trading — Singapore supplier'}]};
test('rendered results have a read-only namespace, never fill/navigation authority',()=>{
 const snapshot=validateSnapshot(observed);
 assert.equal(fieldGuidance('looking for Orchid Trading supplier',snapshot),null);
 assert.equal(parseAssistantResponse(JSON.stringify({message:'Point here',actions:[{type:'highlight',ref:'r1t0'}]}),snapshot).actions[0].type,'highlight');
 for(const type of ['fill','navigate'])assert.throws(()=>parseAssistantResponse(JSON.stringify({message:'Unsafe',actions:[{type,ref:'r1t0',...(type==='fill'?{value:'anything'}:{})}]}),snapshot));
 assert.throws(()=>validateSnapshot({...observed,targets:[{...observed.targets[0],text:'x'.repeat(481)}]}));
 assert.throws(()=>validateSnapshot({...observed,targets:Array.from({length:25},(_,i)=>({...observed.targets[0],ref:'r1t'+i}))}));
});
test('read-only requests permit grounded highlights and still forbid field writes',()=>{
 const base={task:'Show me where Orchid Trading is',purpose:'digital_adoption_plan',observed};
 assert.equal(deterministicReview({...base,proposal:{actions:[{type:'highlight',ref:'r1t0'}]}}),null);
 assert.match(deterministicReview({...base,proposal:{actions:[{type:'fill',ref:'r1f0',value:'Orchid Trading'}]}}),/advice or inspection/);
});
test('search text and selected result survive scoped proposal consumption; other controls reject query',()=>{
 const repo=openRepository();try{const store=createProposalStore(repo),scope={embeddingId:'synthetic',sessionId:'one'},action={type:'fill',ref:'r1f0',query:'orc',value:'Orchid Trading'},response={message:'Search and select the exact result after review.',actions:[action]};
 const parsed=parseAssistantResponse(JSON.stringify(response),validateSnapshot(observed));assert.equal(parsed.actions[0].query,'orc');
 const proposal=store.prepare(scope,observed,parsed),consumed=store.consume(scope,{id:proposal.id,revision:1,approved:true});assert.equal(consumed.actions[0].query,'orc');assert.equal(consumed.actions[0].value,'Orchid Trading');
 const native={...observed,fields:[{...observed.fields[0],type:'text'}]};assert.throws(()=>parseAssistantResponse(JSON.stringify(response),native));assert.throws(()=>store.prepare(scope,native,response));
 assert.throws(()=>store.prepare(scope,observed,{...response,actions:[{...action,query:'x'.repeat(161)}]}));
 }finally{repo.close();}
});
test('unknown and duplicate rendered results clarify without pretending to search unloaded pages',()=>{
 assert.equal(fieldGuidance('looking for Jade',observed),null);
 assert.equal(fieldGuidance('show me where Orchid Trading is',{...observed,targets:[...observed.targets,{...observed.targets[0],ref:'r1t1'}]}),null);
});
test('structural rules, DOM states and prior outcome are bounded observations, never authority',()=>{
 const snapshot=validateSnapshot({...observed,fields:[{...observed.fields[0],constraints:{maxlength:'80'}}],targets:[{...observed.targets[0],state:{disabled:false,busy:true}}],lastOutcome:{path:'/directory',outcome:'local_state_verified',applied:1,actionTypes:['fill'],grant:'untrusted'}});
 assert.deepEqual(snapshot.fields[0].constraints,{maxlength:'80'});assert.equal(snapshot.targets[0].state.busy,true);assert.equal(snapshot.lastOutcome.grant,undefined);assert.match(snapshot.lastOutcome.authority,/never permission/);
 assert.throws(()=>validateSnapshot({...observed,lastOutcome:{path:'/directory',outcome:'authorized',applied:1,actionTypes:['click']}}));
 assert.throws(()=>validateSnapshot({...observed,targets:[{...observed.targets[0],state:{code:'execute()'}}]}));
});
test('editing a query-only review preserves typing-only intent and ordinary approval scope',()=>{
 const repo=openRepository();try{const scope={embeddingId:'synthetic',sessionId:'one'},store=createProposalStore(repo),snapshot={...observed,fields:[{...observed.fields[0],key:'account'}]},response={message:'Review query only',actions:[{type:'fill',ref:'r1f0',value:'orch',select:false}]};
 assert.equal(parseAssistantResponse(JSON.stringify(response),snapshot).actions[0].select,false);
 const old=store.prepare(scope,snapshot,response),replacement=store.revise(scope,{id:old.id,snapshot:{...snapshot,revision:2,targets:[],fields:[{...snapshot.fields[0],ref:'r2f0'}]},edits:[{ref:'r1f0',value:'orc'}]});
 assert.equal(replacement.actions[0].select,false);assert.throws(()=>store.consume({...scope,sessionId:'another'},{id:replacement.id,revision:2,approved:true}));
 assert.equal(store.consume(scope,{id:replacement.id,revision:2,approved:true}).actions[0].select,false);
 assert.throws(()=>parseAssistantResponse(JSON.stringify({...response,actions:[{...response.actions[0],query:'different'}]}),snapshot));
 }finally{repo.close();}
});

test('loaded option references connect a combobox to fresh DOM evidence without granting target writes',()=>{
 const snapshot={...observed,fields:[{...observed.fields[0],optionRefs:['r1t0']}],targets:[{...observed.targets[0],role:'option'}]};
 assert.deepEqual(validateSnapshot(snapshot).fields[0].optionRefs,['r1t0']);
 assert.throws(()=>validateSnapshot({...snapshot,fields:[{...snapshot.fields[0],optionRefs:['r1t99']}]}));
 assert.throws(()=>validateSnapshot({...snapshot,fields:[{...snapshot.fields[0],type:'text'}]}));
 assert.throws(()=>parseAssistantResponse(JSON.stringify({message:'No authority',actions:[{type:'fill',ref:'r1t0',value:'Orchid Trading'}]}),snapshot));
});
