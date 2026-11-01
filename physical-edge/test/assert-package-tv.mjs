import {readFileSync,existsSync} from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const path=process.argv[2];const wait=()=>new Promise(r=>setTimeout(r,100));for(let i=0;i<200&&!existsSync(path);i++)await wait();const access=JSON.parse(readFileSync(path,'utf8'));
async function api(path,body){const response=await fetch(access.cloudUrl+'/api/physical'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+access.sessionToken,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(response.status,200);return response.json();}
async function until(fn){for(let i=0;i<80;i++){const result=await fn();if(result)return result;await wait();}throw Error('Packaged TV test timeout');}
await until(async()=>{const state=await api('');return state.hubs[0].candidates.some(c=>c.id==='lab-tv');});
const asset=await api('/entities',{hubId:access.hubId,candidateId:'lab-tv',actions:{set_power:'autonomous',launch_app:'autonomous',select_channel:'autonomous',navigate:'autonomous'}});
for(const [action,input]of [['set_power',{on:true}],['launch_app',{app:'youtube'}],['select_channel',{channel:5}],['navigate',{command:'DPAD_DOWN'}],['set_power',{on:false}]]){
 const op=await api('/operations',{entityId:asset.id,action,input,idempotencyKey:randomUUID(),timeoutMs:5000});const result=await until(async()=>{const result=await api('/operations/'+op.id);return result.status==='completed'?result:null;});assert.ok(result.evidence);
}
console.log('DOWNLOADABLE_PACKAGE_TV_PASS: real HTTP + WS + MQTT; virtual power-on/app/channel/navigation/power-off; no real TV or production tenant');
