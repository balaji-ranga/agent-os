// Validate the existing Flolah login remotely; no copied session DB or browser roles.
export function createManagementIdentity({platformOrigin,fetchImpl=fetch}){
 const origin=new URL(platformOrigin);
 if(origin.protocol!=='https:'||origin.origin!==platformOrigin)throw new Error('HTTPS platform origin required');
 return async authorization=>{
  if(typeof authorization!=='string'||!/^Bearer [A-Za-z0-9_-]{32,256}$/.test(authorization))throw new Error('Management authentication required');
  const response=await fetchImpl(new URL('/api/auth/me',origin),{headers:{Authorization:authorization},redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error('Management authentication required');
  const payload=await response.json(),user=payload.user;
  if(!user?.id||user.enabled===false||!['ceo','admin'].includes(user.role))throw new Error('Management access denied');
  return Object.freeze({id:user.id,organizationId:user.id,role:user.role==='admin'?'platform_admin':'owner'});
 };
}
