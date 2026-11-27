/** Explicit user ranges override the default; never silently replace them. */
export function sourceWindow(input,{now=Date.now(),defaultDays=7,direction='past'}={}){
 const fail=()=>{throw Object.assign(Error('Supply both time_min and time_max as valid ISO timestamps with timezone offsets, with time_max after time_min.'),{status:422,code:'FLOASSIST_SOURCE_WINDOW_REQUIRED'});};
 const explicit=input.time_min!=null||input.time_max!=null;
 if(explicit){
  if(![input.time_min,input.time_max].every(v=>typeof v==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/i.test(v)&&Number.isFinite(Date.parse(v))))fail();
  const start=Date.parse(input.time_min),end=Date.parse(input.time_max);if(end<=start)fail();
  return {time_min:new Date(start).toISOString(),time_max:new Date(end).toISOString(),explicit:true};
 }
 return {time_min:new Date(direction==='future'?now:now-defaultDays*86400000).toISOString(),time_max:new Date(direction==='future'?now+defaultDays*86400000:now).toISOString(),explicit:false};
}
export function gmailWindowQuery(input,options){
 const query=String(input.query||'').trim();
 const dated=/(?:^|\s)(?:after|before|newer|older|newer_than|older_than):\S+/i.test(query);
 if(dated&&input.time_min==null&&input.time_max==null)return {query,window:{query,explicit:true}};
 const window=sourceWindow(input,options);
 // Gmail accepts epoch seconds, avoiding its date-string timezone ambiguity.
 return {query:[query,`after:${Math.floor(Date.parse(window.time_min)/1000)}`,`before:${Math.ceil(Date.parse(window.time_max)/1000)}`].filter(Boolean).join(' '),window};
}

/** Resolve relative mailbox days from the authenticated profile, never model UTC. */
export function mailboxDayWindow(now,zone,relativeDay='today'){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
 const noon=Date.UTC(+parts.year,+parts.month-1,+parts.day,12)+(relativeDay==='yesterday'?-86400000:0);
 const midnight=day=>{
  const target=Date.parse(day+'T00:00:00Z');let at=target;
  for(let i=0;i<4;i++){
   const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
   at=target-(Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-at);
  }
  return new Date(at).toISOString();
 };
 return {time_min:midnight(new Date(noon).toISOString().slice(0,10)),time_max:midnight(new Date(noon+86400000).toISOString().slice(0,10))};
}
export function resolveMailboxDay(input,zone,now=Date.now()){
 if(input.relative_day==null)return input;
 if(!['today','yesterday'].includes(input.relative_day)||!['gmail','outlook'].includes(input.app_id)||input.time_min!=null||input.time_max!=null||/(?:^|\s)(?:after|before|newer|older|newer_than|older_than):\S+/i.test(input.query||''))throw Object.assign(Error('relative_day requires Gmail/Outlook and cannot be combined with explicit date filters.'),{status:422,code:'FLOASSIST_SOURCE_WINDOW_REQUIRED'});
 const {relative_day,...request}=input;
 return {...request,...mailboxDayWindow(now,zone,relative_day)};
}
