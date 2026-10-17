import {randomBytes, randomInt, randomUUID, createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
const denied=()=>{throw new Error('Owner sign-in expired or invalid');};
export function createOwnerIdentity(repository,{send,clock=Date.now}){
 const challenges=repository.map('owner_challenges'),owners=repository.map('owners'),sessions=repository.map('owner_sessions');
 const cookieName='__Secure-adoption-owner';
 const tokenFrom=cookie=>String(cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 return {
  async start(email){
   if(typeof email!=='string'||email.length>254||! /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email))denied();
   email=email.trim().toLowerCase();const key=digest(email),now=clock();
   const challenge=randomBytes(32).toString('base64url'),code=String(randomInt(100000,1000000));
   repository.transaction(()=>{const old=challenges.get(key);if(old&&now-old.createdAt<60_000)throw new Error('Please wait before requesting another code');challenges.set(key,{email,challengeHash:digest(challenge),codeHash:digest(challenge+code),attempts:0,createdAt:now,expiresAt:now+600_000});});
   try{await send({to:email,subject:'Sign in to Flolah Digital Adoption',text:`Your sign-in code is ${code}. It expires in 10 minutes. Enter it only in the Digital Adoption owner sign-in page where you requested it. Do not share this code.`});}
   catch(error){repository.transaction(()=>{if(challenges.get(key)?.challengeHash===digest(challenge))challenges.delete(key);});throw error;}
   return {challenge,email};
  },
  confirm(email,challenge,code){
   const result=repository.transaction(()=>{
   if(typeof email!=='string'||typeof challenge!=='string'||typeof code!=='string')denied();
   const key=digest(email.trim().toLowerCase()),row=challenges.get(key),now=clock();
   if(!row||row.expiresAt<=now||row.attempts>=5||row.challengeHash!==digest(challenge))denied();
   row.attempts++;challenges.set(key,row);
   if(row.codeHash!==digest(challenge+code))return null;
   challenges.delete(key);
   let owner=owners.get(key);if(!owner){owner={id:'owner_'+randomUUID(),email:row.email};owners.set(key,owner);}
   const token=randomBytes(32).toString('base64url');sessions.set(digest(token),{ownerId:owner.id,expiresAt:now+8*3_600_000,lastSeen:now});
   return {cookie:`${cookieName}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/free-tools/digital-adoption/; Max-Age=28800`};
   });if(!result)denied();return result;
  },
  authenticate(cookie){
   const actor=repository.transaction(()=>{
   const token=tokenFrom(cookie);if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))denied();
   const key=digest(token),row=sessions.get(key),now=clock();
   if(!row||row.expiresAt<=now||now-row.lastSeen>=30*60_000){sessions.delete(key);return null;}
   row.lastSeen=now;sessions.set(key,row);
   return {id:row.ownerId,organizationId:row.ownerId,role:'owner'};
   });if(!actor)denied();return actor;
  },
  logout(cookie){return repository.transaction(()=>{const token=tokenFrom(cookie);if(token)sessions.delete(digest(token));return {cookie:`${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/free-tools/digital-adoption/; Max-Age=0`};});}
 };
}
