import test from 'node:test';
import assert from 'node:assert/strict';
import { openRepository } from '../src/repository.mjs';
import { createProposalStore } from '../src/proposals.mjs';
test('explicit multi-field edits never silently issue a partial approval',()=>{
 const repository=openRepository();try{
  const store=createProposalStore(repository),scope={embeddingId:'A',sessionId:'one'};
  const snapshot={revision:1,partialEdit:true,fields:[{ref:'r1f0',label:'Shipping method',type:'select-one'},{ref:'r1f1',label:'Gift wrap',type:'checkbox'}]};
  const incomplete=store.prepare(scope,snapshot,{message:'Review',actions:[{type:'fill',ref:'r1f1',value:'true'}]});
  assert.equal(incomplete.id,null);assert.deepEqual(incomplete.actions,[]);
  const complete=store.prepare(scope,snapshot,{message:'Review',actions:[{type:'fill',ref:'r1f0',value:'Express'},{type:'fill',ref:'r1f1',value:'true'}]});assert.equal(complete.actions.length,2);
 }finally{repository.close();}
});

test('model cannot invent targets, code, or authority; approvals are session bound and one-use',()=>{
 const repository=openRepository();
 try{
  const store=createProposalStore(repository),scope={embeddingId:'A',sessionId:'one'};
  const snapshot={revision:1,fields:[{ref:'r1f0',label:'Name',type:'text'}]};
  for(const action of [{type:'click',ref:'r1f0',value:''},{type:'fill',ref:'r1f9',value:'wrong'},{type:'fill',ref:'r1f0',value:'ok',code:'evil'}]){
    assert.throws(()=>store.prepare(scope,snapshot,{message:'test',actions:[action]}));
  }
  const proposal=store.prepare(scope,snapshot,{message:'Review',actions:[{type:'fill',ref:'r1f0',value:'Demo'}]});
  assert.throws(()=>store.consume({...scope,sessionId:'two'},{id:proposal.id,revision:1,approved:true}));
  assert.throws(()=>store.consume(scope,{id:proposal.id,revision:2,approved:true}));
  assert.throws(()=>store.consume(scope,{id:proposal.id,revision:1,approved:false}));
  assert.equal(store.consume(scope,{id:proposal.id,revision:1,approved:true}).actions[0].value,'Demo');
  assert.throws(()=>store.consume(scope,{id:proposal.id,revision:1,approved:true}));
 }finally{repository.close();}
});
