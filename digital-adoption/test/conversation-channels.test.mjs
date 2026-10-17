import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionAuthority} from '../src/session-authority.mjs';
test('guide and knowledge messages keep their channel and reject cross-channel reply context',()=>{
 const authority=new SessionAuthority();const origin='https://host.test';const registration=authority.registerApproved({embeddingId:'demo',origins:[origin],expiresAt:Date.now()+3600000});
 const auth={...authority.initialize({...registration,origin}),origin};
 const guide=authority.appendMessage({...auth,text:'Fill a field'});
 const knowledge=authority.appendMessage({...auth,text:'What is the policy?',channel:'knowledge'});
 authority.appendAssistant(auth,'The policy says seven days.','knowledge');
 assert.throws(()=>authority.appendMessage({...auth,text:'Reply',channel:'knowledge',replyTo:guide.id}));
 assert.equal(authority.appendMessage({...auth,text:'Explain',channel:'knowledge',replyTo:knowledge.id}).channel,'knowledge');
 assert.equal(authority.history(auth).filter(m=>m.channel==='guide').length,1);
 assert.equal(authority.history(auth).filter(m=>m.channel==='knowledge').length,3);
});
