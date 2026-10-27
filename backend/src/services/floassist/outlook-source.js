// Outlook translates into the shared mail-thread contract. It owns no alert,
// scheduling, Kanban or delivery decisions. All I/O uses the caller's authorized run.
import {recordSourceReceipt,recordMailThreadReceipt} from './source-receipts.js';

const PREFIX='outlook-conversation:';
const fields=['id','conversationId','subject','from','sender','sentDateTime','receivedDateTime','isDraft','body'];
const fail=(code,message)=>{throw Object.assign(new Error(message),{code,status:422});};
export const isOutlookConversationSource=id=>typeof id==='string'&&id.startsWith(PREFIX);
const sourceId=(account,conversation)=>PREFIX+encodeURIComponent(account)+':'+encodeURIComponent(conversation);
const email=value=>typeof value==='string'?value.trim().toLowerCase():'';
export function outlookIdentity(profile){
 profile=profile||{};
 const addresses=[profile.mail,profile.userPrincipalName].map(email).filter(v=>/^[^\s@]+@[^\s@]+$/.test(v));
 if(typeof profile.id!=='string'||!profile.id.trim()||!addresses.length)fail('FLOASSIST_OUTLOOK_IDENTITY_REQUIRED','Outlook must return its authenticated account ID and mailbox address. Verify User.Read and mailbox access.');
 return {id:profile.id,account_id:addresses[0],addresses:new Set(addresses)};
}
function conversationFromSource(id,identity){
 if(!isOutlookConversationSource(id))return null;
 const parts=id.slice(PREFIX.length).split(':');
 if(parts.length!==2)fail('FLOASSIST_SOURCE_MISMATCH','Malformed Outlook conversation identity.');
 let account,conversation;try{[account,conversation]=parts.map(decodeURIComponent);}catch{fail('FLOASSIST_SOURCE_MISMATCH','Malformed Outlook conversation identity.');}
 if(account!==identity.id)fail('FLOASSIST_SOURCE_ACCOUNT_MISMATCH','This task belongs to another Outlook mailbox connection. Reconnect its original account; no source was read.');
 if(!conversation)fail('FLOASSIST_SOURCE_MISMATCH','Missing Outlook conversation identity.');
 return conversation;
}
function checkedNextLink(link,identity,conversation){
 let url;try{url=new URL(link);}catch{fail('FLOASSIST_SOURCE_READ_FAILED','Invalid Outlook pagination link.');}
 const allowedPaths=['/v1.0/me/messages',`/v1.0/users/${identity.id}/messages`];
 const filter=`conversationId eq '${conversation.replaceAll("'","''")}'`;
 if(url.origin!=='https://graph.microsoft.com'||url.username||url.password||url.hash||!allowedPaths.includes(decodeURI(url.pathname))||(url.searchParams.has('$filter')&&url.searchParams.get('$filter')!==filter))
  fail('FLOASSIST_SOURCE_READ_FAILED','Outlook pagination must remain on this authenticated mailbox conversation.');
 return link;
}
function callFor({owner,run,db,context,now}){
 return async(action,input)=>{const data=await run(action,input);recordSourceReceipt(owner,action,{data},{db,context,now});return data;};
}
export async function discoverOutlookSources(options){
 const call=callFor(options),identity=outlookIdentity(await call('outlook.get_profile',{}));
 const sent=options.context.origin==='floassist:followups';
 const since=new Date(options.now-(options.lookbackDays??7)*86400000).toISOString();
 const dateField=sent?'sentDateTime':'receivedDateTime';
 const data=await call('outlook.list_messages',{...(sent?{mailFolderId:'sentitems'}:{}),top:40,filter:`${dateField} ge ${since} and isDraft eq false`,orderby:`${dateField} desc`,select:fields.filter(f=>f!=='body'),bodyContentType:'text'});
 if(!Array.isArray(data.messages)||data.messages.some(m=>!m.id||!m.conversationId||typeof m.isDraft!=='boolean'))fail('FLOASSIST_SOURCE_READ_FAILED','Outlook discovery did not return message and conversation identities.');
 const candidates=[...new Set(data.messages.filter(m=>!m.isDraft).map(m=>sourceId(identity.id,m.conversationId)))].map(source_id=>({app_id:'outlook',source_id}));
 recordSourceReceipt(options.owner,'outlook.list_messages',{data:{messages:candidates.map(c=>({id:c.source_id}))}},{db:options.db,context:options.context,now:options.now});
 return {identity,candidates,more:!!(data.nextLink||data['@odata.nextLink']||data.nextPageToken)};
}
export async function readOutlookSource(id,options){
 const call=callFor(options),identity=outlookIdentity(await call('outlook.get_profile',{}));
 let routed=id;
 if(id&&!isOutlookConversationSource(id)){const mapped=options.db.prepare('SELECT thread_id FROM floassist_message_threads WHERE owner_id=? AND app_id=? AND message_id=?').get(options.owner,'outlook',id);if(isOutlookConversationSource(mapped?.thread_id))routed=mapped.thread_id;}
 let conversation=conversationFromSource(routed,identity),anchor;
 if(!conversation){
  if(!id){const list=await call('outlook.list_messages',{top:40,orderby:'receivedDateTime desc',bodyContentType:'text',select:['id','conversationId','isDraft']});
   if(!Array.isArray(list.messages))fail('FLOASSIST_SOURCE_READ_FAILED','Outlook did not return a mailbox list.');
   id=list.messages.find(m=>!m.isDraft)?.id;
   if(!id&&(list.nextLink||list['@odata.nextLink']||list.nextPageToken))fail('FLOASSIST_SOURCE_COVERAGE_LIMIT','The bounded latest-mail page contains only drafts; additional messages remain unread.');
   if(!id)return {empty:true,complete:!(list.nextLink||list['@odata.nextLink']||list.nextPageToken),identity};
  }
  const message=await call('outlook.get_message',{messageId:id,bodyContentType:'text',select:fields});
  if(message.id!==id||typeof message.conversationId!=='string'||!message.conversationId||typeof message.isDraft!=='boolean')fail('FLOASSIST_SOURCE_READ_FAILED','Outlook did not identify the requested message and conversation.');
  if(message.isDraft)fail('FLOASSIST_SOURCE_UNSUPPORTED','An unsent Outlook draft is not a sent conversation obligation. Use an explicit draft action to read it.');
  conversation=message.conversationId;anchor=id;
 }
 const canonical=sourceId(identity.id,conversation),messages=[],seen=new Set(),links=new Set();let next;
 for(let page=0;page<3;page++){
  const data=await call('outlook.list_messages',next?{nextLink:next,bodyContentType:'text'}:{filter:`conversationId eq '${conversation.replaceAll("'","''")}'`,top:40,select:fields,bodyContentType:'text'});
  if(!Array.isArray(data.messages))fail('FLOASSIST_SOURCE_READ_FAILED','Outlook conversation content is unavailable.');
  for(const m of data.messages){
   if(!m.id||m.conversationId!==conversation||seen.has(m.id)||typeof m.isDraft!=='boolean')fail('FLOASSIST_SOURCE_READ_FAILED','Outlook returned a mismatched or repeated conversation message.');
   seen.add(m.id);
   if(m.isDraft)continue;
   const at=Date.parse(m.sentDateTime||m.receivedDateTime);
   if(!Number.isFinite(at)||typeof m.body?.content!=='string'||m.body.contentType?.toLowerCase()!=='text')fail('FLOASSIST_SOURCE_READ_FAILED','Complete Outlook text bodies and provider timestamps are required.');
   const from=email(m.from?.emailAddress?.address),sender=email(m.sender?.emailAddress?.address);
   if(!from&&!sender)fail('FLOASSIST_SOURCE_READ_FAILED','Outlook sender identity is required to verify reply direction.');
   messages.push({messageId:m.id,threadId:canonical,subject:m.subject||'',messageText:m.body.content,messageTimestamp:at,labelIds:identity.addresses.has(from)||identity.addresses.has(sender)?['SENT']:['INBOX']});
   if(seen.size>100||messages.reduce((n,v)=>n+v.messageText.length,0)>1000000)fail('FLOASSIST_SOURCE_COVERAGE_LIMIT','Outlook conversation exceeds the bounded review limit; no complete-thread claim can be made.');
  }
  next=data.nextLink||data['@odata.nextLink']||data.nextPageToken;
  if(!next)break;
  if(page===2||messages.length>=100)fail('FLOASSIST_SOURCE_COVERAGE_LIMIT','Outlook conversation has unread provider pages; no complete-thread claim can be made.');
  next=checkedNextLink(next,identity,conversation);
  if(links.has(next))fail('FLOASSIST_SOURCE_READ_FAILED','Outlook repeated a conversation page.');links.add(next);
 }
 if(anchor&&!seen.has(anchor))fail('FLOASSIST_SOURCE_READ_FAILED','The requested Outlook message was absent from the complete conversation.');
 messages.sort((a,b)=>a.messageTimestamp-b.messageTimestamp||a.messageId.localeCompare(b.messageId));
 // A tie involving different directions cannot prove who replied last.
 const latest=messages.at(-1),ties=latest&&messages.filter(m=>m.messageTimestamp===latest.messageTimestamp);
 const directionCertain=!ties||new Set(ties.map(m=>m.labelIds[0])).size===1;
 recordMailThreadReceipt(options.owner,'outlook',{threadId:canonical,messages,complete:true,directionCertain},{db:options.db,context:options.context,now:options.now});
 return {source_id:canonical,messages,identity,empty:!messages.length,complete:true,latest_message_id:latest?.messageId,latest_message_at:latest?new Date(latest.messageTimestamp).toISOString():null,latest_message_sent:!!latest&&directionCertain&&latest.labelIds.includes('SENT'),reply_direction_verified:directionCertain};
}
