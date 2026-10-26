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
  if(!context?.run||context.owner!==owner)return;
  const data=result?.data?.data||result?.data;
  if(action!=='gmail.fetch_message_by_thread_id'||!data?.threadId||!Array.isArray(data.messages))return;
  const messages=data.messages.filter(m=>typeof m.messageText==='string').map(m=>({text:norm(m.messageText),at:/^\d+$/.test(String(m.messageTimestamp))?Number(m.messageTimestamp):Date.parse(m.messageTimestamp)}));
  const size=messages.reduce((n,m)=>n+m.text.length,0);
  if(size>120000)return;
  reads.set(key(owner,context.run,'gmail',data.threadId),{messages,size,expires:now+TTL});trim(now);
}
const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
function localDay(at,zone){return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));}
function dates(text,at,zone){
  const out=[];
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
  return out;
}
function clockMatches(text,due,zone){
  const statedZone=/\b(?:utc|gmt)\b/.test(text)?'UTC':/\bsgt\b/.test(text)?'Asia/Singapore':zone;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:statedZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(due));
  const actual=Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
  const times=[];
  for(const m of text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/g))times.push((Number(m[1])%12+(m[3]==='pm'?12:0))*60+Number(m[2]||0));
  if(!times.length)for(const m of text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g))times.push(Number(m[1])*60+Number(m[2]));
  return !times.length||times.includes(actual);
}
export function assertDeadlineEvidence(owner,context,input,zone,now=Date.now()){
  trim(now);
  const quote=norm(input.deadline_excerpt);
  const fail=message=>{throw Object.assign(new Error(message),{status:409,code:'FLOASSIST_DEADLINE_EVIDENCE_REQUIRED'});};
  if(quote.length<12||quote.length>1200||! /\b(by|before|due|deadline|submit|approve|renew|pay|reply)\b/.test(quote))fail('Supply deadline_excerpt: an exact short source passage stating the requested action and deadline. File metadata, message timestamps and a task title are not deadline evidence.');
  const cached=reads.get(key(owner,context.run,input.app_id,input.source_id));
  if(!cached)fail('No complete readable source text is available for this deadline in the current run. Read the source content first; metadata/listing/export links alone cannot create or repeat a deadline task. Report unavailable document-content coverage rather than inventing a deadline.');
  const due=Date.parse(input.due_at);
  if(!Number.isFinite(due))fail('A valid obligation deadline is required.');
  const match=cached.messages.find(m=>m.text.includes(quote)&&dates(quote,m.at,zone).includes(localDay(due,zone))&&clockMatches(quote,due,zone));
  if(!match)fail('The excerpt and deadline date do not match a freshly read source. Use the actual obligation passage, including its year, or ask about an ambiguous date. Do not use sent/created/modified timestamps.');
  if(due<now-30*86400000)fail('This deadline is more than 30 days overdue. Do not create or repeat a proactive deadline alert from historical material; ask the owner whether the old obligation is still relevant.');
  return {verified:true};
}
