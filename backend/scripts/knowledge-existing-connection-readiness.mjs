// Read-only account inventory. Never emits credentials or message/document content.
import {listUsers} from '../src/services/users.js';
import {getConnectorConnectionsForUser} from '../src/services/openconnector.js';
const users=listUsers({q:'Balaji Ranganathan'});
const matches=(Array.isArray(users)?users:users.users||[]).filter(u=>u.name?.toLowerCase()==='balaji ranganathan');
if(matches.length!==1)throw new Error('Expected exactly one Balaji Ranganathan account');
const owner=matches[0].id;
const result=await getConnectorConnectionsForUser(owner);
console.log(JSON.stringify({owner,name:matches[0].name,connections:result.connections.filter(c=>['gmail','google_drive','onedrive','sharepoint','outlook'].includes(c.app_id)).map(c=>({app_id:c.app_id,connected:c.connected,identity_available:!!c.account_name}))}));
