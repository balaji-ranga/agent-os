import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { isIP } from 'node:net';

const reject=()=>{throw new Error('Management access denied or invalid configuration');};
const hash=value=>createHash('sha256').update(value).digest('hex');
function identity(actor){if(!actor||typeof actor.id!=='string'||!actor.id||typeof actor.organizationId!=='string'||!actor.organizationId)reject();}
function normalizedOrigin(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||isIP(url.hostname)||!url.hostname.includes('.')||url.hostname.endsWith('.localhost'))reject();
 return url.origin;
}

// Actor is supplied by authenticated management middleware, never request JSON.
export function createControlPlane(repository,authority,{dns=resolveTxt,clock=Date.now}={}){
 const websites=repository.map('websites'),audit=repository.map('management_audit');
 const record=(actor,action,websiteId,reason)=>audit.set(randomUUID(),{actorId:actor.id,organizationId:actor.organizationId,action,websiteId,reason,at:clock()});
 const adminReason=(actor,reason)=>{if(actor?.role!=='platform_admin'||typeof reason!=='string'||!reason.trim()||reason.length>500)reject();};
 const owned=(actor,id)=>{identity(actor);const website=websites.get(id);if(!website||(actor.role!=='platform_admin'&&website.organizationId!==actor.organizationId)||!['owner','platform_admin'].includes(actor.role))reject();return website;};
 return {
  inventory(actor,{query='',status='all',offset=0,limit=25}={}){
   identity(actor);if(actor.role!=='platform_admin'||typeof query!=='string'||query.length>200||!['all','pending','approved','suspended','removed'].includes(status)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)reject();
   const all=websites.values(),needle=query.trim().toLowerCase(),filtered=all.filter(w=>(status==='all'||w.status===status)&&(!needle||[w.id,w.origin,w.label,w.organizationId,w.environment].some(value=>String(value||'').toLowerCase().includes(needle)))).sort((a,b)=>String(a.origin).localeCompare(String(b.origin))||String(a.id).localeCompare(String(b.id)));
   const summary={total:all.length,owners:new Set(all.map(w=>w.organizationId)).size,...Object.fromEntries(['pending','approved','suspended','removed'].map(state=>[state,all.filter(w=>w.status===state).length]))};
   return {scope:'platform',summary,websites:filtered.slice(offset,offset+limit).map(w=>({id:w.id,origin:w.origin,label:w.label||'',ownerId:w.organizationId,environment:w.environment,status:w.status,verified:w.verified===true,installationsIssued:w.installations?.length||0,capabilities:{attachments:w.taskPolicy?.attachments===true,pairing:w.taskPolicy?.pairing===true,workflow:w.taskPolicy?.workflow===true,analytics:w.analyticsPolicy?.enabled===true}})),pagination:{offset,limit,total:filtered.length,hasNext:offset+limit<filtered.length,hasPrevious:offset>0}};
  },
  recordAnalytics(actor,id){owned(actor,id);record(actor,'configure_analytics',id,'Website analytics policy updated; fresh visitor consent required');},
  recordPairing(actor,id,{action,groupId,reason,status}){owned(actor,id);if(!['revoke_pairing','update_pairing_expiry'].includes(action)||typeof groupId!=='string'||typeof reason!=='string'||!reason.trim()||reason.length>500)reject();audit.set(randomUUID(),{actorId:actor.id,organizationId:actor.organizationId,websiteId:id,action,groupId,reason,status,at:clock()});},
  transfer(actor,id,{email,expectedOwnerId,reason}){
   adminReason(actor,reason);
   if(typeof email!=='string'||email.length>254)reject();
   const target=repository.map('owners').get(hash(email.trim().toLowerCase()));
   if(!target?.id)throw new Error('Recipient must complete independent owner email sign-in first');
   return repository.transaction(()=>{
    const website=owned(actor,id);
    if(website.organizationId!==expectedOwnerId||website.status==='removed'||website.organizationId===target.id)reject();
    const previousOwnerId=website.organizationId;website.organizationId=target.id;if(website.analyticsPolicy)website.analyticsPolicy={...website.analyticsPolicy,enabled:false,revision:(website.analyticsPolicy.revision||1)+1};websites.set(id,website);
    audit.set(randomUUID(),{actorId:actor.id,organizationId:actor.organizationId,action:'transfer_owner',websiteId:id,reason,previousOwnerId,newOwnerId:target.id,at:clock()});
    // A prior recipient's delivery verification is not authority for the new owner.
    const contacts=repository.map('registration_email'),contact=contacts.get(id);
    if(contact&&contact.email.trim().toLowerCase()!==target.email){contacts.delete(id);}
    return {transferred:true,indexRetained:true,configurationRetained:true};
   });
  },
  tokens(actor,id){owned(actor,id);if(actor.role!=='platform_admin')reject();return authority.installationSummary(id);},
  audit(actor,id){owned(actor,id);if(actor.role!=='platform_admin')reject();return [...audit.values()].filter(row=>row.websiteId===id).sort((a,b)=>b.at-a.at).slice(0,100);},
  transition(actor,id,status,reason){
   adminReason(actor,reason);
   return repository.transaction(()=>{
    const website=owned(actor,id);
    const allowed={pending:['approved','removed'],approved:['suspended','removed'],suspended:['approved','removed'],removed:[]};
    if(!allowed[website.status]?.includes(status)||(status==='approved'&&!website.verified))reject();
    if(status!=='approved')for(const installationId of website.installations)authority.revokeInstallation(installationId);
    website.status=status;websites.set(id,website);record(actor,`website_${status}`,id,reason);
    return {status,indexRetained:true};
   });
  },
  cancelDelivery(actor,id,installationId){const website=owned(actor,id);if(!website.installations.includes(installationId))reject();authority.revokeInstallation(installationId);record(actor,'revoke_failed_delivery',id,'Email transport failed');},
  scope(actor,id){const website=owned(actor,id);if(website.status!=='approved'||!website.verified)reject();return {embeddingId:website.id,audienceIds:['public'],audienceId:'public',origin:website.origin,role:'maintainer'};},
  configure(actor,id,{visitorUploads,taskPolicy}){
   if(visitorUploads!==undefined&&typeof visitorUploads!=='boolean'||taskPolicy!==undefined&&(!taskPolicy||typeof taskPolicy!=='object'||Object.keys(taskPolicy).some(k=>!['attachments','pairing','workflow','actionBindings','limits'].includes(k))||['attachments','pairing','workflow'].some(k=>taskPolicy[k]!==undefined&&typeof taskPolicy[k]!=='boolean')))reject();
   if(taskPolicy?.limits!==undefined){const maxima={fileBytes:16*1024*1024,files:4,taskBytes:64*1024*1024,instances:100};if(!taskPolicy.limits||Array.isArray(taskPolicy.limits)||typeof taskPolicy.limits!=='object'||Object.entries(taskPolicy.limits).some(([k,v])=>!maxima[k]||!Number.isSafeInteger(v)||v<1||v>maxima[k]))reject();}
   if(taskPolicy?.actionBindings!==undefined&&(!Array.isArray(taskPolicy.actionBindings)||taskPolicy.actionBindings.length>30||new Set(taskPolicy.actionBindings.map(b=>b?.id)).size!==taskPolicy.actionBindings.length||taskPolicy.actionBindings.some(b=>!b||typeof b.id!=='string'||!/^[\w-]{1,80}$/.test(b.id)||typeof b.path!=='string'||!/^\/(?!\/)[^?#\\]*$/.test(b.path)||typeof b.label!=='string'||b.label.length>160||!['read','write_internal','communicate_external','financial_destructive'].includes(b.family))))reject();
   return repository.transaction(()=>{const site=owned(actor,id);if(visitorUploads!==undefined){site.visitorUploads=visitorUploads;authority.setUploadPolicy(id,visitorUploads);}if(taskPolicy)site.taskPolicy={...site.taskPolicy,...taskPolicy};websites.set(id,site);record(actor,'configure_visitor_policy',id,'Visitor capabilities updated');return {visitorUploads:site.visitorUploads===true,taskPolicy:site.taskPolicy||{}};});
  },
  register(actor,{origin,environment,operationId}){
   identity(actor);if(actor.role!=='owner'||!['staging','production'].includes(environment))reject();
   if(operationId!==undefined&&(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(operationId)))reject();
   const attempts=repository.map('registration_attempts'),key=operationId&&`${actor.organizationId}:${operationId}`;
   const fingerprint=hash(JSON.stringify({origin:normalizedOrigin(origin),environment}));
   return repository.transaction(()=>{
    if(key){const previous=attempts.get(key);if(previous){if(previous.fingerprint!==fingerprint)reject();owned(actor,previous.result.id);return structuredClone(previous.result);}}
    const normalized=normalizedOrigin(origin),challenge=`flolah-adoption=${randomBytes(32).toString('base64url')}`;
    const website={id:randomUUID(),organizationId:actor.organizationId,origin:normalized,environment,status:'pending',verified:false,
     challengeHash:hash(challenge),challengeExpiry:clock()+24*3_600_000,installations:[]};
    websites.set(website.id,website);record(actor,'register',website.id);
    const result={id:website.id,status:'pending',dnsName:`_flolah-adoption.${new URL(normalized).hostname}`,dnsValue:challenge};
    if(key)attempts.set(key,{fingerprint,result});return result;
   });
  },
  async verify(actor,id){
   const website=owned(actor,id);
   if(website.challengeExpiry<=clock())reject();
   const records=await dns(`_flolah-adoption.${new URL(website.origin).hostname}`);
   if(!Array.isArray(records)||!records.some(parts=>Array.isArray(parts)&&hash(parts.join(''))===website.challengeHash))reject();
   return repository.transaction(()=>{
    const current=owned(actor,id);if(current.challengeHash!==website.challengeHash||current.challengeExpiry<=clock())reject();
    current.verified=true;websites.set(id,current);record(actor,'verify_domain',id);return {verified:true};
   });
  },
  approve(actor,id){
   return repository.transaction(()=>{
   if(actor?.role!=='platform_admin')reject();
   const website=owned(actor,id);if(!website.verified||website.status!=='pending')reject();
   website.status='approved';websites.set(id,website);record(actor,'approve',id);return {status:'approved'};
   });
  },
  activate(actor,id){
   return repository.transaction(()=>{
   const website=owned(actor,id);if(!website.verified||website.status!=='approved')reject();
   const installation=authority.registerApproved({embeddingId:website.id,origins:[website.origin],expiresAt:clock()+365*24*3_600_000,visitorUploads:website.visitorUploads===true});
   website.installations.push(installation.installationId);websites.set(id,website);record(actor,'issue_installation',id);
   return {embeddingId:website.id,...installation};
   });
  },
  suspend(actor,id){
   return repository.transaction(()=>{
    if(actor?.role!=='platform_admin')reject();
    const website=owned(actor,id);if(website.status!=='approved')reject();
    for(const installationId of website.installations)authority.revokeInstallation(installationId);
    website.status='suspended';websites.set(id,website);record(actor,'suspend',id);return {status:'suspended'};
   });
  },
  rotate(actor,id,installationId,{overlapMs=0,reason}){
   adminReason(actor,reason);
   return repository.transaction(()=>{
    const website=owned(actor,id);
    if(website.status!=='approved'||!website.installations.includes(installationId))reject();
    const result=authority.rotateInstallation(installationId,{overlapMs,expiresAt:clock()+365*24*3_600_000});
    website.installations.push(result.installationId);websites.set(id,website);record(actor,'rotate_installation',id,reason);
    return result;
   });
  },
  revokeToken(actor,id,installationId,reason){
   adminReason(actor,reason);
   return repository.transaction(()=>{
    const website=owned(actor,id);if(!website.installations.includes(installationId))reject();
    authority.revokeInstallation(installationId);record(actor,'revoke_installation',id,reason);return {revoked:true};
   });
  },
  revokeSession(actor,id,sessionId,reason){
   adminReason(actor,reason);
   return repository.transaction(()=>{
    owned(actor,id);authority.revokeSession(id,sessionId);record(actor,'revoke_session',id,reason);return {revoked:true};
   });
  },
  list(actor,{id}={}){identity(actor);if(!['owner','platform_admin'].includes(actor.role)||id!==undefined&&(typeof id!=='string'||!id||id.length>200))reject();return (id?[owned(actor,id)]:websites.values(actor.role==='platform_admin'?{}:{organizationId:actor.organizationId}).slice(0,100)).map(({challengeHash,...w})=>w);},
 };
}
