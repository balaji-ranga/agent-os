import { timingSafeEqual } from 'node:crypto';

// Optional platform backend adapter, not mounted automatically. Inject the
// platform's active-endpoint resolver and completion function at installation.
// No dependency on Platform Help and no model keys returned to the caller.
export function createPlatformGateway({serviceToken,resolveActive,complete}) {
 if(typeof serviceToken!=='string'||serviceToken.length<32)throw new Error('Service credential required');
 return async function handle({authorization,body}){
  const supplied=Buffer.from(String(authorization||'')),expected=Buffer.from(`Bearer ${serviceToken}`);
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw new Error('Access denied');
  if(!['digital_adoption_plan','digital_adoption_knowledge'].includes(body?.purpose)||body.selection!=='platform_active'||!Array.isArray(body.messages)||body.messages.length>14||
     JSON.stringify(body).length>32_768||Object.keys(body).some(k=>!['purpose','selection','messages','maxTokens'].includes(k)))throw new Error('Invalid gateway request');
  for(const message of body.messages){if(!['system','user','assistant'].includes(message.role)||typeof message.content!=='string')throw new Error('Invalid messages');}
  const config=await resolveActive(); // Resolve for every call; no cached primary/secondary choice.
  if(!config||!['primary','secondary'].includes(config.active))throw new Error('Active model unavailable');
  const result=await complete({config,messages:body.messages,maxTokens:2000});
  return {content:result.content,active:config.active};
 };
}
