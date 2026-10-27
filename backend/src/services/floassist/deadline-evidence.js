import {createHash} from 'node:crypto';
// Full source text is transient: bounded process memory, never a DB body store.
const reads=new Map(), TTL=30*60*1000, MAX_CHARS=2000000;
const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
const key=(owner,run,app,id)=>JSON.stringify([owner,run,app,id]);
function trim(now){
  for(const [k,v]of reads)if(v.expires<=now)reads.delete(k);
  let size=[...reads.values()].reduce((n,v)=>n+v.size,0);
  for(const [k,v]of reads){if(size<=MAX_CHARS)break;reads.delete(k);size-=v.size;}
}
export function recordDeadlineText(owner,context,action,result,now=Date.now()){
  if(!(context?.run||context?.session)||context.owner!==owner)return;
  const data=result?.data?.data||result?.data;
  if(action==='outlook.get_message'&&data?.id&&typeof data.body?.content==='string'&&data.body.contentType?.toLowerCase()!=='html'){
    recordVerifiedSourceText(owner,context,'outlook',data.id,[{text:`Subject: ${data.subject||''}\n${data.body.content}`,at:data.sentDateTime||data.receivedDateTime}],now);return;
  }
  if(action!=='gmail.fetch_message_by_thread_id'||!data?.threadId||!Array.isArray(data.messages))return;
  const messages=data.messages.filter(m=>typeof m.messageText==='string').map(m=>({text:`Subject: ${m.subject||''}\n${m.messageText}`,at:m.messageTimestamp}));
  recordVerifiedSourceText(owner,context,'gmail',data.threadId,messages,now);
}
export function recordVerifiedSourceText(owner,context,app,id,messages,now=Date.now()){
  if(!(context?.run||context?.session)||context.owner!==owner||!id)return;
  messages=messages.map(m=>({text:norm(m.text),at:m.at==null?NaN:/^\d+$/.test(String(m.at))?Number(m.at):Date.parse(m.at)}));
  const size=messages.reduce((n,m)=>n+m.text.length,0);
  if(size>1000000)return;
  reads.set(key(owner,context.run||context.session,app,id),{messages,size,expires:now+TTL});trim(now);
}
const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
function localDay(at,zone){return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));}
function dates(text,at,zone){
  const out=[];
  // Local numeric dates are accepted only when the day cannot be confused
  // with a month. Ambiguous 03/04 dates require clarification.
  for(const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b/g))if(Number(m[1])>12&&Number(m[2])<=12)out.push(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
  for(const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g))out.push(`${m[1]}-${m[2]}-${m[3]}`);
  const names=months.map(m=>m.slice(0,3)+'(?:'+m.slice(3)+')?').join('|');
  for(const m of text.matchAll(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+('+names+')\\s+(20\\d{2})\\b','g'))){
    const month=months.findIndex(x=>x.startsWith(m[2].slice(0,3)))+1;
    out.push(`${m[3]}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`);
  }
  for(const m of text.matchAll(new RegExp('\\b('+names+')\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(20\\d{2})\\b','g'))){
    const month=months.findIndex(x=>x.startsWith(m[1].slice(0,3)))+1;
    out.push(`${m[3]}-${String(month).padStart(2,'0')}-${m[2].padStart(2,'0')}`);
  }
  if(Number.isFinite(at))for(const [word,offset]of [['today',0],['tomorrow',1]])if(new RegExp('\\b'+word+'\\b').test(text)){
    const base=Date.parse(localDay(at,zone)+'T12:00:00Z');out.push(new Date(base+offset*86400000).toISOString().slice(0,10));
  }
  if(Number.isFinite(at)&&!out.length){
    const year=localDay(at,zone).slice(0,4);
    for(const m of text.matchAll(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+('+names+')(?![a-z]|\\s+20\\d{2})\\b','g'))){
      const month=months.findIndex(x=>x.startsWith(m[2].slice(0,3)))+1;
      out.push(`${year}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`);
    }
  }
  return out;
}
function statedZone(text,zone){
 if(/\b(?:utc|gmt)\s*[+-]/.test(text))return null;
 if(/\b(?:utc|gmt)\b/.test(text))return 'UTC';
 if(/\b(?:sgt|singapore time)\b/.test(text))return 'Asia/Singapore';
 if(/\b(?:ist|india(?:n)? time)\b/.test(text))return 'Asia/Kolkata';
 if(/\b(?:wib|jakarta time)\b/.test(text))return 'Asia/Jakarta';
 if(/\bwita\b/.test(text))return 'Asia/Makassar';
 if(/\bwit\b/.test(text))return 'Asia/Jayapura';
 if(/\b(?:pst|pdt|est|edt|cst|cdt|cet|cest)\b/.test(text))return null;
 return zone;
}
function clockMatches(text,due,zone){
  const chosen=statedZone(text,zone);if(!chosen)return false;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:chosen,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(due));
  const actual=Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
  const times=[];
  for(const m of text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/g))times.push((Number(m[1])%12+(m[3]==='pm'?12:0))*60+Number(m[2]||0));
  if(!times.length)for(const m of text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g))times.push(Number(m[1])*60+Number(m[2]));
  return !times.length||times.includes(actual);
}
function endOfDay(day,zone,hour=23,minute=59,second=59){
 const target=Date.parse(day+'T'+[hour,minute,second].map(n=>String(n).padStart(2,'0')).join(':')+'Z');let at=target;
 for(let i=0;i<3;i++){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
  const shown=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second));at=target-(shown-at);
 }
 return new Date(at).toISOString();
}
export function assertDeadlineEvidence(owner,context,input,zone,now=Date.now(),{historicalConfirmed=false}={}){
  trim(now);
  let quote=norm(input.deadline_excerpt);
  const cached=reads.get(key(owner,context.run||context.session,input.app_id,input.source_id));
  if(quote.startsWith('fa-evidence-'))quote=cached?.references?.get(quote)||'';
  const fail=message=>{throw Object.assign(new Error(message),{status:409,code:'FLOASSIST_DEADLINE_EVIDENCE_REQUIRED'});};
  if(quote.length<12||quote.length>1200||! /\b(by|before|due|deadline|submit|approve|renew|pay|reply|send|deliver|return|complete|finish)\b/.test(quote))fail('Supply deadline_excerpt: an exact short source passage stating the requested action and deadline. File metadata, message timestamps and a task title are not deadline evidence.');
  if(!cached)fail('No complete readable source text is available for this deadline in the current run. Read the source content first; metadata/listing/export links alone cannot create or repeat a deadline task. Report unavailable document-content coverage rather than inventing a deadline.');
  const due=Date.parse(input.due_at);
  if(!Number.isFinite(due))fail('A valid obligation deadline is required.');
  const chosen=statedZone(quote,zone);
  const match=chosen&&cached.messages.find(m=>{const found=[...new Set(dates(quote,m.at,chosen))];return m.text.includes(quote)&&found.length===1&&found[0]===localDay(due,chosen)&&clockMatches(quote,due,zone);});
  if(!match)fail('The excerpt and deadline date do not match a freshly read source. Use the actual obligation passage, including its year, or ask about an ambiguous date. Do not use sent/created/modified timestamps.');
  if(due<now-30*86400000&&!historicalConfirmed)throw Object.assign(new Error('This deadline is more than 30 days overdue. Ask whether the obligation is still relevant. An authenticated Kanban update/reopen explicitly confirming it is still required enables tracking; a model assertion cannot.'),{status:409,code:'FLOASSIST_DEADLINE_CONFIRMATION_REQUIRED'});
  const precision=/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b/.test(quote)?'minute':'day';
  return {verified:true,precision,...(precision==='day'?{due_at:endOfDay(localDay(due,chosen),chosen)}:{})};
}
export function historicalDeadlineConfirmed(db,owner,input){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='kanban_user_action_audit'").get()||!db.prepare("SELECT 1 FROM sqlite_master WHERE name='floassist_task_tracking'").get())return false;
 const task=db.prepare('SELECT task_id FROM floassist_task_tracking WHERE owner_id=? AND app_id=? AND source_id=? AND obligation_key=?').get(owner,input.app_id,input.source_id,input.obligation_key||'action');
 if(!task)return false;
 const rows=db.prepare("SELECT evidence FROM kanban_user_action_audit WHERE owner_user_id=? AND task_id=? AND status='ok' AND action IN ('update','reopen') AND created_at>=datetime('now','-7 days') ORDER BY id DESC LIMIT 5").all(owner,task.task_id);
 return rows.some(r=>/\b(still required|still outstanding|still relevant|keep tracking|continue tracking)\b/i.test(r.evidence)&&! /\b(not|no longer|don't|do not|stop)\b/i.test(r.evidence));
}

// References avoid asking the model to retype source sentences. Every resolution
// remains bound to the exact owner, run/session, app and source and is validated
// by the same date/time checks as a literal passage.
export function deadlineEvidenceSuggestions(owner,context,app,id,zone,segment,now=Date.now()){
 trim(now);const cached=reads.get(key(owner,context.run||context.session,app,id));if(!cached)return [];
 cached.references??=new Map();const output=[],text=norm(segment);
 for(const match of text.matchAll(/\b(submit|approve|renew|pay|reply|send|deliver|return|complete|finish)\b/g)){
  let end=text.indexOf('. ',match.index);if(end<0||end-match.index>300)end=Math.min(text.length,match.index+300);
  const quote=text.slice(match.index,end).trim();if(quote.length<12)continue;
  const message=cached.messages.find(m=>m.text.includes(quote));if(!message)continue;
  const chosen=statedZone(quote,zone);if(!chosen)continue;const found=[...new Set(dates(quote,message.at,chosen))];if(found.length!==1)continue;
  const times=[];for(const t of quote.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/g))times.push((Number(t[1])%12+(t[3]==='pm'?12:0))*60+Number(t[2]||0));
  if(!times.length)for(const t of quote.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g))times.push(Number(t[1])*60+Number(t[2]));
  const unique=[...new Set(times)];if(unique.length>1)continue;
  const due=unique.length?endOfDay(found[0],chosen,Math.floor(unique[0]/60),unique[0]%60,0):endOfDay(found[0],chosen);
  if(!clockMatches(quote,Date.parse(due),chosen))continue;
  let reference=[...cached.references].find(([,q])=>q===quote)?.[0];
  if(!reference){if(cached.references.size>=100)continue;reference='fa-evidence-'+createHash('sha256').update(JSON.stringify([owner,context.run||context.session,app,id,quote])).digest('hex').slice(0,16);cached.references.set(reference,quote);}
  if(!output.some(r=>r.deadline_excerpt===reference))output.push({deadline_excerpt:reference,passage:quote,due_at:due,timezone:chosen});if(output.length>=4)break;
 }
 return output;
}
