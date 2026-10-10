import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectorDiscoveryResult } from '../src/services/connector-discovery.js';

assert.equal(connectorDiscoveryResult([{id:'tea-fixture',app_id:'gmail'}], 'news').actions.length, 0);
assert.equal(connectorDiscoveryResult([{id:'gmail.get_message',app_id:'gmail',description:'Read email'}], 'AI').actions.length, 0, 'AI must not match the middle of email');
const dir=mkdtempSync(join(tmpdir(),'flolah-connector-discovery-'));
process.env.AGENT_OS_DATA_DIR=dir;
process.env.OPENCONNECTOR_URL='https://connector.invalid';
process.env.OPENCONNECTOR_ADMIN_TOKEN='fixture-admin';
const originalFetch=globalThis.fetch;
let db;
try {
  db=(await import('../src/db/schema.js')).initDb();
  const {upsertOpenConnectorLink, searchConnectorActions}=await import('../src/services/openconnector.js');
  const {setAgentConnectorActionGrants,assertCallerMayExecuteConnectorAction}=await import('../src/services/connector-action-grants.js');
  db.prepare("INSERT INTO agents(id,name,role,openclaw_agent_id,agent_type,owner_user_id) VALUES ('discovery-test','Discovery','Test','discovery-test','custom','ceo-a')").run();
  db.prepare("INSERT INTO platform_users(id,email,password_hash,name,role) VALUES ('ceo-a','fixture@example.test','fixture','Test','ceo')").run();
  upsertOpenConnectorLink('ceo-a',{runtime_token:'fixture-a',connection_name:'alias-a'});
  setAgentConnectorActionGrants('discovery-test',['gmail.get_message','hackernews.get_latest_posts']);
  const requests=[];
  globalThis.fetch=async(url,options)=>{
    requests.push({url,...options});
    if(url.endsWith('/api/connections'))return Response.json([
      {service:'gmail',connectionName:'alias-a',configured:true},
      {service:'slack',connectionName:'another-owner',configured:true},
    ]);
    const service=new URL(url).searchParams.get('service');
    return Response.json({data: service==='gmail' ? [
      {id:'gmail.get_message',service:'gmail',description:'Get mailbox message'},
      {id:'gmail.send_email',service:'gmail',description:'Send email'},
    ] : [
      {id:'hackernews.get_latest_posts',service:'hackernews',description:'Get latest Hacker News posts',inputSchema:{type:'object',properties:{query:{type:'string'}}}},
      {id:'hackernews.search_posts',service:'hackernews',description:'Search Hacker News posts'},
    ]});
  };
  const news=await searchConnectorActions('ceo-a','Find me latest AI news',{source:'discovery-test'});
  assert.equal(news.actions[0].action_id,'hackernews.get_latest_posts');
  assert.equal(news.actions[0].granted,true);
  assert.equal(news.actions[0].available,true,'public connector needs no OAuth');
  assert.equal(news.actions.find(a=>a.id==='hackernews.search_posts').granted,false);
  assert.ok(!requests.some(r=>r.url.includes('service=slack')),'never discover another owner connection');
  assert.ok(requests.filter(r=>r.url.includes('/v1/')).every(r=>r.headers.Authorization==='Bearer fixture-a'&&r.headers['x-oo-connector-alias']==='alias-a'));
  assert.match(news.selection_guidance,/tea-/);
  assert.ok(news.task_guidance.some(t=>t.includes('updated_at')));
  assert.deepEqual(news.actions[0].example_input.tags,['story']);
  assert.ok(Object.keys(news).indexOf('task_guidance') < Object.keys(news).indexOf('actions'),'guidance survives leading payload truncation');
  assert.ok(news.actions.every(a=>!a.raw));
  const mail=await searchConnectorActions('ceo-a','Send email',{source:'discovery-test',appId:'gmail'});
  assert.equal(mail.actions[0].action_id,'gmail.send_email');
  assert.equal(mail.actions[0].granted,false);
  assert.match(mail.actions[0].blocked_reason,/not granted/);
  assert.equal(assertCallerMayExecuteConnectorAction('discovery-test','gmail.send_email').ok,false);
  assert.equal(assertCallerMayExecuteConnectorAction('discovery-test','tea-fixture').ok,false);
  const {actionPolicyMiddleware}=await import('../src/services/action-policy.js');
  let denial;
  actionPolicyMiddleware({method:'POST',path:'/connector-execute-action',body:{tool_name:'connector_execute_action',action_id:'tea-fixture'}},
    {status(code){assert.equal(code,400);return this;},json(body){denial=body;}},()=>assert.fail('tracking ID must fail before policy/transport'));
  assert.equal(denial.failure_class,'invalid_tool_arguments');
  assert.equal((await searchConnectorActions('ceo-a','unmatchedword',{source:'discovery-test'})).actions.length,0);
  console.log('CONNECTOR_DISCOVERY_OK: contextual actions, exact IDs, public availability, owner isolation, grant denials');
} finally {globalThis.fetch=originalFetch;db?.close();rmSync(dir,{recursive:true,force:true});}
