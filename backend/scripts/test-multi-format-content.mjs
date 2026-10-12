import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {createServer as netServer} from 'node:net';
import {createServer as httpServer} from 'node:http';
const dir=mkdtempSync(join(tmpdir(),'flolah-multiformat-'));
process.env.AGENT_OS_DATA_DIR=join(dir,'db');process.env.OPENCLAW_DIR=join(dir,'openclaw');process.env.NODE_ENV='test';process.env.OPENSEARCH_ENABLED='0';process.env.MEDIA_URL_QUIET='1';process.env.AGENT_OS_INTERNAL_TOKEN='fixture-internal-token-for-isolated-broker-test';
let db,api,clam,rpc,checks=0;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
try {
  const {initDb}=await import('../src/db/schema.js');db=initDb();
  const service=await import('../src/services/multi-format-content-tool.js');
  const {persistGeneratedOpenClawMedia}=await import('../src/services/media-url.js');
  const {saveInboundAttachment}=await import('../src/services/inbound-attachments.js');
  const {seedContentToolsMetaIfEmpty}=await import('../src/db/seed-content-tools-meta.js');seedContentToolsMetaIfEmpty();
  const {grantCooDelegationToolsIfMissing,buildToolsMdContent}=await import('../src/services/openclaw-agent-tools.js');
  const {inferRiskForTool}=await import('../src/services/action-policy.js');
  const {inferToolRiskMapping}=await import('../src/services/tool-risk-mappings.js');
  for(const owner of ['format-a','format-b']) {
    db.prepare("INSERT INTO platform_users(id,email,password_hash,name,role) VALUES (?,?,'fixture',?,'ceo')").run(owner,owner+'@example.test',owner);
    db.prepare('INSERT INTO agents(id,name,is_coo) VALUES (?,?,1)').run(owner+'-coo',owner+' COO');
    db.prepare('INSERT INTO user_agents(user_id,agent_id,enabled) VALUES (?,?,1)').run(owner,owner+'-coo');
  }
  grantCooDelegationToolsIfMissing();
  for(const owner of ['format-a','format-b'])check(!!db.prepare('SELECT 1 FROM agent_tool_grants WHERE agent_id=? AND tool_name=?').get(owner+'-coo',service.MULTI_FORMAT_TOOL_NAME),true,'default grant for every COO');
  const {defaultExecutionBehaviour}=await import('../src/services/tool-execution-governor.js');
  check(defaultExecutionBehaviour(service.MULTI_FORMAT_TOOL_NAME).timeout_ms,240000,'bounded conversion timeout metadata');
  check(buildToolsMdContent([service.MULTI_FORMAT_TOOL_NAME]).includes('Content Folder'),true,'runtime TOOLS guidance includes file references');
  check(inferRiskForTool(service.MULTI_FORMAT_TOOL_NAME).risk_tier,'R1','internal generation is not external activity');
  check(inferToolRiskMapping({capability_type:'content_tool',capability_id:service.MULTI_FORMAT_TOOL_NAME}).risk_tier,'R1','generic risk mapping agrees');
  const clean=async bytes=>({status:'clean',scanner:'fixture',sha256:'fixture'});
  const textResult=async payload=>({ok:true,output_format:payload.output_format,ocr_used:false,warnings:[],outputs:[{content_base64:Buffer.from('Converted fixture').toString('base64'),mime_type:'text/plain'}]});
  const options={scanBytes:clean,auditScan:()=>{},convert:textResult};
  const phases=[];
  const output=await service.multiFormatContentForOwner('format-a',{text:'Fixture text',output_format:'txt'},{...options,onProgress:event=>phases.push(event.phase)});
  check(output.ok,true,'generation succeeds');check(output.files.length,1,'one attachment delivered');check(output.security_scan.persisted,true,'clean persisted receipt');check(phases,['content_scan','content_convert','content_scan','content_scan_clean'],'scan progress shown both directions');
  check(output.files[0].content_file_id,'gen:'+output.relative_url.replace('/api/media/openclaw/',''),'exact reusable content item id returned');
  check((await service.multiFormatContentForOwner('format-a',{content_file:{id:output.files[0].content_file_id},output_format:'txt'},options)).ok,true,'returned generated item id can be reused');
  check(readFileSync(output.local_path,'utf8'),'Converted fixture','persisted bytes are correct');
  check(db.prepare('SELECT owner_user_id FROM content_conversion_jobs WHERE id=?').get(output.artifact_id).owner_user_id,'format-a','conversion receipt owner-scoped');
  const again=await service.multiFormatContentForOwner('format-a',{content_file:output.relative_url,output_format:'txt'},options);check(again.ok,true,'reuse generated Content Folder file without inline bytes');
  check((await service.multiFormatContentForOwner('format-a',{content_file:basename(output.local_path),output_format:'txt'},options)).ok,true,'bare generated filename string supported');
  await assert.rejects(service.multiFormatContentForOwner('format-b',{content_file:basename(output.local_path),output_format:'txt'},options),e=>e.code==='CONTENT_REFERENCE_AMBIGUOUS');checks++;
  const inbound=saveInboundAttachment('format-a',{buffer:Buffer.from('Original source'),filename:'input.txt'});
  check((await service.multiFormatContentForOwner('format-a',{content_file:{id:'up:'+inbound.relative_path},output_format:'txt'},options)).ok,true,'inbound item id supported');
  check((await service.multiFormatContentForOwner('format-a',{content_file:{filename:'input.txt'},output_format:'txt'},options)).ok,true,'unique filename supported');
  check((await service.multiFormatContentForOwner('format-a',{content_file:'input.txt',output_format:'txt'},options)).ok,true,'bare uploaded filename string supported');
  // Generated UUID basenames remain distinct; duplicate names across owned directories are rejected.
  mkdirSync(join(process.env.OPENCLAW_DIR,'media','generated','format-a'),{recursive:true});
  writeFileSync(join(process.env.OPENCLAW_DIR,'media','generated','format-a',basename(output.local_path)),'duplicate');
  await assert.rejects(service.multiFormatContentForOwner('format-a',{content_file:basename(output.local_path),output_format:'txt'},options),e=>e.code==='CONTENT_REFERENCE_AMBIGUOUS');checks++;
  check(readFileSync(inbound.absolute_path,'utf8'),'Original source','source is unchanged');
  await assert.rejects(service.multiFormatContentForOwner('format-a',{content_file:'inbound/attachments/nonexistent.txt',output_format:'txt'},options),e=>e.code==='CONTENT_NOT_FOUND'&&e.securityScan.source_file_unchanged===true&&e.securityScan.disposition==='not_created');checks++;
  await assert.rejects(service.multiFormatContentForOwner('format-b',{content_file:output.relative_url,output_format:'txt'},options),e=>e.status===403);checks++;
  for(const raw of ['../../etc/passwd','/etc/passwd','generated/format-a/../format-b/file.txt','https://example.test/input.pdf','inbound/attachments/../bad.txt']){
    await assert.rejects(service.multiFormatContentForOwner('format-a',{content_file:raw,output_format:'txt'},options));checks++;
  }
  await assert.rejects(service.multiFormatContentForOwner('format-a',{text:'A',content_base64:'QQ==',output_format:'txt'},options));checks++;
  await assert.rejects(service.multiFormatContentForOwner('format-a',{content_base64:'###',input_format:'txt',output_format:'txt'},options));checks++;
  await assert.rejects(service.multiFormatContentForOwner(null,{text:'A',output_format:'txt'},options));checks++;
  let calls=0,persisted=0;
  await assert.rejects(service.multiFormatContentForOwner('format-a',{text:'A',output_format:'txt'},{...options,scanBytes:async()=>{throw Object.assign(new Error('scanner unavailable'),{code:'SCAN_UNAVAILABLE',status:503})},convert:async()=>{calls++;return textResult({output_format:'txt'})},persistFile:()=>{persisted++}}));
  check(calls,0,'scanner failure prevents conversion');check(persisted,0,'scanner failure prevents storage');
  const scanCount={n:0};
  await assert.rejects(service.multiFormatContentForOwner('format-a',{text:'A',output_format:'txt'},{...options,scanBytes:async()=>{if(++scanCount.n===2)throw Object.assign(new Error('unsafe'),{code:'MALWARE_DETECTED'});return{status:'clean'}},persistFile:()=>{persisted++}}));check(persisted,0,'unsafe output is never persisted');
  await assert.rejects(service.multiFormatContentForOwner('format-a',{text:'A',output_format:'txt'},{...options,convert:async()=>({ok:true,output_format:'txt',outputs:[{content_base64:'QQ==',mime_type:'application/pdf'}]})}));checks++;
  await assert.rejects(service.multiFormatContentForOwner('format-a',{text:'A',output_format:'pdf'},{...options,convert:async()=>({ok:true,output_format:'pdf',outputs:[{content_base64:'QQ==',mime_type:'application/pdf'}]})}));checks++;
  const foreign=join(dir,'foreign');mkdirSync(foreign);writeFileSync(join(foreign,'secret.txt'),'foreign');
  const link=join(process.env.OPENCLAW_DIR,'tenants','format-a','workspace','inbound','attachments','link');
  try{symlinkSync(foreign,link,process.platform==='win32'?'junction':'dir');await assert.rejects(service.multiFormatContentForOwner('format-a',{content_file:'inbound/attachments/link/secret.txt',output_format:'txt'},options));checks++;}catch(e){if(e.code!=='EPERM')throw e;}
  // Full HTTP tool path with a fixture ClamAV protocol and private fixture RPC.
  clam=netServer(socket=>{let data=Buffer.alloc(0);socket.on('data',part=>{data=Buffer.concat([data,part]);if(data.subarray(0,9).toString().startsWith('zVERSION'))socket.end(`ClamAV fixture/999/${new Date().toUTCString()}\0`);else if(data.length>13&&data.subarray(-4).equals(Buffer.alloc(4)))socket.end('stream: OK\0');});});
  await new Promise(resolve=>clam.listen(0,'127.0.0.1',resolve));process.env.CONTENT_DOWNLOAD_CLAMAV_HOST='127.0.0.1';process.env.CONTENT_DOWNLOAD_CLAMAV_PORT=String(clam.address().port);
  rpc=httpServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',async()=>{const result=await textResult(JSON.parse(raw));res.setHeader('content-type','application/json');res.end(JSON.stringify(result));});});
  await new Promise(resolve=>rpc.listen(0,'127.0.0.1',resolve));process.env.CONTENT_CONVERTER_URL=`http://127.0.0.1:${rpc.address().port}`;process.env.CONTENT_CONVERTER_TOKEN='fixture-token-not-a-production-secret';
  const {default:express}=await import('express');const {default:tools}=await import('../src/routes/tools.js');const {createSession}=await import('../src/services/auth/session.js');
  const app=express();app.use(express.json());app.use('/api/tools',tools);api=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server))});
  const session=createSession('format-a');const request=async body=>{const response=await fetch(`http://127.0.0.1:${api.address().port}/api/tools/multi-format-content-tool`,{method:'POST',headers:{authorization:`Bearer ${session.token}`,'content-type':'application/json','x-openclaw-agent-id':'t-format-a--format-a-coo'},body:JSON.stringify(body)});return{status:response.status,data:await response.json()}};
  const delivered=await request({text:'Sensitive fixture must not be logged',output_format:'txt'});check(delivered.status,200,'COO HTTP tool execution works');check(delivered.data.security_scan.scanner,'ClamAV','HTTP uses mandatory scanner path');
  const logs=db.prepare('SELECT request_payload FROM content_tool_logs WHERE tool_name=?').all(service.MULTI_FORMAT_TOOL_NAME);check(logs.some(row=>row.request_payload.includes('Sensitive fixture')),false,'raw source not duplicated into tool request logs');
  const denied=await request({content_file:output.relative_url.replace('/format-a/','/format-b/'),output_format:'txt',owner_user_id:'format-b'});check(denied.status===403||denied.status===404,true,'agent cannot choose a different owner');
  process.env.PORT=String(api.address().port);
  const brokerResponse=await fetch(`http://127.0.0.1:${api.address().port}/api/tools/invoke`,{method:'POST',headers:{authorization:`Bearer ${session.token}`,'content-type':'application/json','x-openclaw-agent-id':'t-format-a--format-a-coo'},body:JSON.stringify({tool_name:service.MULTI_FORMAT_TOOL_NAME,text:'Private broker fixture',output_format:'txt'})});
  const broker=await brokerResponse.json();check(brokerResponse.status,200,'full invoke broker retains canonical hyphenated tool name');check(broker.ok,true,'broker returns scanned artifact');
  const brokerLogs=db.prepare('SELECT request_payload FROM content_tool_logs WHERE tool_name=?').all(service.MULTI_FORMAT_TOOL_NAME);check(brokerLogs.some(row=>row.request_payload.includes('Private broker fixture')),false,'invoke request audit redacts inline content');
  const {multiFormatInputAudit}=await import('../src/lib/multi-format-audit.js');
  const correlated=multiFormatInputAudit({text:'Never log this source',_chat_turn_id:'qa-turn',_work_unit_id:'qa-work'});
  check(correlated._chat_turn_id,'qa-turn','audit keeps broker chat correlation');check(correlated._work_unit_id,'qa-work','audit keeps work correlation');check(JSON.stringify(correlated).includes('Never log'),false,'correlation does not leak input');
  const {appendMultiFormatAttachments}=await import('../src/lib/multi-format-delivery.js');
  const call={tool_name:service.MULTI_FORMAT_TOOL_NAME,status:'ok',response:broker};
  const attached=appendMultiFormatAttachments('Complete',[call,call],'format-a');check(attached.split('MEDIA:').length,2,'verified owner attachment appended once');
  check(appendMultiFormatAttachments('Complete',[call],'format-b'),'Complete','other owner receipt excluded');
  check(appendMultiFormatAttachments('Complete',[{...call,response:{...broker,files:[{...broker.files[0],security_scan:{status:'infected',persisted:false}}]}}],'format-a'),'Complete','unsafe receipt never attached');
  const templates=resolve('../openclaw-workspace-templates');if(process.env.CHECK_MULTI_FORMAT_TEMPLATES!=='0')for(const entry of readdirSync(templates,{withFileTypes:true})){if(!entry.isDirectory())continue;const name=entry.name;try{check(readFileSync(join(templates,name,'TOOLS.md'),'utf8').includes('## Multi format content generation conversion and OCR'),true,'static TOOLS template '+name);}catch(e){if(e.code!=='ENOENT')throw e;}}
  console.log(`MULTI_FORMAT_CONTENT_OK ${checks} checks (disposable DB, mock scanner/RPC, no production or external writes)`);
}finally{for(const server of [api,clam,rpc])if(server)await new Promise(resolve=>server.close(resolve));try{db?.close()}catch{}rmSync(dir,{recursive:true,force:true});}
