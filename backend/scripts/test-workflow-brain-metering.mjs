import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'brain-meter-'));
process.env.AGENT_OS_DATA_DIR=join(root,'data');process.env.OPENCLAW_DIR=join(root,'openclaw');
const original=globalThis.fetch;
let db;
try {
 const {initDb}=await import('../src/db/schema.js');db=initDb();
 const {withBrainMetering,fetchBrainModel}=await import('../src/services/workflow-brain-metering.js');
 for(const owner of ['owner-a','owner-b']) db.prepare("INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES (?,?,'fixture',?,'ceo',1)").run(owner,owner+'@example.test',owner);
 let count=0;
 globalThis.fetch=async(url,init)=>{
  assert.equal(url,'https://brain-provider.invalid/v1/chat/completions');
  assert.equal(init.headers.Authorization,'Bearer private-fixture');count++;
  return count===3?new Response(JSON.stringify({error:{message:'fixture failure'}}),{status:503}):new Response(JSON.stringify({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:100,completion_tokens:5}}));
 };
 const run=owner=>withBrainMetering({ownerId:owner,memberKey:'workflow:fixture',runId:'run-fixture',nodeId:'brain-fixture'},()=>fetchBrainModel('https://brain-provider.invalid/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer private-fixture'},body:JSON.stringify({model:'chosen-brain-model',messages:[{role:'user',content:'private prompt'}]})}));
 await run('owner-a');await run('owner-a');await run('owner-b');
 const events=db.prepare("SELECT * FROM model_route_events WHERE source='workflow_brain'").all();
 assert.equal(events.length,3);assert.equal(events.filter(e=>e.outcome==='success').length,2);
 assert.equal(events.filter(e=>e.owner_user_id==='owner-b'&&e.outcome==='error').length,1);
 const usage=db.prepare("SELECT * FROM token_usage WHERE source='workflow_brain'").all();
 assert.equal(usage.length,3);assert.equal(usage.filter(u=>!u.tokens_estimated).length,2);
 for(const event of events)assert.ok(usage.some(u=>u.trace_id===event.id),'request-to-usage correlation');
 assert.ok(!JSON.stringify(events).includes('private'));
 assert.equal(count,3,'no extra requests or retries');
 console.log('BRAIN_REQUEST_METERING_OK: direct endpoint retained, each round counted, failed request retained, measured/estimated usage distinguished, owner and request correlation');
} finally {globalThis.fetch=original;db?.close();rmSync(root,{recursive:true,force:true});}
