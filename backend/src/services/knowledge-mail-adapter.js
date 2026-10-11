import { executeConnectorAction, getConnectorConnectionsForUser } from './openconnector.js';
import { fingerprint } from './knowledge-contract.js';
import { versionedSource } from './knowledge-versioned-source.js';

function unwrap(response,field) {
  let data=response;
  for(let i=0;i<6;i++){
    if(data?.ok===false||data?.success===false)throw Object.assign(new Error('Mailbox provider request failed'),{status:data.status||data.error?.status||data.error?.code});
    if(data&&Object.hasOwn(data,field))return data;
    data=data?.data||data?.result;
  }
  throw new Error('Mailbox provider returned an incomplete response');
}

// History discovers changes, while the ID-only query reconciles membership.
// This also handles relative-date queries and old messages gaining/losing labels.
async function gmailChanges(owner,execute,incremental,signal){
  const profile=unwrap(await execute(owner,'gmail.get_profile',{}),'historyId');
  if(!/^\d+$/.test(String(profile.historyId)))throw new Error('Invalid Gmail history checkpoint');
  const next=String(profile.historyId),previous=incremental.checkpoint('gmail');
  if(!previous)return {next,changed:null};
  if(BigInt(next)<BigInt(previous))return {next,changed:null};
  const changed=new Set(),seen=new Set();let cursor;
  try{
    do{
      signal?.throwIfAborted();
      const page=unwrap(await execute(owner,'gmail.list_history',{startHistoryId:previous,maxResults:100,...(cursor?{pageToken:cursor}:{})}),'history');
      if(!Array.isArray(page.history))throw new Error('Invalid Gmail history page');
      for(const event of page.history){
        for(const field of ['messages','messagesAdded','messagesDeleted','labelsAdded','labelsRemoved']){
          if(event[field]!=null&&!Array.isArray(event[field]))throw new Error('Invalid Gmail history event');
          for(const item of event[field]||[]){
            const id=item.message?.id||item.id;
            if(typeof id!=='string'||!id)throw new Error('Gmail history item has no ID');
            changed.add(id);
          }
        }
      }
      // Bounded memory: unusually large history safely falls back to full reads.
      if(changed.size>10000)return {next,changed:null};
      cursor=page.nextPageToken;
      if(cursor&&(typeof cursor!=='string'||seen.has(cursor)))throw new Error('Invalid Gmail history pagination');
      if(cursor)seen.add(cursor);
    }while(cursor);
  }catch(error){
    if(Number(error.provider_status||error.status||error.statusCode)===404)return {next,changed:null};
    throw error;
  }
  return {next,changed};
}

export async function mailConnectionRef(owner,kind,{connections=getConnectorConnectionsForUser}={}) {
  const result=await connections(owner);
  const matches=result.connections.filter(c=>c.app_id===kind&&c.connected);
  if(matches.length!==1)throw new Error(`Connect one ${kind} mailbox before indexing it`);
  const connection=matches[0];
  if(!connection.account_name)throw new Error('Connector must expose the connected mailbox identity before Knowledge indexing can be enabled');
  return fingerprint([owner,kind,connection.connection_name,connection.account_name]);
}
function messagePage(response) {
  let data=response;
  for(let i=0;i<5;i++) {
    if(data?.ok===false||data?.success===false)throw new Error('Mailbox provider returned a failed page');
    if(Array.isArray(data?.messages))return data;
    data=data?.data||data?.result;
  }
  throw new Error('Mailbox page is incomplete or malformed; previous snapshot was not replaced');
}
function outlookCursor(value) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.hostname!=='graph.microsoft.com'||url.port||url.username||url.password||url.hash)throw new Error('Invalid Outlook pagination origin');
  return value;
}
export async function* mailRecords(owner,source,{signal,execute=executeConnectorAction,incremental}={}) {
  let cursor=null;const seen=new Set();
  const gmail=source.kind==='gmail';
  const changes=gmail&&incremental?await gmailChanges(owner,execute,incremental,signal):null;
  do {
    signal?.throwIfAborted();
    const input=source.kind==='gmail'
      ?{query:source.query||'-in:trash -in:spam',maxResults:100,detail:incremental?'ids':'full',includeSpamTrash:false,...(cursor?{pageToken:cursor}:{})}
      :{top:100,bodyContentType:'text',...(incremental?{select:['id','lastModifiedDateTime','changeKey']}:{}),...(source.folder_id?{mailFolderId:source.folder_id}:{}),...(cursor?{nextLink:outlookCursor(cursor)}:{})};
    const page=messagePage(await execute(owner,source.kind==='gmail'?'gmail.fetch_emails':'outlook.list_messages',input));
    for(const message of page.messages) {
      const id=gmail?(message.messageId||message.id):message.id;
      if(typeof id!=='string'||!id)throw new Error('Mailbox item has no stable ID');
      const key=`messages/${id}`;
      if(changes?.changed&&!changes.changed.has(id)&&await incremental.reuse(key,undefined))continue;
      const version=gmail?changes?.next:(message.changeKey||message.lastModifiedDateTime||null);
      yield* versionedSource(key,version,async function*(){
      const full=incremental?unwrap(await execute(owner,gmail?'gmail.fetch_message_by_message_id':'outlook.get_message',gmail?{messageId:id,format:'full'}:{messageId:id,bodyContentType:'text'}),gmail?'messageId':'id'):message;
      if((gmail?full.messageId:full.id)!==id)throw new Error('Mailbox returned a different message ID');
      const body=gmail?full.messageText:full.body?.content;
      if(typeof body!=='string')throw new Error('Mailbox item body missing; request full message read permission');
      const sender=gmail?full.sender:full.from?.emailAddress?.address;
      const subject=String(full.subject||'(no subject)');
      yield {object_id:`messages/${id}`,title:subject,text:`Subject: ${subject}\nFrom: ${sender||''}\n\n${body}`,
        fields:{sender:sender||'',attachment_indexing:'not_enabled'},relations:[],
        modified_at:full.lastModifiedDateTime||full.messageTimestamp||full.receivedDateTime||null};
      },gmail&&incremental?{...incremental,reuse:async()=>false}:incremental);
    }
    cursor=(source.kind==='gmail'?page.nextPageToken:page.nextLink)||null;
    if(cursor!==null&&typeof cursor!=='string')throw new Error('Invalid mailbox pagination token');
    if(cursor&&seen.has(cursor))throw new Error('Mailbox repeated a pagination cursor');
    if(cursor)seen.add(cursor);
  } while(cursor);
  if(changes)yield {knowledge_control:'checkpoint',key:'gmail',value:changes.next};
}
