import Database from 'better-sqlite3';
import {join} from 'node:path';
import {getOpenClawDir} from '../config/openclaw-paths.js';
import {parseTenantOpenClawAgentId} from './openclaw-tenant.js';

/** A transport timeout after sending must not cause another send. Read only
 * trusted runtime delivery mirrors, never user/LLM assertions of delivery. */
export function hasTrackedDeliveryReceipt(job,{root=getOpenClawDir()}={}){
 const tenant=parseTenantOpenClawAgentId(job.agent_id);
 if(tenant?.ceoUserId!==job.owner_user_id||!/^[a-zA-Z0-9_-]+$/.test(job.agent_id)||!/^track-[a-f0-9-]{36}$/.test(job.id))return false;
 const start=Date.parse(job.created_at);if(!Number.isFinite(start))return false;
 let db;
 try{
  db=new Database(join(root,'agents',job.agent_id,'agent','openclaw-agent.sqlite'),{readonly:true,fileMustExist:true,timeout:50});
  const rows=db.prepare('SELECT event_json FROM transcript_events WHERE rowid>(SELECT max(rowid)-150 FROM transcript_events) AND length(event_json)<=100000 AND instr(event_json,?)>0 LIMIT 10').all(job.id);
  return rows.some(({event_json})=>{
   let event;try{event=JSON.parse(event_json);}catch{return false;}
   const message=event.message,time=Date.parse(event.timestamp);
   if(message?.role!=='assistant'||message.provider!=='openclaw'||message.model!=='delivery-mirror'||!Number.isFinite(time)||time<start)return false;
   const text=typeof message.content==='string'?message.content:(message.content||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');
   return text.includes(`Tracking ID: ${job.id}\n`);
  });
 }catch{return false;}finally{db?.close();}
}
