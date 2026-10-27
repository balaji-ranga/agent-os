/** Read-only native telemetry. Emits counts only, never bodies, prompts or IDs.
 * node scripts/audit-floassist-native-efficiency.mjs --db <agent sqlite> --since <ISO> --until <ISO>
 * Provider-reported usage is incomplete on some gateway aliases; null is not zero spend.
 */
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

export function auditNativeEfficiency(db,{since,until}){
 const from=Date.parse(since),to=Date.parse(until);
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)throw Error('Supply a valid explicit since/until window.');
 const seen=new Set(),pages=new Set();
 const result={since:new Date(from).toISOString(),until:new Date(to).toISOString(),assistantEvents:0,eventsWithReportedUsage:0,eventsWithoutReportedUsage:0,reportedTokens:null,toolCalls:0,toolErrors:0,sourceReads:0,sourceCharacters:0,repeatedInitialPages:0,compactions:0,duplicateEvents:0,scheduledAssistantEvents:0,otherAssistantEvents:0};
 for(const row of db.prepare('SELECT s.session_key,e.event_json FROM transcript_events e JOIN session_windows s ON s.session_id=e.session_id').iterate()){
  let event;try{event=JSON.parse(row.event_json);}catch{continue;}
  const message=event.message,at=Number(message?.timestamp)||Date.parse(event.timestamp||'');
  if(!(at>=from&&at<to))continue;
  const identity=event.id||message?.idempotencyKey;
  if(identity&&seen.has(identity)){result.duplicateEvents++;continue;}
  if(identity)seen.add(identity);
  if(String(event.type).includes('compact'))result.compactions++;
  if(!message)continue;
  if(message.role==='assistant'&&message.model!=='delivery-mirror'){
   result.assistantEvents++;
   result[String(row.session_key).includes('sched-')?'scheduledAssistantEvents':'otherAssistantEvents']++;
   const total=Number(message.usage?.totalTokens);
   if(Number.isFinite(total)&&total>0){result.eventsWithReportedUsage++;result.reportedTokens=(result.reportedTokens||0)+total;}
   else result.eventsWithoutReportedUsage++;
  }
  for(const block of Array.isArray(message.content)?message.content:[]){
   if(block.type==='toolCall'){result.toolCalls++;if(block.name==='floassist_source_read')result.sourceReads++;}
   if(message.role!=='toolResult'||block.type!=='text')continue;
   let value;try{value=JSON.parse(block.text);}catch{continue;}
   if(typeof value.content==='string'&&value.app_id&&value.source_id){
    result.sourceCharacters+=value.content.length;
    if(value.offset===0){const key=JSON.stringify([row.session_key,value.app_id,value.source_id]);if(pages.has(key))result.repeatedInitialPages++;pages.add(key);}
   }
  }
  if(message.role==='toolResult'&&message.isError)result.toolErrors++;
 }
 result.usageComplete=result.eventsWithoutReportedUsage===0&&result.eventsWithReportedUsage>0;
 return result;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,arg,i,all)=>arg.startsWith('--')?[...pairs,[arg.slice(2),all[i+1]]]:pairs,[]));
 if(!args.db)throw Error('Supply --db for the intended owner agent database. No database is selected automatically.');
 const db=new DatabaseSync(args.db,{readOnly:true});
 try{console.log(JSON.stringify(auditNativeEfficiency(db,{since:args.since,until:args.until})));}finally{db.close();}
}
