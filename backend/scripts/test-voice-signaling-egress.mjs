import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
process.env.AGENT_OS_DATA_DIR=mkdtempSync(join(tmpdir(),'voice-egress-'));
process.env.LITELLM_BASE_URL='http://proxy-fixture:4000/v1';process.env.LITELLM_MASTER_KEY='proxy-master-fixture';
const {connectVoiceRealtime,ensureVoiceSessionsSchema}=await import('../src/services/agent-voice-sessions.js');
const {getDb}=await import('../src/db/schema.js');ensureVoiceSessionsSchema();
const token='session-fixture';getDb().prepare('INSERT INTO ceo_voice_sessions(id,owner_user_id,agent_id,token_hash,expires_at) VALUES (?,?,?,?,?)').run('fixture','owner','agent',createHash('sha256').update(token).digest('hex'),new Date(Date.now()+60000).toISOString());
let calls=0;const old=globalThis.fetch;globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'http://proxy-fixture:4000/v1/realtime/calls');assert.equal(init.headers.Authorization,'Bearer encrypted-ephemeral-fixture');assert.ok(!JSON.stringify(init).includes('proxy-master-fixture'));assert.equal(init.body,'v=0\r\na=offer');return new Response('v=0\r\na=answer',{headers:{'Content-Type':'application/sdp'}});};
try{
 await assert.rejects(connectVoiceRealtime({sessionToken:'wrong',authorization:'Bearer fixture',sdp:'v=0'}),e=>e.status===401);
 await assert.rejects(connectVoiceRealtime({sessionToken:token,authorization:'Bearer fixture',sdp:'bad'}),e=>e.status===400);
 const r=await connectVoiceRealtime({sessionToken:token,authorization:'Bearer encrypted-ephemeral-fixture',sdp:'v=0\r\na=offer'});assert.match(await r.text(),/answer/);assert.equal(calls,1);
 getDb().prepare("UPDATE ceo_voice_sessions SET status='ended'").run();
 await assert.rejects(connectVoiceRealtime({sessionToken:token,authorization:'Bearer fixture',sdp:'v=0'}),e=>e.status===401);assert.equal(calls,1);
 console.log('VOICE_SIGNALING_EGRESS_OK: active session required, bounded SDP, proxy-only signaling, ephemeral credentials only, ended session denied');
}finally{globalThis.fetch=old;getDb().close();}
