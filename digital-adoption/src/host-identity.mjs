import {createPublicKey,verify,createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value);
const deny=()=>{throw new Error('Host identity denied or expired');};
export function createHostIdentity(repository,{clock=Date.now}={}){
 const policies=repository.map('host_identity'),revocations=repository.map('host_identity_revoked');
 const audience=(tenant,role)=>'host_'+hash(tenant+'\n'+role).slice(0,48);
 const service={
  configure(scope,{required,issuer,publicKeys,roles}){
   if(scope.role!=='maintainer'||typeof required!=='boolean'||issuer!==scope.origin||!Array.isArray(publicKeys)||!publicKeys.length||publicKeys.length>3||!Array.isArray(roles)||!roles.length||roles.length>20||roles.some(role=>!id(role)))deny();
   const kids=new Set();for(const key of publicKeys){if(!key||Object.keys(key).some(k=>!['kty','crv','x','kid'].includes(k))||key.kty!=='OKP'||key.crv!=='Ed25519'||!id(key.kid)||kids.has(key.kid)||! /^[A-Za-z0-9_-]{43}$/.test(key.x))deny();createPublicKey({key,format:'jwk'});kids.add(key.kid);}
   const previous=policies.get(scope.embeddingId),revision=(previous?.revision||0)+1;
   policies.set(scope.embeddingId,{embeddingId:scope.embeddingId,required,issuer,publicKeys,roles:[...new Set(roles)].sort(),revision});return {required,issuer,roles,revision};
  },
  status(scope){if(scope.role!=='maintainer')deny();const policy=policies.get(scope.embeddingId);return policy?{required:policy.required,issuer:policy.issuer,roles:policy.roles,revision:policy.revision,kids:policy.publicKeys.map(k=>k.kid)}:{required:false,revision:0};},
  audience(scope,{tenant,role}){const policy=policies.get(scope.embeddingId);if(scope.role!=='maintainer'||!policy||!id(tenant)||!policy.roles.includes(role))deny();return audience(tenant,role);},
  verify(embeddingId,origin,token,{purpose='adoption_identity'}={}){
   const policy=policies.get(embeddingId);if(!policy){if(token!==undefined)deny();return null;}
   if(token===undefined){if(policy.required)deny();return null;}
   if(typeof token!=='string'||token.length>12_000)deny();const parts=token.split('.');if(parts.length!==3||parts.some(part=>! /^[A-Za-z0-9_-]+$/.test(part)))deny();
   let header,claims;try{header=JSON.parse(Buffer.from(parts[0],'base64url'));claims=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{deny();}
   if(!header||header.alg!=='EdDSA'||header.typ!=='JWT'||!id(header.kid)||Object.keys(header).some(k=>!['alg','typ','kid'].includes(k)))deny();
   const key=policy.publicKeys.find(k=>k.kid===header.kid),signature=Buffer.from(parts[2],'base64url');if(!key||signature.length!==64||!verify(null,Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key,format:'jwk'}),signature))deny();
   const now=Math.floor(clock()/1000);
   if(purpose==='adoption_identity'?(claims?.purpose!==undefined&&claims.purpose!=='adoption_identity'):claims?.purpose!==purpose)deny();
   if(!claims||claims.iss!==policy.issuer||claims.aud!==embeddingId||claims.origin!==origin||origin!==policy.issuer||!id(claims.sub)||!id(claims.tenant)||!Array.isArray(claims.roles)||!claims.roles.length||claims.roles.length>20||claims.roles.some(role=>!policy.roles.includes(role))||!Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||claims.iat>now+5||claims.exp<=now||claims.exp-claims.iat>300||claims.exp<=claims.iat||claims.policyRevision!==policy.revision)deny();
   const principal=hash(policy.issuer+'\n'+claims.tenant+'\n'+claims.sub),audienceIds=[...new Set(claims.roles)].sort().map(role=>audience(claims.tenant,role));
   const identity={principal,audienceIds,expiresAt:claims.exp*1000,issuedAt:claims.iat*1000,policyRevision:policy.revision,fingerprint:hash(JSON.stringify({principal,audienceIds,policyRevision:policy.revision}))};
   service.check(embeddingId,identity);return identity;
  },
  check(embeddingId,identity){const policy=policies.get(embeddingId);if(!identity){if(policy?.required)deny();return;}
   if(!policy||identity.policyRevision!==policy.revision||identity.expiresAt<=clock()||(revocations.get(embeddingId+':'+identity.principal)?.revokedAt??-1)>=identity.issuedAt)deny();
  },
  verifyOutcome(scope,origin,token,{proposalId,path}){
   const identity=service.verify(scope.embeddingId,origin,token,{purpose:'adoption_outcome'});if(!identity)deny();
   const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
   if(claims.purpose!=='adoption_outcome'||claims.sessionId!==scope.sessionId||claims.proposalId!==proposalId||claims.path!==path||claims.success!==true||claims.evidenceKind!=='saved-record-readback'||!id(claims.operationId)||! /^[a-f0-9]{64}$/.test(claims.recordHash)||scope.hostPrincipal&&scope.hostPrincipal!==identity.principal)deny();
   return {operationId:claims.operationId,recordHash:claims.recordHash,verifiedAt:clock()};
  },
  revoke(scope,{tenant,subject}){if(scope.role!=='maintainer'||!id(tenant)||!id(subject))deny();const policy=policies.get(scope.embeddingId);if(!policy)deny();const principal=hash(policy.issuer+'\n'+tenant+'\n'+subject);revocations.set(scope.embeddingId+':'+principal,{embeddingId:scope.embeddingId,revokedAt:clock()});return {revoked:true};},
 };
 return service;
}
