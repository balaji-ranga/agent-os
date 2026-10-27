import {responsibilityPrompt} from './responsibilities.js';
import { readFileSync } from 'node:fs';
import { getDb } from '../../db/schema.js';
import { createFloAssist, fail, normalizePhone } from './core.js';
import { getPlatformSetting } from '../platform-llm-settings.js';
import { getLegalVersionsPublic } from '../legal-terms.js';
import { getPublicBaseUrl } from '../../config/public-url.js';
import { registerCeoUser } from '../users.js';
import { newEmailOtp, emailOtpMatches, sendUserOtpEmail, resolveUserMfa } from '../auth/mfa.js';
import { verifyTotp } from '../auth/totp.js';
import { getConnectedConnectorApps, startConnectorOAuth } from '../openconnector.js';
import { ensureTenantOpenClawAgent } from '../openclaw-tenant.js';
import { invalidateOpenClawMainSession } from '../openclaw-capability-session.js';
import { getActionFamilyPolicies, listActionPolicyOverrides, upsertActionPolicyOverride } from '../action-policy.js';
import { listAgentChannels, createAgentChannel, applyAgentChannel, getWhatsAppQrStatus, startWhatsAppQrLogin,
  waitWhatsAppQrLogin, getWhatsAppLinkedNumber, disableAgentChannel } from '../ceo-agent-channels.js';
import { createCompanySkill, listAgentSkillsCatalog } from '../agent-skills.js';
import { createScheduledGoal, updateScheduledGoal, getScheduledGoal } from '../scheduled-goals.js';
import { seedFloAssistTools } from './tools.js';
import { floAssistResponsibilityEnabled } from './runtime.js';

export const product=JSON.parse(readFileSync(new URL('./product.json',import.meta.url),'utf8'));
const db=()=>getDb();
function setting(){try{return JSON.parse(getPlatformSetting('floassist_config','{}'));}catch{return {};}}
function resource(owner,kind,key){return db().prepare('SELECT resource_id FROM floassist_resources WHERE owner_id=? AND kind=? AND resource_key=?').get(owner,kind,key)?.resource_id;}
function remember(owner,kind,key,id){db().prepare('INSERT OR REPLACE INTO floassist_resources VALUES (?,?,?,?)').run(owner,kind,key,id);}
function findOwner({id,email}){return id?db().prepare('SELECT * FROM platform_users WHERE id=?').get(id):db().prepare('SELECT * FROM platform_users WHERE email=? COLLATE NOCASE').get(email);}
export function resolveFloAssistCoo(ownerId){
  const rows=db().prepare(`SELECT a.* FROM agents a JOIN user_agents ua ON ua.agent_id=a.id AND ua.user_id=? AND ua.enabled=1 WHERE a.is_coo=1`).all(ownerId);
  if(rows.length!==1)fail(409,'coo_configuration','Your account needs one active COO. Please manage your team in Flolah.');
  return rows[0];
}
function assertCoo(ownerId,agentId){if(resolveFloAssistCoo(ownerId).id!==agentId)fail(409,'coo_changed','Your COO changed. Please update the FloAssist binding in Flolah before continuing.');}
function policy(ownerId,agentId){
  const overrides=listActionPolicyOverrides(ownerId).filter(r=>r.scope_type==='agent'&&r.scope_id===agentId&&r.enabled&&!r.expires_at&&!r.max_uses);
  return getActionFamilyPolicies(ownerId).map(r=>({...r,mode:overrides.find(o=>o.action_family===r.family)?.mode||r.mode}));
}
function setPolicy(ownerId,agentId,input={}){
  const presets={advisory:['autonomous','approval_required','prohibited','prohibited'],managerial:['autonomous','autonomous','approval_required','prohibited'],administrative:['autonomous','autonomous','approval_required','approval_required']};
  const values=presets[input.preset];
  if(!values)fail(400,'policy','Choose Advisory, Managerial or Administrative.');
  const financial=input.financial||values[3];
  if(!['autonomous','approval_required','prohibited'].includes(financial))fail(400,'policy','Choose a valid financial and destructive action policy.');
  if(input.preset!=='administrative'&&financial!=='prohibited')fail(400,'policy','Financial and destructive actions require Administrative mode.');
  db().transaction(()=>['read','write_internal','communicate_external','financial_destructive'].forEach((family,i)=>{
    upsertActionPolicyOverride(ownerId,{scope_type:'agent',scope_id:agentId,action_family:family,mode:i===3?financial:values[i],enabled:true});
  }))();
}
function channel(p){return listAgentChannels(p.owner_id,{agentId:p.agent_id}).find(c=>c.channel==='whatsapp');}
function channelView(p){
  const ch=channel(p);if(!ch)return {connected:false,number:null,status:'not_linked'};
  const q=getWhatsAppQrStatus(p.owner_id,ch.id),number=q.connected?getWhatsAppLinkedNumber(p.owner_id,p.agent_id):null;
  return {connected:q.connected,number,status:q.status,enabled:ch.status==='enabled',owned:resource(p.owner_id,'channel','whatsapp')===ch.id};
}
function privateChannel(p,ch){
  const allow=Array.isArray(ch.config.allowFrom)?ch.config.allowFrom:[];
  if(ch.config.dmPolicy!=='allowlist'||allow.length!==1||normalizePhone(allow[0])!==p.phone||ch.config.groupPolicy!=='disabled')
    fail(409,'channel_settings','Your existing COO WhatsApp channel has different access settings. In Flolah, restrict it to your personal number and disable groups, then return here.');
}
function uniqueChannelIdentity(p,ch){
  const number=getWhatsAppLinkedNumber(p.owner_id,p.agent_id);
  if(!number)return;
  const other=db().prepare("SELECT owner_user_id,agent_id FROM ceo_agent_channels WHERE channel='whatsapp' AND owner_user_id<>? AND status IN ('enabled','pairing')").all(p.owner_id);
  for(const row of other){
    let linked;
    try{linked=getWhatsAppLinkedNumber(row.owner_user_id,row.agent_id);}catch{continue;}
    if(linked===number){
      if(resource(p.owner_id,'channel','whatsapp')===ch.id)disableAgentChannel(p.owner_id,ch.id);
      fail(409,'channel_in_use','This dedicated WhatsApp number is already linked to another Flolah account. Use a separate number.');
    }
  }
}
async function qr(p,operation){
  let ch=channel(p);
  if(!ch){
    if(operation==='status')return {connected:false,status:'not_linked',qr_data_url:null};
    ch=createAgentChannel(p.owner_id,{agent_id:p.agent_id,channel:'whatsapp',config:{dmPolicy:'allowlist',allowFrom:[p.phone],groupPolicy:'disabled'}});
    remember(p.owner_id,'channel','whatsapp',ch.id);
  }
  privateChannel(p,ch);
  if(operation!=='status'&&ch.status!=='enabled'&&ch.status!=='pairing')applyAgentChannel(p.owner_id,ch.id);
  let q;
  if(operation==='start')q=await startWhatsAppQrLogin(p.owner_id,ch.id,{force:false});
  else if(operation==='wait')q=await waitWhatsAppQrLogin(p.owner_id,ch.id,{timeoutMs:10000});
  else q=getWhatsAppQrStatus(p.owner_id,ch.id);
  if(q.connected)uniqueChannelIdentity(p,ch);
  return {...channelView(p),connected:q.connected,qr_data_url:q.connected?null:q.qr_data_url,message:q.message};
}
async function connections(ownerId,selected){
  if(!selected.length)return [];
  const result=await getConnectedConnectorApps(ownerId);
  return selected.map(id=>{const app=product.connectors.find(c=>c.id===id);return {id,label:app?.label,connected:result.source!=='suggested'&&result.apps.some(row=>row.id===(app?.provider_id||id)&&row.connected===true)};});
}
function connect(ownerId,id){
  const app=product.connectors.find(c=>c.id===id);
  if(!app)fail(400,'connector','Choose a supported app.');
  return startConnectorOAuth(ownerId,app.provider_id||app.id);
}

async function provision(p,{resumeSchedules=false}={}){
  const ch=channel(p);if(!ch)fail(409,'channel','Link WhatsApp first.');privateChannel(p,ch);
  uniqueChannelIdentity(p,ch);
  seedFloAssistTools(p.agent_id);
  let skillId=resource(p.owner_id,'skill','assistant');
  if(!skillId){
    const slug='floassist-personal-assistant';
    const prior=listAgentSkillsCatalog(p.owner_id).find(s=>s.slug===slug&&s.scope==='company');
    const skill=prior||createCompanySkill(p.owner_id,{name:'FloAssist personal assistant',slug,
      description:'Personal assistant for WhatsApp, reminders, connected apps, browser tasks and purchase continuity.',
      skill_md:readFileSync(new URL('./assistant.md',import.meta.url),'utf8'),
      trigger_hints:['FloAssist','WhatsApp','remind me','morning briefing','booking','purchase','follow up'],
      required_tools:['floassist_source_read','floassist_status','floassist_reminder_create','floassist_reminder_list','floassist_reminder_cancel','floassist_tracking_list','floassist_tracking_observe','floassist_tracking_update','kanban_user_action']},p.owner_id);
    skillId=skill.id;remember(p.owner_id,'skill','assistant',skillId);
  }
  // Append exactly one owner-specific assignment; never rewrite existing assignments or pins.
  db().prepare(`INSERT OR IGNORE INTO agent_skill_assignments(owner_user_id,agent_id,skill_id,enabled,priority,auto_select,assigned_by) VALUES (?,?,?,1,20,1,?)`).run(p.owner_id,p.agent_id,skillId,p.owner_id);
  for(const r of product.responsibilities){
    let id=resource(p.owner_id,'schedule',r.id);
    // Recover a crash between schedule creation and recording the resource reference.
    if(!id){
      id=db().prepare('SELECT id FROM scheduled_goals WHERE owner_user_id=? AND agent_id=? AND source=? ORDER BY created_at LIMIT 1').get(p.owner_id,p.agent_id,`floassist:${r.id}`)?.id;
      if(id)remember(p.owner_id,'schedule',r.id,id);
    }
    const enabled=floAssistResponsibilityEnabled(p.preferences,r);
    const prompt=responsibilityPrompt(product,p.preferences,r);
    const input={title:`FloAssist · ${r.label}`,prompt,agent_id:p.agent_id,cadence:r.cadence,time_local:r.cadence==='hourly'?'00:15':p.preferences.briefing_time,
      timezone:p.preferences.timezone,source:`floassist:${r.id}`,deliver_to:['whatsapp'],status:enabled?'active':'paused'};
    if(id&&!getScheduledGoal(p.owner_id,id))id=null;
    if(!id&&enabled){
      // A reviewed static single-step responsibility avoids LLM planning during registration.
      const g=await createScheduledGoal(p.owner_id,{...input,execution_mode:'direct_agent',skip_plan_review:true,plan:{manual:true,steps:[]}});
      id=g.id;remember(p.owner_id,'schedule',r.id,id);
    }
    if(id){if(!resumeSchedules&&getScheduledGoal(p.owner_id,id)?.status==='paused')input.status='paused';updateScheduledGoal(p.owner_id,id,input);}
  }
  const runtime=ensureTenantOpenClawAgent(resolveFloAssistCoo(p.owner_id),p.owner_id);
  if(resource(p.owner_id,'runtime','skill-context')!==skillId){
    invalidateOpenClawMainSession(runtime.openclawAgentId);
    remember(p.owner_id,'runtime','skill-context',skillId);
  }
  if(ch.status!=='enabled')applyAgentChannel(p.owner_id,ch.id);
}
async function pause(p,status){
  const rows=db().prepare("SELECT resource_id FROM floassist_resources WHERE owner_id=? AND kind='schedule'").all(p.owner_id);
  for(const r of rows)if(getScheduledGoal(p.owner_id,r.resource_id))updateScheduledGoal(p.owner_id,r.resource_id,{status:'paused'});
  if(status==='stopped'){
    const own=resource(p.owner_id,'channel','whatsapp');
    if(own&&channel(p)?.id===own)disableAgentChannel(p.owner_id,own);
  }
}
let service;
export function getFloAssist(){
  if(service)return service;
  service=createFloAssist({db:db(),product,adapters:{settings:setting,legal:getLegalVersionsPublic,
    managementUrl:()=>String(getPlatformSetting('floassist_management_url',null)||`${getPublicBaseUrl().replace(/\/api$/,'')}/login`),
    findOwner,newOtp:newEmailOtp,matchesOtp:emailOtpMatches,
    sendEmail:(email,code,expiresMinutes)=>sendUserOtpEmail({email},code,{subject:'Your FloAssist verification code',intro:'Use this code to set up your WhatsApp assistant.',expiresMinutes}),
    verifyMfa(user,code){const m=resolveUserMfa(user);if(m.enabled&&m.mode==='TOTP'&&(!user.mfa_secret||!verifyTotp(user.mfa_secret,String(code||''))))fail(401,'mfa_required','Enter your Flolah authenticator code to continue.');},
    createOwner:r=>registerCeoUser({email:r.email,mobile:r.phone,country:r.country,name:r.email.split('@')[0],accept_terms:true,terms_version:r.terms_version,privacy_version:r.privacy_version},{verifiedEmail:r.email}),
    resolveCoo:resolveFloAssistCoo,assertCoo,policy,setPolicy,channelView,qr,connections,connect,provision,pause}});
  return service;
}
