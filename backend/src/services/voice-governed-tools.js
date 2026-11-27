import {getDb} from '../db/schema.js';
import {getToolBrokerSecret} from './tool-scoped-token.js';
import {registerOpenClawSessionOwner} from './tool-owner-scope.js';
import {tenantOpenClawAgentId,baseOpenClawAgentIdForAgent} from './openclaw-tenant.js';
export async function invokePrivateVoiceTool(session,name,args,{turnId,callId,fetcher=fetch,db=getDb()}={}){
 const {caller,key}=privateVoiceIdentity(session,db);
 const identity=String(turnId||callId||'').trim();if(!/^[a-zA-Z0-9_-]{1,180}$/.test(identity))throw Object.assign(Error('Voice turn identity required'),{status:422});
 registerOpenClawSessionOwner(key,session.owner_user_id,session.owner_user_id,'voice');
 const base='http://127.0.0.1:'+(process.env.PORT||3001);
 const lease=await fetcher(base+'/api/tools/lease',{method:'POST',headers:{'content-type':'application/json','x-agent-os-tool-broker':getToolBrokerSecret()},body:JSON.stringify({caller_agent_id:caller,session_key:key,tool_name:name}),signal:AbortSignal.timeout(10000)});
 const credential=await lease.json();if(!lease.ok||!credential.access_token)throw Object.assign(Error('Voice tool authorization failed'),{status:lease.status||403});
 const safeArgs={...args};for(const k of ['ceo_user_id','ceoUserId','owner_user_id','ownerUserId'])delete safeArgs[k];
 const response=await fetcher(base+'/api/tools/invoke',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+credential.access_token,'x-openclaw-agent-id':caller,'x-ceo-user-id':session.owner_user_id,'x-openclaw-session-key':key,'x-openclaw-message-channel':'voice','x-openclaw-run-id':'voice-'+session.id+'-'+identity},body:JSON.stringify({...safeArgs,tool_name:name,caller_agent_id:caller}),signal:AbortSignal.timeout(45000)});
 const data=await response.json();return {...data,ok:response.ok&&data.ok!==false};
}

export function privateVoiceIdentity(session,db=getDb()){
 const agent=db.prepare('SELECT * FROM agents WHERE id=?').get(session.agent_id);if(!agent)throw Object.assign(Error('Agent unavailable'),{status:403});
 const caller=tenantOpenClawAgentId(session.owner_user_id,baseOpenClawAgentIdForAgent(agent));
 const key=`agent:${caller}:voice:${session.id}`;
 return {caller,key};
}
