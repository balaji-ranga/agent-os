import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { createFloAssist,normalizePhone } from '../src/services/floassist/core.js';
import { createReminder,listReminders,cancelReminder,tickReminders,tickFloAssistNotifications,inQuietHours,floAssistScheduleGate,floAssistDeliveryGate } from '../src/services/floassist/runtime.js';
const product=JSON.parse(readFileSync(new URL('../src/services/floassist/product.json',import.meta.url),'utf8'));
let checks=0;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const rejects=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);checks++;};
const throws=(fn,code)=>{assert.throws(fn,e=>e.code===code);checks++;};
const db=new Database(':memory:');
db.exec('CREATE TABLE platform_users(id TEXT PRIMARY KEY,enabled INTEGER)');
const owners=new Map(),policies=[],provisioned=[],paused=[];
let clock=Date.parse('2026-10-24T04:00:00Z'),paired=false,number='+6599999999',connected=false,emailError=false,provisionError=false;
const a={settings:()=>({}),legal:()=>({terms_version:'test',privacy_version:'test'}),managementUrl:()=>'/manage',
  findOwner:({id,email})=>id?owners.get(id):[...owners.values()].find(u=>u.email===email),
  newOtp:()=>({code:'123456',codeHash:'fixture-hash'}),matchesOtp:(c,h)=>c==='123456'&&h==='fixture-hash',
  sendEmail:async()=>{if(emailError)throw Error('SMTP');},
  verifyMfa:(u,code)=>{if(u.totp&&code!=='654321')throw Object.assign(Error('MFA'),{code:'mfa_required'});},
  createOwner:async r=>{const u={id:r.email,email:r.email,mobile:r.phone,role:'ceo',enabled:true};owners.set(u.id,u);db.prepare('INSERT INTO platform_users VALUES (?,1)').run(u.id);return u;},
  resolveCoo:()=>({id:'fixture-coo'}),assertCoo:(_owner,id)=>assert.equal(id,'fixture-coo'),
  policy:()=>[{family:'read',label:'Read',mode:'autonomous'}],setPolicy:(...args)=>policies.push(args),
  channelView:()=>({connected:paired,number:paired?number:null}),qr:async()=>({connected:paired}),
  connections:async(_owner,ids)=>ids.map(id=>({id,connected})),connect:async(owner,id)=>({owner,id}),
  provision:async p=>{if(provisionError)throw Error('fixture provisioning failed');provisioned.push(p.owner_id);},pause:async(p,status)=>paused.push([p.owner_id,status])};
const s=createFloAssist({db,product,adapters:a,now:()=>clock});
const input={email:'first@example.test',phone:'+65 8123 4567',country:'SG',accept_terms:true,whatsapp_opt_in:true};
try{
  check(normalizePhone(input.phone),'+6581234567','international normalization');throws(()=>normalizePhone('81234567'),'invalid_phone');
  await rejects(()=>s.start({...input,country:'US'}),'country');await rejects(()=>s.start({...input,accept_terms:false}),'consent');await rejects(()=>s.start({...input,email:'bad'}),'email');
  check(s.publicConfig().privacy.includes('does not promise zero retention'),true,'honest privacy');
  emailError=true;await rejects(()=>s.start(input),'email_unavailable');check(db.prepare('SELECT count(*) AS n FROM floassist_verifications').get().n,0,'failed email leaves no usable challenge');emailError=false;
  const {session_token:t}=await s.start(input);throws(()=>s.session(t),'session_expired');
  await rejects(()=>s.verify(t,'000000'),'invalid_code');
  const v=await s.verify(t,'123456');check(v.status,'onboarding','new enrollment');check(policies.length,1,'new account gets advisory only once');
  check(policies[0][2],{preset:'advisory',financial:'prohibited'},'safe defaults');
  check(s.session(t).owner_id,input.email,'restricted identity');check(await s.verify(t,'123456'),v,'lost response replay is idempotent');
  const raw=db.prepare('SELECT token_hash FROM floassist_access').get().token_hash;check(raw===t,false,'tokens hashed');
  await rejects(()=>s.activate(input.email),'not_paired');
  await s.save(input.email,{connectors:['gmail'],responsibilities:['briefing'],timezone:'Asia/Kolkata'});
  await rejects(()=>s.save(input.email,{connectors:['evil']}),'selection');await rejects(()=>s.save(input.email,{timezone:'not/a/timezone'}),'timezone');await rejects(()=>s.save(input.email,{quiet_start:'25:00'}),'time');
  await rejects(()=>s.connect(input.email,'onedrive'),'connector');check((await s.connect(input.email,'gmail')).owner,input.email,'OAuth owner comes from profile');
  paired=true;number=input.phone.replaceAll(' ','');await rejects(()=>s.activate(input.email),'separate_number');number=null;await rejects(()=>s.activate(input.email),'identity_pending');number='+6599999999';
  await rejects(()=>s.activate(input.email),'connectors_pending');connected=true;provisionError=true;await assert.rejects(()=>s.activate(input.email));checks++;check(s.view(input.email).status,'onboarding','failed provision cannot claim active');provisionError=false;
  check((await s.activate(input.email)).status,'active','activation');
  const again=await s.start(input);await s.verify(again.session_token,'123456');check(policies.length,1,'existing COO policy preserved');check(s.view(input.email).preferences.connectors,['gmail'],'existing preferences preserved');
  owners.get(input.email).totp=true;const mfa=await s.start(input);await rejects(()=>s.verify(mfa.session_token,'123456'),'mfa_required');await s.verify(mfa.session_token,'123456','654321');checks++;
  const mismatch=await s.start({...input,phone:'+6581111111'});await rejects(()=>s.verify(mismatch.session_token,'123456','654321'),'phone_mismatch');
  const wrong=await s.start(input);for(let i=0;i<product.defaults.challenge_attempts;i++)await rejects(()=>s.verify(wrong.session_token,'000000'),'invalid_code');await rejects(()=>s.verify(wrong.session_token,'123456'),'attempts');
  const other=await s.start({...input,email:'second@example.test',phone:'+628123456789'});await s.verify(other.session_token,'123456');check(s.session(other.session_token).owner_id,'second@example.test','second owner isolated');
  owners.get(input.email).enabled=false;throws(()=>s.session(t),'account_unavailable');owners.get(input.email).enabled=true;
  await s.setStatus(input.email,'paused');check(paused.at(-1),[input.email,'paused'],'pause adapter scoped');check(s.view(input.email).status,'paused','pause persisted');await s.setStatus(input.email,'active');
  const prefs={...s.view(input.email).preferences,timezone:'Asia/Singapore',quiet_start:'22:00',quiet_end:'08:00'};
  check(inQuietHours(prefs,new Date('2026-10-24T16:00:00Z')),true,'overnight quiet');check(inQuietHours(prefs,new Date('2026-10-24T00:00:00Z')),false,'quiet boundary');check(inQuietHours({...prefs,quiet_start:'09:00',quiet_end:'09:00'}),false,'equal quiet times disabled');
  check(floAssistScheduleGate({source:'existing'},new Date(clock),db),{ok:true},'existing schedules untouched');
  const schedule={source:'floassist:briefing',owner_user_id:input.email,agent_id:'fixture-coo'};
  check(floAssistScheduleGate(schedule,new Date(clock),db).ok,true,'active daytime checks');
  check(floAssistScheduleGate({...schedule,source:'floassist:conflicts'},new Date(clock),db).reason,'floassist_source_unavailable','Gmail cannot enable calendar checks');
  await s.setStatus(input.email,'paused');check(floAssistScheduleGate(schedule,new Date(clock),db).ok,false,'paused checks blocked');await s.setStatus(input.email,'active');
  const reminderInput={request_key:'message-1',text:'Call Sam',due_at:new Date(clock+1000).toISOString()};
  const r=createReminder(db,input.email,reminderInput,clock);check(createReminder(db,input.email,reminderInput,clock).id,r.id,'reminder retry dedupe');
  check(r.timezone,'Asia/Kolkata','receipt uses owner timezone');check(r.due_local.includes('GMT+5:30'),true,'receipt formats India offset');check(listReminders(db,input.email)[0].due_local,r.due_local,'list uses local receipt');
  await s.save(input.email,{timezone:'Asia/Singapore'});check(listReminders(db,input.email)[0].due_local.includes('GMT+8'),true,'Singapore display follows saved timezone');
  await s.save(input.email,{timezone:'Asia/Jakarta'});check(listReminders(db,input.email)[0].due_local.includes('GMT+7'),true,'Indonesia display follows saved timezone');
  await s.save(input.email,{timezone:'Asia/Kolkata'});
  throws(()=>createReminder(db,input.email,{...reminderInput,text:'Different'},clock),'request_reused');
  throws(()=>createReminder(db,input.email,{...reminderInput,due_at:'2026-10-25T09:00:00'},clock),'due_at');
  throws(()=>createReminder(db,input.email,{...reminderInput,repeat_minutes:1},clock),'repeat');
  check(listReminders(db,'second@example.test').length,0,'reminder tenant isolation');throws(()=>cancelReminder(db,'second@example.test',r.id),'reminder_unavailable');
  clock+=2000;let sent=0;const send=async row=>{check(row.phone,'+6581234567','personal recipient');sent++;return {ok:true};};
  check((await tickReminders({db,send,now:clock})).sent,1,'due reminder delivered');await tickReminders({db,send,now:clock});check(sent,1,'no duplicate delivery');check(db.prepare('SELECT text FROM floassist_reminders WHERE id=?').get(r.id).text,null,'delivered content removed');
  const cancel=createReminder(db,input.email,{...reminderInput,request_key:'cancel',due_at:new Date(clock+1000).toISOString()},clock);cancelReminder(db,input.email,cancel.id);check(listReminders(db,input.email).find(x=>x.id===cancel.id).status,'cancelled','cancel persisted');
  const uncertain=createReminder(db,input.email,{...reminderInput,request_key:'uncertain',due_at:new Date(clock+1000).toISOString()},clock);clock+=2000;
  await tickReminders({db,send:async()=>{throw Error('timeout');},now:clock});check(db.prepare('SELECT status FROM floassist_reminders WHERE id=?').get(uncertain.id).status,'uncertain','ambiguous send not retried');
  await tickReminders({db,send,now:clock});check(sent,1,'ambiguous send remains unreplayed');
  check(createReminder(db,input.email,reminderInput,clock).id,r.id,'retry after due date returns original receipt');
  throws(()=>createReminder(db,input.email,{...reminderInput,due_at:new Date(clock+1000).toISOString()},clock),'request_reused');
  const recurring=createReminder(db,input.email,{request_key:'repeat',text:'Recurring',due_at:new Date(clock+1000).toISOString(),repeat_minutes:60},clock);
  clock+=10000;await tickReminders({db,send:async()=>({ok:true}),now:clock});
  const next=db.prepare('SELECT * FROM floassist_reminders WHERE id=?').get(recurring.id);check(next.status,'pending','recurring reminder stays active');check(next.due_at>clock,true,'next due advances beyond now');
  check(floAssistDeliveryGate({ownerUserId:input.email,scheduledGoalId:'existing',text:'normal'},db),{managed:false},'existing delivery untouched');
  db.prepare("INSERT INTO floassist_resources VALUES (?,'schedule','briefing','owned-schedule')").run(input.email);
  await s.save(input.email,{quiet_start:'00:00',quiet_end:'00:00'});
  check(floAssistDeliveryGate({ownerUserId:input.email,scheduledGoalId:'owned-schedule',text:'FLOASSIST_NO_UPDATE'},db).skip,true,'no-update marker silent');
  check(floAssistDeliveryGate({ownerUserId:input.email,scheduledGoalId:'owned-schedule',text:'Goal completed. Final output: FLOASSIST_NO_UPDATE — no notifications.'},db).reason,'no_update','wrapped sentinel silent');
  check(floAssistDeliveryGate({ownerUserId:input.email,scheduledGoalId:'owned-schedule',sourceKey:'agr:old:terminal',text:'Goal failed: old'},db).reason,'internal_goal_report','legacy goal reports silent');
  check(db.prepare('SELECT count(*) AS n FROM floassist_notifications').get().n,0,'suppressed reports never queue');
  const delivery={ownerUserId:input.email,scheduledGoalId:'owned-schedule',text:'New actionable deadline',sourceKey:'run-1'};
  check(floAssistDeliveryGate(delivery,db).authorizedTo,'+6581234567','scheduled delivery scoped to personal number');check(floAssistDeliveryGate(delivery,db).skip,true,'proactive dedupe');
  let notifications=0;const notify=async row=>{check(row.phone,'+6581234567','queued notification owner target');notifications++;return {ok:true};};
  const realNow=Date.now();await s.save(input.email,{quiet_start:'00:00',quiet_end:'23:59',timezone:'UTC'});
  const midday=new Date(realNow);midday.setUTCHours(12,0,0,0);
  await tickFloAssistNotifications({db,send:notify,now:midday.getTime()});check(notifications,0,'queued output waits through quiet hours');
  await s.save(input.email,{quiet_start:'00:00',quiet_end:'00:00'});await tickFloAssistNotifications({db,send:notify,now:realNow});check(notifications,1,'deferred notification delivered');
  await tickFloAssistNotifications({db,send:notify,now:realNow});check(notifications,1,'queued output delivered once');check(db.prepare('SELECT text FROM floassist_notifications WHERE source_key=?').get(input.email+':run-1').text,null,'notification content removed after delivery');
  s.logout(t);throws(()=>s.session(t),'session_expired');clock+=3*3600000;s.purge();check(db.prepare('SELECT count(*) AS n FROM floassist_access').get().n,0,'expired sessions purged');
  console.log(`FLOASSIST_OK: ${checks} checks (onboarding, existing COO, MFA, policies, QR gates, isolation, reminders, quiet hours, deduplication, privacy)`);
}finally{db.close();}
