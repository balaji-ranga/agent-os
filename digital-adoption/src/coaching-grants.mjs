import {randomBytes,createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function createCoachingGrants(repository,{clock=Date.now}={}){
 const grants=repository.map('coaching_grants');
 return {
  issue(scope){
   if(scope?.role!=='maintainer'||!scope.embeddingId||!scope.origin)throw new Error('Coaching access denied');
   const code=`dac_coach_${randomBytes(32).toString('base64url')}`,expiresAt=clock()+10*60_000;
   grants.set(hash(code),{embeddingId:scope.embeddingId,audienceId:scope.audienceId||scope.audienceIds?.[0]||'public',origin:scope.origin,expiresAt,used:false});return {code,expiresAt};
  },
  exchange(scope,origin,code){
   if(typeof code!=='string'||code.length>128)throw new Error('Coaching access denied');
   return repository.transaction(()=>{const grant=grants.get(hash(code));if(!grant||grant.used||grant.expiresAt<=clock()||grant.embeddingId!==scope.embeddingId||grant.origin!==origin||!(scope.audienceIds||['public']).includes(grant.audienceId||'public'))throw new Error('Coaching access denied');grant.used=true;grants.set(hash(code),grant);return {embeddingId:grant.embeddingId,audienceId:grant.audienceId||'public',origin:grant.origin,expiresAt:grant.expiresAt};});
  },
 };
}
