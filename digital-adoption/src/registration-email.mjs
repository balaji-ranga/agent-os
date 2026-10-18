import {randomInt,createHash} from 'node:crypto';
import {installationSnippet} from './install-snippet.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function createRegistrationEmail(repository,{send,control,search,serviceUrl,clock=Date.now}){
 const contacts=repository.map('registration_email');
 const website=(actor,id)=>{const site=control.list(actor).find(s=>s.id===id);if(!site)throw new Error('Access denied');return site;};
 return {
  status(actor,id){website(actor,id);const row=contacts.get(id);return row?{email:row.email,verified:row.verified,delivery:row.delivery||null}:{email:null,verified:false};},
  async start(actor,id,email){
   website(actor,id);
   if(typeof email!=='string'||email.length>254||! /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email))throw new Error('Invalid email');
   const old=contacts.get(id);if(old&&clock()-old.requestedAt<60_000)throw new Error('Wait before requesting another code');
   const code=String(randomInt(100000,1000000));
   contacts.set(id,{email,codeHash:hash(code),expiresAt:clock()+10*60_000,requestedAt:clock(),attempts:0,verified:false});
   await send({to:email,subject:'Verify your Flolah Copilot registration email',text:`Your verification code is ${code}. It expires in 10 minutes. Enter it in the authenticated Digital Adoption registration page. If you did not request this email, ignore it.`});
   return {sent:true};
  },
  confirm(actor,id,code){
   website(actor,id);const row=contacts.get(id);
   if(!row||row.verified||row.expiresAt<=clock()||row.attempts>=5)throw new Error('Code expired or unavailable');
   row.attempts++;contacts.set(id,row);
   if(typeof code!=='string'||hash(code)!==row.codeHash)throw new Error('Incorrect verification code');
   row.verified=true;delete row.codeHash;contacts.set(id,row);return {verified:true};
  },
  async deliver(actor,id){
   const scope=control.scope(actor,id),site=website(actor,id),row=contacts.get(id);
   if(!row?.verified)throw new Error('Verify recipient email first');
   if(row.lastDeliveryAt&&clock()-row.lastDeliveryAt<60_000)throw new Error('Wait before sending another snippet');
   row.lastDeliveryAt=clock();row.delivery='sending';contacts.set(id,row);
   await search.provision(scope.embeddingId);
   const issued=control.activate(actor,id);
   const snippet=installationSnippet(serviceUrl,issued.installationToken);
   try{
    await send({to:row.email,subject:'Your Flolah Digital Adoption Copilot installation',text:`Website: ${site.origin}\nEnvironment: ${site.environment}\n\n${snippet}\n\nThis publishable token authorizes only this approved embedding's public experience. It is not an admin credential. Never embed private model, management or runtime credentials. Manage or revoke this installation from Flolah.`});
    row.delivery='accepted_by_mail_server';contacts.set(id,row);return {sent:true,email:row.email,installationId:issued.installationId};
   }catch(error){control.cancelDelivery(actor,id,issued.installationId);row.delivery='failed_token_revoked';contacts.set(id,row);throw error;}
  }
 };
}
