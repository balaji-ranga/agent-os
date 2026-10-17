import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {createSourceMap} from '../src/source-map.mjs';
import {createLearningRuntime} from '../src/learning-runtime.mjs';
import {createLearningStore} from '../src/learning-store.mjs';
const owner={embeddingId:'map-A',audienceId:'public',role:'maintainer',origin:'https://example.com'};
const manifest={schema:1,origin:owner.origin,reviewed:true,screens:[{path:'/customers',title:'Customers',forms:[{id:'new-customer',label:'Customer draft'}],fields:[{key:'company',label:'Company name',type:'text',form:'new-customer'},{key:'api_key',label:'API key',type:'text'}]}]};
test('reviewed source refresh replaces old version, filters sensitive fields and never supplies live execution refs',()=>{
 const repository=openRepository();try{const map=createSourceMap(repository),first=map.refresh(owner,manifest);
 assert.deepEqual(first.counts,{screens:1,forms:1,fields:1});assert.match(first.evidence,/not_live/);
 const hint=map.guidance({...owner,role:'visitor'},'Create customer company',{path:'/'});assert.equal(hint.matches[0].fields[0].key,'company');assert.equal('ref' in hint.matches[0].fields[0],false);
 const learning=createLearningRuntime(repository,createLearningStore(repository)),draft=learning.create(owner,map.recipeDraft(owner,{path:'/customers',form:'new-customer',revision:first.revision}));assert.equal(draft.status,'draft');assert.equal(learning.validate(owner,{id:draft.id,version:draft.version}).compatible,false);assert.throws(()=>learning.publish(owner,{id:draft.id,version:draft.version,reviewed:true}));assert.throws(()=>map.recipeDraft(owner,{path:'/customers',form:'new-customer',revision:'stale'}));
 assert.equal(map.guidance({...owner,embeddingId:'map-B'},'customer',{path:'/'}),null);assert.equal(map.summary({...owner,audienceId:'other-role'}).counts.screens,0);
 const next=map.refresh(owner,{...manifest,screens:[{...manifest.screens[0],path:'/clients'}]});assert.notEqual(first.revision,next.revision);assert.deepEqual(next.screens.map(s=>s.path),['/clients']);
 }finally{repository.close();}
});
test('source map rejects visitor refresh, foreign origin, entered values and duplicate routes atomically',()=>{
 const repository=openRepository();try{const map=createSourceMap(repository);const before=map.refresh(owner,manifest);
 for(const [scope,input] of [[{...owner,role:'visitor'},manifest],[owner,{...manifest,origin:'https://other.example.com'}],[owner,{...manifest,screens:[{...manifest.screens[0],fields:[{key:'company',label:'Company',type:'text',value:'Private value'}]}]}],[owner,{...manifest,screens:[...manifest.screens,...manifest.screens]}]])assert.throws(()=>map.refresh(scope,input));
 assert.equal(map.summary(owner).revision,before.revision);
 }finally{repository.close();}
});
