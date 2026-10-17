import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionAuthority} from '../src/session-authority.mjs';
import {openRepository} from '../src/repository.mjs';
import {createProposalStore} from '../src/proposals.mjs';
test('clearing chat isolates sessions, invalidates proposals, and preserves shared sources',()=>{
 const repository=openRepository(),authority=new SessionAuthority({repository}),proposals=createProposalStore(repository),origin='https://example.test';
 try{
  const installation=authority.registerApproved({embeddingId:'synthetic',origins:[origin],expiresAt:Date.now()+60_000});
  const a={...authority.initialize({...installation,origin}),origin},b={...authority.initialize({...installation,origin}),origin};
  authority.appendMessage({...a,text:'A'});authority.appendMessage({...b,text:'B'});repository.map('sources').set('fixture',{text:'shared'});
  const proposal=proposals.prepare(authority.context(a),{revision:1,fields:[{ref:'r1f0',label:'Name',type:'text'}]},{message:'Review',actions:[{type:'fill',ref:'r1f0',value:'Synthetic'}]});
  authority.clearConversation(a);assert.deepEqual(authority.history(a),[]);assert.equal(authority.history(b)[0].text,'B');assert.equal(repository.map('sources').get('fixture').text,'shared');
  assert.throws(()=>proposals.consume(authority.context(a),{id:proposal.id,revision:1,approved:true}));
 }finally{repository.close();}
});
