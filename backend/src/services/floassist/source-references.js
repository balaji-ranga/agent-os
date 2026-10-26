import {currentFloAssistScope} from './execution-scope.js';
const apps={gmail:'gmail',googledrive:'google_drive'};
const active=(owner,c)=>!!c?.run&&c.owner===owner;
function ensure(db){db.exec('CREATE TABLE IF NOT EXISTS floassist_source_references(owner_id TEXT,run_id TEXT,app_id TEXT,reference TEXT,source_id TEXT,created_at INTEGER,PRIMARY KEY(owner_id,run_id,app_id,reference),UNIQUE(owner_id,run_id,app_id,source_id))');}
export function sourceReference(db,owner,app,id,context=currentFloAssistScope()){
 if(!active(owner,context)||typeof id!=='string'||!id||id.length>500)return id;
 ensure(db);app=apps[app]||app;
 if(!['gmail','google_drive'].includes(app))return id;
 return db.transaction(()=>{
  const old=db.prepare('SELECT reference FROM floassist_source_references WHERE owner_id=? AND run_id=? AND app_id=? AND source_id=?').get(owner,context.run,app,id);
  if(old)return old.reference;
  const n=db.prepare('SELECT count(*) n FROM floassist_source_references WHERE owner_id=? AND run_id=? AND app_id=?').get(owner,context.run,app).n+1;
  const ref=`fa-ref-${n}`;
  db.prepare('INSERT INTO floassist_source_references VALUES (?,?,?,?,?,?)').run(owner,context.run,app,ref,id,Date.now());
  db.prepare('DELETE FROM floassist_source_references WHERE created_at<?').run(Date.now()-7*86400000);
  return ref;
 })();
}
export function resolveSourceReference(db,owner,app,id,context=currentFloAssistScope()){
 if(!active(owner,context)||typeof id!=='string'||!id.startsWith('fa-ref-'))return id;
 ensure(db);app=apps[app]||app;
 const row=db.prepare('SELECT source_id FROM floassist_source_references WHERE owner_id=? AND run_id=? AND app_id=? AND reference=?').get(owner,context.run,app,id);
 if(!row)throw Object.assign(new Error('Unknown source reference for this owner, run and app. Read the current source list and copy its exact reference.'),{status:400,code:'FLOASSIST_SOURCE_REFERENCE_INVALID'});
 return row.source_id;
}
const idKeys=new Set(['id','threadId','messageId','fileId','thread_id','message_id','file_id']);
function mapIds(value,convert,key=''){
 if(typeof value==='string')return idKeys.has(key)||['threadIds','messageIds','fileIds'].includes(key)?convert(value):value;
 if(Array.isArray(value))return value.map(v=>mapIds(v,convert,key));
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,mapIds(v,convert,k)]));
}
export function connectorReferenceInput(db,owner,action,input,context=currentFloAssistScope()){
 if(!active(owner,context))return input;
 const app=apps[action.split('.')[0]];if(!app)return input;
 return mapIds(input,id=>resolveSourceReference(db,owner,app,id,context));
}
export function connectorReferenceResult(db,owner,action,result,context=currentFloAssistScope()){
 if(!active(owner,context))return result;
 const app=apps[action.split('.')[0]];if(!app||!result?.data||typeof result.data!=='object')return result;
 // Canonical provider data was already receipted. Do not duplicate serialized
 // text or let the model retype opaque provider IDs from a second representation.
 const {text,raw,...rest}=result;
 return {...rest,data:mapIds(result.data,id=>sourceReference(db,owner,app,id,context)),source_reference_instruction:'Use the returned fa-ref identifiers verbatim in connector ID fields and tracking source_id/latest_message_id. The server resolves them within this owner, run and app. References do not prove a full thread read.'};
}
export function trackingReferenceResult(db,owner,value,context=currentFloAssistScope()){
 if(!active(owner,context)||!value||typeof value!=='object')return value;
 if(Array.isArray(value))return value.map(v=>trackingReferenceResult(db,owner,v,context));
 const out={...value};
 if(out.app_id&&typeof out.source_id==='string')out.source_id=sourceReference(db,owner,out.app_id,out.source_id,context);
 for(const [k,v]of Object.entries(out))if(v&&typeof v==='object')out[k]=trackingReferenceResult(db,owner,v,context);
 return out;
}
