import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import {uiCopilotRouter} from '../src/routes/ui-copilot.js';
import {COPILOT_FORMS} from '../src/services/ui-copilot-contract.js';
import {copilotScreenControls} from '../src/services/ui-copilot-screen-specs.js';
import {copilotSaveOnly,assertCopilotWriteIntent,clearCopilotFormEdits,copilotProposalView} from '../src/services/ui-copilot-write-intent.js';
let checks=0,calls=0,behavior,actor='fixture-ceo',allowed=true;
const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++};
const screens=[{id:'profile',label:'Profile',route:'/profile'},{id:'scheduled-goals',label:'Scheduled goals',route:'/scheduled-goals'},{id:'master-data',label:'Knowledge',route:'/master-data'},{id:'crm',label:'CRM',route:'/crm'}];
const catalog={screens,forms:COPILOT_FORMS,agents:[]},controls=copilotScreenControls('/profile');
const efficiency=controls.find(f=>f.label==='Efficiency mode'),crm=controls.find(f=>f.label==='CRM'),name=controls.find(f=>f.label==='Name'),connection=controls.find(f=>f.label==='Default connection name');assert(efficiency&&crm&&name&&connection);
const options={[efficiency.id]:[{value:'no',label:'No'},{value:'yes',label:'Yes'}],[crm.id]:[{value:'none',label:'None'}]};
const good={message:'Review Efficiency mode only; saving is separate.',actions:[{type:'screen_fill',screen:'profile',values:{[efficiency.id]:'no'}}]};
const bad={message:'Prepare defaults',actions:[{type:'screen_fill',screen:'profile',values:{[efficiency.id]:'no',[crm.id]:'none',[name.id]:'Your Name'}}]};
for(const text of ['Save changes in profile','Please save my profile','Can you save the updated profile?','save','Submit this form','Now save changes','Save the scheduled goals form','Click the Save button','Save my user profile only','Save profile without changing anything else','Save profile and leave all other fields unchanged'])check(copilotSaveOnly(text,catalog),true,'pure submission intent: '+text);
for(const text of ['Change efficiency mode to No and save','Save profile with efficiency mode as No','Do not save','Does this save my profile?','Set name to "save changes"','Save CRM as None','Please save and change email to x@example.test'])check(copilotSaveOnly(text,catalog),false,'mixed edit or question is not a save-only command: '+text);
assert.throws(()=>assertCopilotWriteIntent(bad,catalog,'Change efficiency mode to No'),/explicitly requested/);checks++;
assertCopilotWriteIntent(good,catalog,'Change efficiency mode to No');checks++;
assert.throws(()=>assertCopilotWriteIntent(good,catalog,'Save changes in profile'),/save-only/);checks++;
assertCopilotWriteIntent({message:'Review',actions:[{type:'screen_fill',screen:'profile',values:{[connection.id]:'Custom'}}]},catalog,'Change default connection name to Custom');checks++;
assert.throws(()=>assertCopilotWriteIntent({message:'Review',actions:[{type:'screen_fill',screen:'profile',values:{[connection.id]:'Custom',[name.id]:'Unrequested'}}]},catalog,'Change default connection name to Custom'),/explicitly requested/);checks++;
assertCopilotWriteIntent({message:'Review',actions:[{type:'screen_fill',screen:'profile',values:{[efficiency.id]:'no',[crm.id]:'none'}}]},catalog,'Change efficiency mode to No and CRM to None');checks++;
assert.throws(()=>assertCopilotWriteIntent(bad,catalog,'Change efficiency mode to No; leave CRM unchanged'),/explicitly requested/);checks++;
assert.throws(()=>assertCopilotWriteIntent(bad,catalog,'Change Name to Alice'),/explicitly requested/);checks++;
const prior={proposal:bad,conversation:[{role:'user',text:'Save changes in profile'}]};check(copilotProposalView(prior,catalog).proposal.actions,[],'legacy unsafe save proposal cannot be restored as an executable patch');check(prior.proposal,bad,'safe read view does not mutate durable records');
const cleared=clearCopilotFormEdits({drafts:{user_profile:{name:'Old'},scheduled_goal:{title:'Keep'}},proposal:good,fill_receipts:[{type:'screen_fill',screen:'profile'},{type:'fill',form:'scheduled_goal'}]},'user_profile',catalog);
check(cleared.proposal.actions,[],'manual save invalidates native pending edits');check(cleared.fill_receipts.length,1,'only related receipts cleared');check(cleared.drafts,{scheduled_goal:{title:'Keep'}},'unrelated drafts preserved');
const savedView={...cleared,conversation:[{role:'user',text:'Save changes in profile'}]};check(copilotProposalView(savedView,catalog),savedView,'a later confirmed-save cleanup message is not overwritten by older save guidance');
const embeddedView={proposal:{message:'This application may auto-save; verify its record.',actions:[]},conversation:[{role:'user',text:'Save this form'}]};check(copilotProposalView(embeddedView,catalog),embeddedView,'safe embedded auto-save warning survives session restore');
const db=new Database(':memory:'),app=express();app.use(express.json());app.use((req,res,next)=>{req.authUser={id:actor,role:'ceo'};next()});
app.use('/test',uiCopilotRouter({database:()=>db,getCatalog:()=>allowed?catalog:{screens:[],forms:{},agents:[]},complete:async req=>{calls++;return behavior(req)}}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/test`;
async function request(path,body,method='POST'){const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
const context={screen:'profile',visible_control_ids:[efficiency.id,crm.id,name.id],visible_control_options:options};
try{
 let s=(await request('/session',{origin:'/profile'})).body;
 behavior=()=>({content:JSON.stringify(bad)});
 for(const mode of ['hybrid','guided','autofill']){
  s=(await request(`/session/${s.id}`,{version:s.version,mode},'PUT')).body;const before=calls;
  const saved=await request(`/session/${s.id}/propose`,{version:s.version,...context,message:'Save changes in profile'});
  check(saved.status,200,'save-only guidance in '+mode);check(saved.body.proposal.actions,[],'no invented defaults in '+mode);check(calls,before,'save-only command never calls a model');s=saved.body;
 }
 let attempt=0;behavior=()=>({content:JSON.stringify(++attempt===1?bad:good)});
 let p=await request(`/session/${s.id}/propose`,{version:s.version,...context,message:'Change efficiency mode to No'});check(p.status,200,'unrequested fields rejected and repaired');check(p.body.proposal.actions[0].values,good.actions[0].values,'only intended patch survives');s=p.body;
 const beforeReview=calls;
 check((await request(`/session/${s.id}/review`,{version:s.version,action:good.actions[0]})).status,200,'latest reviewed patch preflight');
 check((await request(`/session/${s.id}/review`,{version:s.version-1,action:good.actions[0]})).status,409,'superseded review denied');
 check((await request(`/session/${s.id}/review`,{version:s.version,action:bad.actions[0]})).status,400,'extra values not in approved proposal denied');
 actor='other-fixture';check((await request(`/session/${s.id}/review`,{version:s.version,action:good.actions[0]})).status,404,'review preflight tenant/actor scoped');actor='fixture-ceo';
 allowed=false;check((await request(`/session/${s.id}/review`,{version:s.version,action:good.actions[0]})).status,403,'revoked screen denied');allowed=true;
 check(calls,beforeReview,'review preflight never calls a model or submits a form');
 behavior=()=>({content:JSON.stringify(bad)});
 p=await request(`/session/${s.id}/propose`,{version:s.version,...context,message:'Change efficiency mode to No'});
 check(p.status,200,'persistent intent errors return safe clarification, not a default-filled form');check(p.body.proposal.actions,[],'no partial unrequested fields on repair exhaustion');s=p.body;
 // Legacy proposal from before the fix must fail preflight, not just hide in UI.
 const state=JSON.parse(db.prepare('SELECT state FROM ui_copilot_sessions WHERE id=?').get(s.id).state);state.proposal=bad;state.conversation=[{role:'user',text:'Save changes in profile'}];
 db.prepare('UPDATE ui_copilot_sessions SET state=? WHERE id=?').run(JSON.stringify(state),s.id);
 check((await request('/session',null,'GET')).body.session.proposal.actions,[],'restored legacy save proposal is safe');
 check((await request(`/session/${s.id}/review`,{version:s.version,action:bad.actions[0]})).status,400,'legacy save proposal cannot be approved');
 state.proposal=good;state.conversation=[{role:'user',text:'Change efficiency mode to No'}];state.drafts={scheduled_goal:{title:'Keep'}};state.fill_receipts=[{type:'screen_fill',screen:'profile',values:good.actions[0].values}];
 db.prepare('UPDATE ui_copilot_sessions SET state=? WHERE id=?').run(JSON.stringify(state),s.id);
 p=await request(`/session/${s.id}`,{version:s.version,clearDraft:'user_profile'},'PUT');check(p.body.proposal.actions,[],'native pending patch cleared even without registered draft');check(p.body.fill_receipts,[],'native receipt no longer reused after save signal');
 check(p.body.drafts.scheduled_goal.title,'Keep','unrelated setup retained');s=p.body;
 check((await request(`/session/${s.id}/review`,{version:s.version,source:'draft',action:{type:'fill',form:'scheduled_goal',values:{title:'Keep'}}})).status,200,'explicit private draft continuation preserved');
 check((await request(`/session/${s.id}/review`,{version:s.version,source:'draft',action:{type:'fill',form:'scheduled_goal',values:{title:'Invented'}}})).status,409,'draft-resume cannot invent values');
 console.log(JSON.stringify({stage:'COPILOT_SAVE_INTENT_PASS',checks,production_writes:false}));
}finally{await new Promise(r=>server.close(r));db.close();}
