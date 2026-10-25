import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {getDb} from '../../db/schema.js';
import {getPublicBaseUrl} from '../../config/public-url.js';
import {ensureFloAssistRuntime} from './runtime.js';

const product=JSON.parse(readFileSync(new URL('./product.json',import.meta.url),'utf8'));
function profile(db,owner){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='floassist_profiles'").get())return null;
  const p=db.prepare('SELECT p.* FROM floassist_profiles p JOIN platform_users u ON u.id=p.owner_id WHERE p.owner_id=? AND p.status=\'active\' AND u.enabled=1').get(owner);
  if(!p)return null;
  p.preferences=JSON.parse(p.preferences_json);
  return p.preferences.responsibilities?.includes('priority')?p:null;
}
function ensure(db){
  ensureFloAssistRuntime(db);
  db.exec(`CREATE TABLE IF NOT EXISTS floassist_connector_health (
    owner_id TEXT NOT NULL,app_id TEXT NOT NULL,state TEXT NOT NULL,episode TEXT,notification_key TEXT,checked_at INTEGER NOT NULL,
    PRIMARY KEY(owner_id,app_id));`);
}

/** Persist only health state, never provider error bodies, tokens or mailbox content. */
export function recordFloAssistConnectorHealth(owner,provider,state,{db=getDb(),now=Date.now()}={}){
  const p=profile(db,owner);
  const app=product.connectors.find(a=>(a.provider_id||a.id)===provider);
  if(!p||!app||!p.preferences.connectors?.includes(app.id))return {ignored:true};
  if(!['available','missing','authorization','permission','temporary','unsupported','restricted','unknown'].includes(state))return {ignored:true};
  ensure(db);
  return db.transaction(()=>{
    const old=db.prepare('SELECT * FROM floassist_connector_health WHERE owner_id=? AND app_id=?').get(owner,app.id);
    const bad=state!=='available',wasBad=old&&old.state!=='available';
    let key=old?.notification_key||null,episode=old?.episode||null,queued=false;
    if(bad&&(!wasBad||old.state!==state)){
      if(old?.notification_key)db.prepare("UPDATE floassist_notifications SET status='cancelled',text=NULL WHERE source_key=? AND status='pending'").run(old.notification_key);
      episode=randomUUID();key=`${owner}:connector-health:${app.id}:${episode}`;
      const configuredBase=String(getPublicBaseUrl()||'').replace(/\/$/,'');
      const base=/^https:\/\//i.test(configuredBase)?configuredBase:'';
      const reason=state==='missing'?'is no longer connected':state==='authorization'?'needs reconnection because authorization failed':state==='permission'?'could not be accessed with its current permissions':state==='unsupported'?'has no supported connection check installed':state==='restricted'?'cannot be checked under the current agent permissions or policy':state==='unknown'?'connection health could not be verified':'is temporarily unavailable';
      const action=['temporary','unsupported','restricted','unknown'].includes(state)?'FloAssist will check again during the next enabled priority check.':`Open FloAssist → Your apps to reconnect or review permissions${base?`: ${base}/free-tools/floassist/`:'.'}`;
      const text=`FloAssist connection alert: ${app.label} ${reason}. Checks depending on this app may be incomplete. ${action}`;
      db.prepare('INSERT INTO floassist_notifications(source_key,owner_id,agent_id,text,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(key,owner,p.agent_id,text,now,now,now+86400000);queued=true;
    }else if(!bad&&wasBad){
      db.prepare("UPDATE floassist_notifications SET status='cancelled',text=NULL WHERE source_key=? AND status='pending'").run(key);
      // Recovery is durable state only. Priority notifications are exceptions-only.
      db.prepare("UPDATE floassist_notifications SET status='cancelled',text=NULL WHERE source_key=? AND status='pending'").run(`${key}:recovered`);
      episode=null;key=null;
    }
    db.prepare('INSERT INTO floassist_connector_health VALUES (?,?,?,?,?,?) ON CONFLICT(owner_id,app_id) DO UPDATE SET state=excluded.state,episode=excluded.episode,notification_key=excluded.notification_key,checked_at=excluded.checked_at').run(owner,app.id,state,episode,key,now);
    return {state,queued};
  })();
}

export function connectorFailureState(error){
  const status=Number(error?.provider_status||error?.status);
  if(['rate_limited','quota_exceeded'].includes(error?.code)||status===429)return 'temporary';
  if(status===401||/invalid_grant|token.*revok|authorization.failed|not connected/i.test(String(error?.message||'')))return 'authorization';
  if(status===403)return 'permission';
  if(status>=500||/timeout|fetch failed|ECONN/i.test(String(error?.message||'')))return 'temporary';
  return 'unknown';
}

/** Inventory proves registration, not token validity. Successful provider actions prove recovery. */
export async function checkFloAssistConnectorHealth(owner,{db=getDb(),getInventory,probe}={}){
  const p=profile(db,owner);if(!p)return {checked:0};
  const inventory=getInventory||((await import('../openconnector.js')).getConnectorRegistrationHealth);
  let result;try{result=await inventory(owner);}catch{
    for(const id of p.preferences.connectors||[]){const app=product.connectors.find(a=>a.id===id);if(app)recordFloAssistConnectorHealth(owner,app.provider_id||id,'temporary',{db});}
    return {checked:0,unavailable:true};
  }
  let checked=0;
  for(const id of p.preferences.connectors||[]){
    const app=product.connectors.find(a=>a.id===id);if(!app)continue;
    const provider=app.provider_id||id;checked++;
    if(!result.connected.includes(provider))recordFloAssistConnectorHealth(owner,provider,'missing',{db});
    else {
      if(!app.health_probe){recordFloAssistConnectorHealth(owner,provider,'unsupported',{db});continue;}
      try {
        if(probe)await probe(owner,app.health_probe,p.agent_id);
        else {
          const {assertCallerMayExecuteConnectorAction,connectorPolicyToolName}=await import('../connector-action-grants.js');
          const {getAgentToolGrants}=await import('../openclaw-agent-tools.js');
          const {evaluateActionPolicy}=await import('../action-policy.js');
          if(!db.prepare('SELECT 1 FROM user_agents WHERE user_id=? AND agent_id=? AND enabled=1').get(owner,p.agent_id)||!getAgentToolGrants(p.agent_id).includes('connector_execute_action')||!assertCallerMayExecuteConnectorAction(p.agent_id,app.health_probe.action_id).ok||!evaluateActionPolicy({ownerUserId:owner,toolName:connectorPolicyToolName(app.health_probe.action_id),context:{agent_id:p.agent_id}}).ok){recordFloAssistConnectorHealth(owner,provider,'restricted',{db});continue;}
          const {executeConnectorAction,getConnectorActionGuide}=await import('../openconnector.js');
          const guide=await getConnectorActionGuide(owner,app.health_probe.action_id);
          if(!guide.input_schema){recordFloAssistConnectorHealth(owner,provider,'unsupported',{db});continue;}
          await executeConnectorAction(owner,app.health_probe.action_id,app.health_probe.input,{source:p.agent_id,authorizationRetryDelaysMs:[]});
        }
        recordFloAssistConnectorHealth(owner,provider,'available',{db});
      }catch(error){recordFloAssistConnectorHealth(owner,provider,connectorFailureState(error),{db});}
    }
  }
  return {checked};
}
