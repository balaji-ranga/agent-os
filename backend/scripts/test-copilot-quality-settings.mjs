import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
const dir=mkdtempSync(join(tmpdir(),'copilot-quality-'));
process.env.AGENT_OS_DATA_DIR=dir;process.env.OPENCLAW_DIR=dir;process.env.OPENSEARCH_ENABLED='0';
process.env.OPENAI_PRIMARY_BASE_URL='https://maker.example/v1';process.env.OPENAI_PRIMARY_API_KEY='synthetic-private-key';process.env.OPENAI_PRIMARY_MODEL='configured-maker';
process.env.OPENAI_SECONDARY_BASE_URL='https://checker.example/v1';process.env.OPENAI_SECONDARY_API_KEY='synthetic-checker-key';process.env.OPENAI_SECONDARY_MODEL='configured-checker';
let server,db;
try {
 const schema=await import('../src/db/schema.js');db=schema.getDb();
 for(const [id,role] of [['quality-admin','admin'],['quality-ceo','ceo']])db.prepare('INSERT INTO platform_users(id,email,password_hash,name,role) VALUES (?,?,?,?,?)').run(id,id+'@synthetic.test','impossible',id,role);
 const {createSession}=await import('../src/services/auth/session.js');const admin=createSession('quality-admin').token,ceo=createSession('quality-ceo').token;
 const settings=await import('../src/services/copilot-quality-settings.js');assert.equal(settings.getCopilotQualityStatus().enabled,false);
 const router=(await import('../src/routes/admin-copilot-quality.js')).default,app=express();app.use(express.json());app.use('/admin/copilot-quality',router);server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${server.address().port}/admin/copilot-quality`;
 const request=(token,body)=>fetch(url,{method:body?'PUT':'GET',headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await request()).status,401);assert.equal((await request(ceo)).status,403);assert.equal((await request(ceo,{enabled:true,checkerMode:'platform_inactive'})).status,403);
 for(const input of [{enabled:'true',checkerMode:'platform_inactive'},{enabled:true,checkerMode:'visitor-selected'},{enabled:true,checkerMode:'platform_inactive',apiKey:'untrusted'}])assert.equal((await request(admin,input)).status,400);
 let response=await request(admin,{enabled:true,checkerMode:'platform_inactive'});assert.equal(response.status,200);let status=await response.json();assert.equal(status.enabled,true);assert.equal(status.scope,'all_websites');assert.equal(status.checker.slot,'secondary');assert.equal(status.checker.label.includes('configured-checker'),true);assert.equal(JSON.stringify(status).includes('synthetic-checker-key'),false);
 assert.deepEqual(settings.getCopilotQualitySettings(),{enabled:true,checkerMode:'platform_inactive'});
 const {setPlatformSetting}=await import('../src/services/platform-llm-settings.js');setPlatformSetting('llm_active_endpoint','secondary');status=await (await request(admin)).json();assert.equal(status.maker.slot,'secondary');assert.equal(status.checker.slot,'primary');
 response=await request(admin,{enabled:true,checkerMode:'ollama_reasoning'});status=await response.json();assert.equal(status.checker.slot,'ollama_reasoning');
 assert.equal((await request(admin,{enabled:false,checkerMode:'platform_inactive'})).status,200);assert.equal(settings.getCopilotQualitySettings().enabled,false);
 const saved=db.prepare('SELECT value FROM platform_settings WHERE key=?').get(settings.COPILOT_QUALITY_SETTING);assert.equal(JSON.parse(saved.value).enabled,false);
 console.log('PASS copilot quality: default off, admin-only GET/PUT, strict settings, persistence, global scope, dynamic slot swap, Ollama route, secrets excluded, disable restores maker-only.');
}finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}db?.close();rmSync(dir,{recursive:true,force:true});}
