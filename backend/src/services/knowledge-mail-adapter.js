import { executeConnectorAction, getConnectorConnectionsForUser } from './openconnector.js';
import { fingerprint } from './knowledge-contract.js';

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
export async function* mailRecords(owner,source,{signal,execute=executeConnectorAction}={}) {
  let cursor=null;const seen=new Set();
  do {
    signal?.throwIfAborted();
    const input=source.kind==='gmail'
      ?{query:source.query||'-in:trash -in:spam',maxResults:25,detail:'full',includeSpamTrash:false,...(cursor?{pageToken:cursor}:{})}
      :{top:25,bodyContentType:'text',...(source.folder_id?{mailFolderId:source.folder_id}:{}),...(cursor?{nextLink:outlookCursor(cursor)}:{})};
    const page=messagePage(await execute(owner,source.kind==='gmail'?'gmail.fetch_emails':'outlook.list_messages',input));
    for(const message of page.messages) {
      const id=source.kind==='gmail'?message.messageId:message.id;
      if(typeof id!=='string'||!id)throw new Error('Mailbox item has no stable ID');
      const body=source.kind==='gmail'?message.messageText:message.body?.content;
      if(typeof body!=='string')throw new Error('Mailbox item body missing; request full message read permission');
      const sender=source.kind==='gmail'?message.sender:message.from?.emailAddress?.address;
      const subject=String(message.subject||'(no subject)');
      yield {object_id:`messages/${id}`,title:subject,text:`Subject: ${subject}\nFrom: ${sender||''}\n\n${body}`,
        fields:{sender:sender||'',attachment_indexing:'not_enabled'},relations:[],
        modified_at:message.lastModifiedDateTime||message.messageTimestamp||message.receivedDateTime||null};
    }
    cursor=(source.kind==='gmail'?page.nextPageToken:page.nextLink)||null;
    if(cursor!==null&&typeof cursor!=='string')throw new Error('Invalid mailbox pagination token');
    if(cursor&&seen.has(cursor))throw new Error('Mailbox repeated a pagination cursor');
    if(cursor)seen.add(cursor);
  } while(cursor);
}
