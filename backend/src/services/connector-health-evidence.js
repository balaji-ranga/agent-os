import {readFileSync} from 'node:fs';
import {getDb} from '../db/schema.js';
import {connectorFailureState} from './floassist/connector-health.js';
const product=JSON.parse(readFileSync(new URL('./floassist/product.json',import.meta.url),'utf8'));

/** Registration is not OAuth validity. Historical checks never prove current health. */
export function connectorHealthEvidence(owner,inventory,{db=getDb()}={}) {
 const rows=db.prepare("SELECT 1 FROM sqlite_master WHERE name='floassist_connector_health'").get()
  ?db.prepare('SELECT app_id,state,checked_at FROM floassist_connector_health WHERE owner_id=?').all(owner):[];
 const states=new Set(['available','missing','authorization','permission','temporary','unsupported','restricted','unknown']);
 return {...inventory,health_guidance:'connected means registered, not verified working. For a connection-health question, report any last_check failure with its timestamp, then use the provided live_check through connector_execute_action. Only a successful provider response proves current access. Authorization/expired/revoked-token errors require reconnection. Policy or schema errors do not prove token expiry. If no supported check exists, say health is unverified; never infer healthy from registration.',
  apps:(inventory.apps||[]).map(app=>{
   const spec=product.connectors.find(c=>(c.provider_id||c.id)===app.id);
   const check=rows.find(r=>r.app_id===spec?.id);
   return {...app,connection_evidence:{registration_only:true,last_check:check?{state:states.has(check.state)?check.state:'unknown',checked_at:new Date(check.checked_at).toISOString(),historical:true}:null,
    live_check:app.connected===true&&spec?.health_probe?{tool_name:'connector_execute_action',arguments:{action_id:spec.health_probe.action_id,input:spec.health_probe.input},read_only:true,requires_existing_permissions:true}:null}};
  })};
}

/** Agent inventory includes bounded metadata probes, never file/mail content. */
export async function liveConnectorHealthEvidence(owner,inventory,{db=getDb(),probe,timeoutMs=3000}={}) {
 const out=connectorHealthEvidence(owner,inventory,{db});
 out.health_guidance='connected means registration. Use connection_evidence.current_check for this call: available means its read-only provider probe succeeded; authorization means reconnection is needed; restricted means this caller could not check; timeout/unknown/unsupported are unverified, not healthy. last_check is historical. Never describe a historical check as newly executed. A metadata check does not prove every file/action permission.';
 const candidates=out.apps.filter(a=>a.connection_evidence.live_check).slice(0,6);
 for(let i=0;i<candidates.length;i+=2)await Promise.all(candidates.slice(i,i+2).map(async app=>{
  let timer;const config=app.connection_evidence.live_check.arguments;
  try{
   if(!probe)throw Object.assign(Error('Caller cannot probe'),{status:403});
   await Promise.race([Promise.resolve().then(()=>probe(owner,config)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Health check timed out'),{code:'health_timeout'})),timeoutMs);})]);
   app.connection_evidence.current_check={state:'available',checked_at:new Date().toISOString(),action_id:config.action_id};
  }catch(e){
   let state=e.code==='health_timeout'?'timeout':connectorFailureState(e)||'unsupported';
   if(state==='permission'&&!e.provider_status)state='restricted';
   app.connection_evidence.current_check={state,checked_at:new Date().toISOString(),action_id:config.action_id};
  }finally{clearTimeout(timer);}
 }));
 for(const app of out.apps)app.connection_evidence.current_check??={state:app.connected===false?'missing':'unsupported',checked_at:null};
 return out;
}
