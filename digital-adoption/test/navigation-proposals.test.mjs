import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {createProposalStore} from '../src/proposals.mjs';
test('navigation may only select one observed safe link, never arbitrary URLs or mixed writes',()=>{
 const repository=openRepository();try{
  const store=createProposalStore(repository),scope={sessionId:'one',embeddingId:'one'};
  const snapshot={revision:1,fields:[{ref:'r1f0',label:'Name',type:'text'}],links:[{ref:'r1n0',label:'Opportunity',path:'/opportunity'}]};
  const proposal=store.prepare(scope,snapshot,{message:'Open opportunity',actions:[{type:'navigate',ref:'r1n0'}]});
  assert.equal(proposal.actions[0].path,'/opportunity');
  assert.throws(()=>store.prepare(scope,snapshot,{message:'bad',actions:[{type:'navigate',ref:'r1n8'}]}));
  assert.throws(()=>store.prepare(scope,snapshot,{message:'bad',actions:[{type:'navigate',ref:'r1n0',path:'https://other.example'}]}));
  assert.throws(()=>store.prepare(scope,snapshot,{message:'bad',actions:[{type:'navigate',ref:'r1n0'},{type:'fill',ref:'r1f0',value:'bad'}]}));
 }finally{repository.close();}
});
