import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createPrivateTasks} from '../src/private-tasks.mjs';
import {createAdoptionServer} from '../src/server.mjs';

test('visitor capability limits disclose the effective website/task capacity separately from session allowance',async()=>{
 const root=await mkdtemp(join(tmpdir(),'adoption-upload-caps-')),origin='http://127.0.0.1',authority=new SessionAuthority({development:true}),site={id:'upload-caps',organizationId:'owner',origin,verified:true,status:'approved',taskPolicy:{attachments:true,limits:{files:2,taskBytes:4096,fileBytes:1024}}};
 const tasks=await createPrivateTasks({root,website:()=>site,activeScope:s=>authority.activeScope(s),limits:{files:6,taskBytes:8192,fileBytes:2048}}),server=createAdoptionServer({authority,privateTasks:tasks,taskWebsite:()=>site});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const installation=authority.registerApproved({embeddingId:site.id,origins:[origin],expiresAt:Date.now()+60000}),session=authority.initialize({...installation,origin}),r=await fetch(`http://127.0.0.1:${server.address().port}/v1/capabilities`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+session.sessionToken},body:'{}'}),data=await r.json();
  assert.equal(r.status,200);assert.equal(data.uploadLimits.taskFiles,2);assert.equal(data.uploadLimits.taskBytes,4096);assert.equal(data.uploadLimits.fileBytes,1024);assert.ok(data.uploadLimits.sessionFiles>data.uploadLimits.taskFiles);site.taskPolicy.limits={};const globalResponse=await fetch(`http://127.0.0.1:${server.address().port}/v1/capabilities`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+session.sessionToken},body:'{}'}),global=await globalResponse.json();assert.equal(global.uploadLimits.taskFiles,6);assert.equal(global.uploadLimits.taskBytes,8192);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await tasks.close();await rm(root,{recursive:true,force:true});}
});
