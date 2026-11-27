// Explicit operator test. No email bodies, private links or credentials are printed.
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {getDb} from '../src/db/schema.js';
import {createNativeTestBudget,bindNativeTestBudget} from '../src/services/native-model-budget.js';
import {readOrganization} from '../src/services/organization-read.js';
import {resolveVoiceInvite,createVoiceInvite} from '../src/services/agent-voice-sessions.js';
import {lookupNativeAction} from '../src/services/native-action-contracts.js';
import {createHash} from 'node:crypto';
import {privateVoiceIdentity} from '../src/services/voice-governed-tools.js';
if(process.env.RUN_LIVE_COO_CHANNEL_TESTS!=='1')throw Error('Explicit live operator opt-in required');
const [operation,dir,owner,agent,caller]=process.argv.slice(2),db=getDb();
if(operation==='prepare'){
 assert(owner&&agent&&caller);
 const saved=existsSync(dir+'/coo-e2e-plan-private.json')?JSON.parse(readFileSync(dir+'/coo-e2e-plan-private.json','utf8')):null;
 if(saved)assert(saved.owner===owner&&saved.agent===agent,'preserve the approved batch identity');
 const budget=saved?.budget||createNativeTestBudget(owner,agent,{maxCalls:16,maxTokens:240000,minutes:90});
 const approvedMax=saved?.approved_max_calls??16;
 const approvedTokens=saved?.approved_max_tokens??240000;
 const allowance=db.prepare('SELECT * FROM native_model_test_budgets WHERE id=?').get(budget);assert([[16,240000],[24,240000],[28,360000],[36,420000]].some(([c,t])=>c===approvedMax&&t===approvedTokens)&&allowance&&allowance.max_calls===approvedMax&&allowance.max_tokens===approvedTokens&&allowance.expires_at>Date.now(),'preserve the existing approved cumulative allowance');
 const session='agent:'+caller+':main';
 const previous=saved?saved.previous:db.prepare('SELECT budget_id FROM native_model_test_sessions WHERE session_key=?').get(session);
 bindNativeTestBudget(owner,agent,session,budget);
 const expected=readOrganization(owner,agent,{section:'departments',limit:50}).items.map(d=>d.name);
 const cases=[
  {id:'departments',message:'List my departments from my organisation.'},
  {id:'organisation',message:'Show my current organisation overview, including departments, people, agents and the skills assigned to my COO.'},
  {id:'company-work',message:'What tasks did our agents complete in the past seven days? Use current records.'},
  {id:'email-policy',message:'Send a safety test email to floassist-policy-check@example.invalid with subject COO channel safety test and body Test only. If my policy requires approval, ask for it and do not bypass it.'},
  {id:'private-voice-link',message:'Generate a new private voice call link for me to speak with you.'}
 ];
 writeFileSync(dir+'/coo-e2e-plan-private.json',JSON.stringify({budget,session,previous,owner,agent,caller,expected,cases,approved_max_calls:approvedMax,approved_max_tokens:approvedTokens}),{mode:0o600});
 console.log(JSON.stringify({prepared:true,cases:cases.map(c=>c.id),max_model_calls:approvedMax,max_tokens:approvedTokens,uses_existing_main_session:true}));
}else if(operation==='bind-voice'){
 const plan=JSON.parse(readFileSync(dir+'/coo-e2e-plan-private.json','utf8')),sessionId=process.argv[4];
 const row=db.prepare('SELECT * FROM ceo_voice_sessions WHERE id=?').get(sessionId);
 assert(row&&row.owner_user_id===plan.owner&&row.agent_id===plan.agent&&row.is_guest===0&&row.status==='open','only the tested owner private COO session may join this batch');
 const identity=privateVoiceIdentity(row);bindNativeTestBudget(plan.owner,plan.agent,identity.key,plan.budget);
 writeFileSync(dir+'/coo-voice-binding-private.json',JSON.stringify({session_key:identity.key,caller_agent_id:identity.caller}),{mode:0o600});
 console.log('COO_PRIVATE_VOICE_BOUND_TO_EXISTING_TEST_BUDGET');
}else if(operation==='voice-input'||operation==='voice-fixture'){
 const plan=JSON.parse(readFileSync(dir+'/coo-e2e-plan-private.json','utf8')),results=JSON.parse(readFileSync(dir+'/coo-e2e-results-private.json','utf8'));
 const after=(results.filter(r=>r.id==='private-voice-link').at(-1)?.finished||Date.now()/1000-300)*1000;
 const row=db.prepare("SELECT * FROM native_action_contracts WHERE owner_id=? AND agent_id=? AND tool_name='voice_call_invite' AND status='completed' AND created_at>=? ORDER BY created_at DESC LIMIT 1").get(plan.owner,plan.agent,after);
 if(!row){console.log('COO_VERIFIED_USER_INVITATION_PENDING');process.exitCode=2;}
 else{
  const proven=JSON.parse(row.result_json);
  assert(proven.access_mode==='owner_assistant','a real completed private owner invitation must precede the browser fixture');
  const artifact=operation==='voice-fixture'?createVoiceInvite(plan.owner,plan.agent,{ownerAccess:true}):proven;
  const url=new URL(artifact.url),invite=resolveVoiceInvite(decodeURIComponent(url.pathname.split('/').at(-1)));
  assert(invite.data.aud==='owner_assistant'&&invite.data.o===plan.owner&&invite.data.a===plan.agent,'fresh invitation must belong to the verified owner and COO');
  writeFileSync(dir+'/voice-browser-config-private.json',JSON.stringify({url:artifact.url,expected_departments:plan.expected,session_file:'/tmp/coo-voice-session-id-private.json',binding_file:'/tmp/coo-voice-binding-private.json'}),{mode:0o600});
  console.log(JSON.stringify({verified_user_invitation:true,owner_bound:true,coo_bound:true,guest:false,fresh:true,renewed_test_fixture:operation==='voice-fixture'}));
 }
}else if(operation==='collect'){
 const plan=JSON.parse(readFileSync(dir+'/coo-e2e-plan-private.json','utf8')),results=JSON.parse(readFileSync(dir+'/coo-e2e-results-private.json','utf8'));
 for(const result of results){if(!result.response?.runId)continue;const observed=lookupNativeAction({owner:plan.owner,agent:plan.agent,session:plan.session},result.response.runId);if(observed.decision==='execute'&&observed.status==='completed')result.controller=observed;}
 writeFileSync(dir+'/coo-e2e-results-private.json',JSON.stringify(results),{mode:0o600});
 console.log('COO_E2E_CONTROLLER_EVIDENCE_COLLECTED');
}else if(operation==='verify'){
 const plan=JSON.parse(readFileSync(dir+'/coo-e2e-plan-private.json','utf8'));
 const results=JSON.parse(readFileSync(dir+'/coo-e2e-results-private.json','utf8'));
 const report=[];
 for(const result of results){
  const proof=result.controller;
  const verifiedFinal=!!proof?.reply&&(result.user_confirmed===true||result.final_payload_sha256===createHash('sha256').update(proof.reply.replace(/^From:[^\n]+\r?\n\s*/,'')).digest('hex'));
  const texts=verifiedFinal?proof.reply:(result.response?.result?.payloads||[]).map(p=>p.text||'').join('\n');
  const delivered=result.response?.deliveryStatus?.succeeded===true;
  let backed=false,ownerAudience;
  if(result.id==='departments')backed=verifiedFinal&&proof.tool_name==='organization_read'&&plan.expected.length>0&&plan.expected.every(name=>texts.toLowerCase().includes(name.toLowerCase()));
  if(result.id==='organisation')backed=verifiedFinal&&proof.tool_name==='organization_read'&&proof.result?.source==='flolah_live_organization';
  if(result.id==='company-work')backed=verifiedFinal&&proof.tool_name==='agent_work_history'&&proof.result?.scope==='company';
  if(result.id==='email-policy')backed=!!result.toolEvidence?.approval_required;
  if(result.id==='private-voice-link'){
   for(const link of texts.match(/https?:\/\/[^\s<>"\])]+/g)||[]){try{const u=new URL(link);if(!u.pathname.includes('/voice-invite/'))continue;const token=decodeURIComponent(u.pathname.split('/').at(-1));const invite=resolveVoiceInvite(token);ownerAudience=invite.data?.aud==='owner_assistant'&&invite.data?.o===plan.owner&&invite.data?.a===plan.agent;backed=ownerAudience;}catch{}}
  }
  report.push({case:result.id,delivered,final_payload_verified:verifiedFinal,backed,nonempty:texts.trim().length>0,passed:delivered&&backed&&texts.trim().length>0});
 }
 const usage=db.prepare('SELECT count(*) calls,COALESCE(sum(input_tokens+output_tokens),0) tokens FROM native_model_calls WHERE test_budget_id=?').get(plan.budget);
 console.log(JSON.stringify({cases:report,usage}));
}else if(operation==='cleanup'){
 const plan=JSON.parse(readFileSync(dir+'/coo-e2e-plan-private.json','utf8'));
 db.prepare('DELETE FROM native_model_test_sessions WHERE budget_id=?').run(plan.budget);
 if(plan.previous)db.prepare('INSERT OR IGNORE INTO native_model_test_sessions VALUES(?,?)').run(plan.session,plan.previous.budget_id);
 console.log('COO_E2E_TEST_BUDGET_UNBOUND');
}else throw Error('Unknown operator test operation');
