// Read-only provider contract inspection. No credential or account data output.
import { listConnectorActions, getConnectorActionGuide, provisionOpenConnectorForUser } from '../src/services/openconnector.js';
import { getUserById } from '../src/services/users.js';
const owner=process.env.KNOWLEDGE_TEST_OWNER;
if(!owner)throw new Error('KNOWLEDGE_TEST_OWNER required');
if(process.env.KNOWLEDGE_PROVISION_DEMO_RUNTIME==='1') {
  if(!owner.startsWith('ceo-demo-'))throw new Error('Provisioning is limited to an existing demo tenant');
  const user=getUserById(owner);if(!user)throw new Error('Demo tenant does not exist');
  await provisionOpenConnectorForUser(user,{ensureConnections:false});
  console.log(JSON.stringify({demo_runtime:'provisioned',oauth_connections_created:false}));
}
for(const app of ['google_drive','onedrive','sharepoint','gmail','outlook']) {
  const result=await listConnectorActions(owner,app);
  console.log(JSON.stringify({app,source:result.source,error:result.error?String(result.error).replace(/https?:\/\/\S+/g,'[endpoint]').slice(0,300):undefined,actions:result.actions.filter(a=>/list|fetch|get|download|export|search/i.test(a.id)).map(a=>({id:a.id,input_schema:a.input_schema,output_schema:a.output_schema}))}));
}
for(const id of ['google_drive.list_files','gmail.fetch_emails','outlook.list_messages']) {
  const guide=await getConnectorActionGuide(owner,id);
  console.log(JSON.stringify({action_id:id,input_schema:guide.input_schema,output_schema:guide.output_schema,description:guide.description}));
}
