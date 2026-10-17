import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {openRepository} from '../src/repository.mjs';
import {createOwnerIdentity} from '../src/owner-identity.mjs';
import {createManagement} from '../src/management.mjs';
import {createControlPlane} from '../src/control-plane.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createAdoptionServer} from '../src/server.mjs';
test('owner HTTP routes isolate registrations, deny admin and foreign origins, and logout',async()=>{
 const repository=openRepository(),authority=new SessionAuthority({repository});let mail;
 const ownerIdentity=createOwnerIdentity(repository,{send:async value=>{mail=value;}}),platformOrigin='https://login.example.com';
 const control=createControlPlane(repository,authority);
 const ownerManagement=createManagement({authenticate:cookie=>ownerIdentity.authenticate(cookie),control,platformOrigin});
 const server=createAdoptionServer({authority,ownerIdentity,ownerManagement,platformOrigin});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,input={},cookie='',origin=platformOrigin)=>fetch(base+'/v1/owner/'+path,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(input)});
 const signIn=async email=>{const challenge=await(await post('start',{email})).json();const code=mail.text.match(/code is (\d{6})/)[1];const response=await post('confirm',{...challenge,code});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
 try{
  assert.equal((await post('start',{email:'one@example.com'},'','https://foreign.example.com')).status,403);
  assert.equal((await post('manage/websites')).status,403);
  const first=await signIn('one@example.com'),second=await signIn('two@example.com');
  assert.equal((await post('manage/register',{origin:'https://customer.example.com',environment:'staging'},first)).status,200);
  const mine=await(await post('manage/websites',{},first)).json();assert.equal(mine.websites.length,1);
  const theirs=await(await post('manage/websites',{},second)).json();assert.equal(theirs.websites.length,0);
  assert.equal((await post('manage/tokens',{id:mine.websites[0].id},first)).status,403);
  assert.equal((await post('manage/verify',{id:mine.websites[0].id},second)).status,403);
  assert.equal((await post('logout',{},first)).status,200);assert.equal((await post('manage/websites',{},first)).status,403);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));repository.close();}
});
