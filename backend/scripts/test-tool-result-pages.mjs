import assert from 'node:assert/strict';
import {toolResultPages} from '../src/services/tool-result-pages.js';
let now=1000;const store=toolResultPages({clock:()=>now,inlineChars:100,pageChars:80,ttl:1000});
const scope={owner:'a',agent:'employee',session:'conversation'};
for(const [tool,value] of [['connector_execute_action',{ok:true,data:{body:'meaningful evidence '.repeat(100)}}],['master_data_list_tables',{tables:Array.from({length:70},(_,i)=>({id:i,name:'table '+i}))}]]){
 const output=store.project({...scope,tool},value);assert.equal(output.result_stored,true);let content=output._retrieval.content,next=output._retrieval.next_request,last;let reads=0;
 while(next){last=await store.read(scope,next,async name=>{assert.equal(name,tool);reads++;});content+=last.content;next=last.next_request;}
 assert.deepEqual(JSON.parse(content),value);assert.equal(last.coverage_complete,true);assert.ok(reads>1);
 await assert.rejects(store.read({...scope,owner:'b'},{resultId:last.resultId},async()=>{}),{code:'TOOL_RESULT_UNAVAILABLE'});
 await assert.rejects(store.read({...scope,session:'other'},{resultId:last.resultId},async()=>{}),{code:'TOOL_RESULT_UNAVAILABLE'});
 await assert.rejects(store.read(scope,{resultId:last.resultId},async()=>{throw Error('revoked');}),/revoked/);
 const replay=await store.read(scope,{resultId:last.resultId,offset:0},async()=>{});assert.equal(replay.content,output._retrieval.content);
}
const p=store.project({...scope,tool:'fixture'},{body:'x'.repeat(200)});now=2001;await assert.rejects(store.read(scope,{resultId:p._retrieval.resultId},async()=>{}),{code:'TOOL_RESULT_UNAVAILABLE'});
assert.deepEqual(store.project(scope,{ok:true}),{ok:true});
assert.equal(store.project(scope,undefined),undefined);
const jumped=store.project({...scope,tool:'fixture'},{body:'z'.repeat(400)});
const tail=await store.read(scope,{resultId:jumped._retrieval.resultId,offset:400},async()=>{});
assert.equal(tail.coverage_complete,false);
assert.equal(tail.next_request.offset,80,'Reading the tail must retain a pointer to the unread middle');
const deferred=store.project({...scope,tool:'fixture'},{body:'q'.repeat(400)},{deferRead:true});
assert.equal(deferred._retrieval.content,'');
assert.equal(deferred._retrieval.next_request.offset,0);
assert.equal(deferred._retrieval.coverage_complete,false);
console.log('GENERIC_TOOL_RESULT_PAGES_OK: two tool shapes, exact reconstruction, no source re-execution, scope isolation, revocation, expiry, replay');
