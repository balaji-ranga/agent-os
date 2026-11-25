// Only correct a misleading duplicate explanation for this exact turn. No
// email bodies, addresses or provider result payloads are retained here.
const failures=new Map();
const key=(session,run)=>session&&run?JSON.stringify([session,run]):null;
export function rememberSourceFailure(session,run,result,now=Date.now()){
 const id=key(session,run);if(!id)return;
 for(const [k,v]of failures)if(v.until<=now)failures.delete(k);
 const data=result?.data;
 const prior=data?._execution?.previous_observation?.result;
 if(data?.code!=='FLOASSIST_SOURCE_ID_INVALID'&&prior?.code!=='FLOASSIST_SOURCE_ID_INVALID'){failures.delete(id);return;}
 if(failures.size>=2048)failures.delete(failures.keys().next().value);
 failures.set(id,{until:now+900000});
}
export function rewriteSourceFailureReply(event,now=Date.now()){
 const id=key(event?.sessionKey,event?.runId),state=failures.get(id),text=event?.payload?.text;
 if(!state||state.until<=now||typeof text!=='string'||!/(?:duplicate action|duplicate attempt|already (?:been )?processed|blocking further execution)/i.test(text))return;
 const prefix=text.match(/^From:[^\n]+\r?\n\s*/)?.[0]||'';
 return {payload:{...event.payload,text:prefix+'I could not read your emails: the request used a mailbox address or label where a message/thread ID was required. No email content was retrieved. Repeating that invalid request was blocked; it does not mean another request successfully read your emails.'}};
}
