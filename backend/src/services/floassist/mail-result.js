import {currentFloAssistScope} from './execution-scope.js';

/** Keep semantic email content once; MIME bodies and duplicate serialized text
 * can otherwise exhaust the model context before it evaluates the thread. */
export function projectFloAssistMailResult(action,result,context=currentFloAssistScope()){
  if(!context||!['gmail.fetch_emails','gmail.fetch_message_by_thread_id'].includes(action))return result;
  const nested=result?.data?.data, data=nested||result?.data;
  if(!Array.isArray(data?.messages))return result;
  const thread=action==='gmail.fetch_message_by_thread_id';
  const messages=data.messages.map(m=>{
    const {payload,messageText,...metadata}=m;
    if(thread&&typeof messageText!=='string')throw Object.assign(new Error('Thread content is unavailable in normalized text; source verification is incomplete.'),{code:'FLOASSIST_THREAD_CONTENT_UNAVAILABLE'});
    return thread?{...metadata,messageText}:metadata;
  });
  const projected={...data,messages,content_mode:thread?'complete_thread_text':'discovery_metadata',guidance:thread?'Every message text is preserved. MIME payload and duplicate serialization omitted.':'Read relevant complete threads before deciding whether an action remains outstanding.'};
  // Fail explicitly rather than silently clipping the latest state or claiming
  // a partial body is a complete source check.
  if(thread&&JSON.stringify(projected).length>120000)throw Object.assign(new Error('This thread exceeds the safe review size. No alert may be inferred from an incomplete thread; request a focused review.'),{code:'FLOASSIST_THREAD_REVIEW_TOO_LARGE'});
  const {text,raw,...rest}=result;
  return {...rest,data:nested?{...result.data,data:projected}:projected};
}
