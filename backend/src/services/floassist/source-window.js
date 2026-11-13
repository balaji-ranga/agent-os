/** Explicit user ranges override the default; never silently replace them. */
export function sourceWindow(input,{now=Date.now(),defaultDays=7}={}){
 const fail=()=>{throw Object.assign(Error('Supply both time_min and time_max as valid ISO timestamps with timezone offsets, with time_max after time_min.'),{status:422,code:'FLOASSIST_SOURCE_WINDOW_REQUIRED'});};
 const explicit=input.time_min!=null||input.time_max!=null;
 if(explicit){
  if(![input.time_min,input.time_max].every(v=>typeof v==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/i.test(v)&&Number.isFinite(Date.parse(v))))fail();
  const start=Date.parse(input.time_min),end=Date.parse(input.time_max);if(end<=start)fail();
  return {time_min:new Date(start).toISOString(),time_max:new Date(end).toISOString(),explicit:true};
 }
 return {time_min:new Date(now-defaultDays*86400000).toISOString(),time_max:new Date(now).toISOString(),explicit:false};
}
export function gmailWindowQuery(input,options){
 const query=String(input.query||'').trim();
 const dated=/(?:^|\s)(?:after|before|newer|older|newer_than|older_than):\S+/i.test(query);
 if(dated&&input.time_min==null&&input.time_max==null)return {query,window:{query,explicit:true}};
 const window=sourceWindow(input,options);
 // Gmail accepts epoch seconds, avoiding its date-string timezone ambiguity.
 return {query:[query,`after:${Math.floor(Date.parse(window.time_min)/1000)}`,`before:${Math.ceil(Date.parse(window.time_max)/1000)}`].filter(Boolean).join(' '),window};
}
