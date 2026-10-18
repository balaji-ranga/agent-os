// Operator-only renewal of an existing isolated preview; never an HTTP endpoint.
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {openRepository} from '../src/repository.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
const [origin,hoursArg,reason]=process.argv.slice(2),hours=Number(hoursArg);
if(!origin||new URL(origin).origin!==origin||new URL(origin).protocol!=='https:'||!Number.isInteger(hours)||hours<1||hours>168||!reason||reason.length>500)throw Error('Exact HTTPS origin, explicitly authorized 1–168 hours and audit reason required');
const file='/preview/adoption-preview.json',previous=readFileSync(file),prior=JSON.parse(previous),config=JSON.parse(readFileSync('/config/service.json','utf8'));
const repository=openRepository('/data/adoption.sqlite');
try{
 const sites=repository.map('websites'),site=sites.get(prior.embeddingId),parent=site&&sites.get(site.previewFor);
 if(prior.origin!==origin||site?.origin!==origin||site.status!=='approved'||!site.verified||!parent?.verified||parent.status!=='approved'||parent.origin!==origin||site.organizationId!==parent.organizationId||!/^uat_[a-f0-9]{32}$/.test(site.id)||prior.serviceUrl!==config.serviceUrl||Object.keys(prior).some(k=>!['embeddingId','origin','serviceUrl','installationToken','expiresAt'].includes(k)))throw Error('Existing isolated, verified, exact-origin preview required');
 const authority=new SessionAuthority({repository}),now=Date.now(),expiresAt=now+hours*3600000;let published=false;
 const publish=bytes=>{const temporary='/preview/adoption-preview-'+randomUUID()+'.tmp';writeFileSync(temporary,bytes,{mode:0o644});renameSync(temporary,file);};
 try{repository.transaction(()=>{const installation=authority.registerApproved({embeddingId:site.id,origins:[origin],expiresAt});site.installations.push(installation.installationId);site.label=`Isolated UAT · ${hours%24===0?hours/24+'-day':hours+'-hour'} preview`;sites.set(site.id,site);repository.map('management_audit').set(randomUUID(),{actorId:'authorized-uat-deployment',organizationId:site.organizationId,action:'renew_bounded_uat_installation',websiteId:site.id,reason,durationHours:hours,expiresAt,at:now});publish(JSON.stringify({...prior,installationToken:installation.installationToken,expiresAt}));published=true;});}catch(error){if(published)publish(previous);throw error;}
 console.log(JSON.stringify({kind:'authorized-preview-renewal',embeddingId:site.id,origin,durationHours:hours,issuedAt:new Date(now).toISOString(),expiresAt:new Date(expiresAt).toISOString(),optInOnly:true,permissionsChanged:false,laptopExposure:false}));
}finally{repository.close();}
