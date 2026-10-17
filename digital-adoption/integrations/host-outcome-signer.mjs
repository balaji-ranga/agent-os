import {createPrivateKey,createHash,sign} from 'node:crypto';
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value);
const fail=()=>{throw new Error('A recent authorized saved-record readback is required');};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;

// HOST BACKEND ONLY. readSavedTask must authenticate the host request, enforce
// record ownership and independently read persisted data. It must return the
// server-stored task binding, never copy identity/bindings supplied by a browser.
export function createHostOutcomeSigner({privateKey,keyId,issuer,embeddingId,policyRevision,roles,readSavedTask,clock=Date.now}){
 const origin=new URL(issuer),key=createPrivateKey(privateKey);
 if(origin.origin!==issuer||origin.username||origin.password||!(origin.protocol==='https:'||origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname))||key.asymmetricKeyType!=='ed25519'||!identifier(keyId)||!identifier(embeddingId)||!Number.isSafeInteger(policyRevision)||policyRevision<1||!Array.isArray(roles)||!roles.length||roles.some(role=>!identifier(role))||typeof readSavedTask!=='function')throw new Error('Invalid host receipt configuration');
 return async request=>{
  if(!request||Object.keys(request).some(name=>!['sessionId','proposalId','path','operationId'].includes(name))||!identifier(request.sessionId)||!identifier(request.proposalId)||!identifier(request.operationId)||typeof request.path!=='string'||!/^\/(?!\/)[^?#\\]*$/.test(request.path)||request.path.length>300)fail();
  const saved=await readSavedTask({...request}),now=clock();
  if(!saved||saved.success!==true||saved.readBack!==true||!Number.isSafeInteger(saved.savedAt)||saved.savedAt>now||saved.savedAt+120_000<=now||['sessionId','proposalId','path','operationId'].some(name=>saved[name]!==request[name])||!identifier(saved.subject)||!identifier(saved.tenant)||!Array.isArray(saved.roles)||!saved.roles.length||saved.roles.some(role=>!roles.includes(role))||!saved.record||typeof saved.record!=='object'||Array.isArray(saved.record))fail();
  const record=JSON.stringify(canonical(saved.record));if(Buffer.byteLength(record)>64_000)fail();
  const iat=Math.floor(now/1000),claims={iss:issuer,aud:embeddingId,origin:issuer,sub:saved.subject,tenant:saved.tenant,roles:[...new Set(saved.roles)].sort(),iat,exp:iat+120,policyRevision,purpose:'adoption_outcome',...request,success:true,evidenceKind:'saved-record-readback',recordHash:createHash('sha256').update(record).digest('hex')};
  const header=Buffer.from(JSON.stringify({alg:'EdDSA',typ:'JWT',kid:keyId})).toString('base64url'),payload=Buffer.from(JSON.stringify(claims)).toString('base64url'),input=header+'.'+payload;
  return input+'.'+sign(null,Buffer.from(input),key).toString('base64url');
 };
}
