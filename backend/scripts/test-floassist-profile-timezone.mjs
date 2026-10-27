import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {floAssistRuntimeContext,withFloAssistRuntimeGuidance} from '../src/services/floassist/runtime-guidance.js';
import {profileTimezoneHint} from '../../openclaw-extensions/agent-os-content-tools/profile-timezone.js';
import {rememberRuntimeChannel,runtimeChannel} from '../../openclaw-extensions/agent-os-content-tools/runtime-channel.js';
const db=new Database(':memory:');
try{
 db.exec('CREATE TABLE floassist_profiles(owner_id TEXT,agent_id TEXT,status TEXT,preferences_json TEXT)');
 const now=Date.parse('2026-10-27T13:00:00Z');
 for(const [owner,zone,time]of [['sg','Asia/Singapore','21:00'],['in','Asia/Kolkata','18:30'],['id','Asia/Jakarta','20:00']]){
  db.prepare('INSERT INTO floassist_profiles VALUES (?,? ,?,?)').run(owner,'coo','active',JSON.stringify({timezone:zone}));
  const context=floAssistRuntimeContext(db,owner,'coo',now);
  assert.equal(context.timezone,zone);assert.ok(context.local_now.includes(time));
  const hint=profileTimezoneHint(context);assert.ok(hint.includes(zone));assert.match(hint,/relative dates/);assert.match(hint,/Display UTC only when/);
  assert.ok(withFloAssistRuntimeGuidance('Existing role',db,owner,'coo').includes(`profile timezone is ${zone}`));
 }
 assert.deepEqual(floAssistRuntimeContext(db,'missing','coo',now),{enabled:false});assert.deepEqual(floAssistRuntimeContext(db,'sg','other-agent',now),{enabled:false});
 db.prepare('UPDATE floassist_profiles SET preferences_json=? WHERE owner_id=?').run(JSON.stringify({timezone:'Asia/Kolkata'}),'sg');assert.equal(floAssistRuntimeContext(db,'sg','coo',now).timezone,'Asia/Kolkata','a profile change is reflected on the next turn');
 db.prepare('UPDATE floassist_profiles SET preferences_json=? WHERE owner_id=?').run(JSON.stringify({timezone:'invalid-zone'}),'sg');assert.equal(floAssistRuntimeContext(db,'sg','coo',now).timezone_available,false);assert.match(profileTimezoneHint(floAssistRuntimeContext(db,'sg','coo',now)),/Do not assume UTC/);
 assert.equal(profileTimezoneHint({enabled:false}),'');
 rememberRuntimeChannel({sessionKey:'channel-id',channelId:'whatsapp'},now);assert.equal(runtimeChannel({sessionKey:'channel-id'},null,now+1),'whatsapp');assert.equal(runtimeChannel({channelId:'whatsapp'},null,now),'whatsapp');
 console.log('FLOASSIST_PROFILE_TIMEZONE_OK: fresh owner/agent timezone, SG/India/Indonesia, UTC conversion guidance, missing profile safety and native channelId recognition');
}finally{db.close();}
