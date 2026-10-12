// Explicit, owner-scoped deployment test. Benign artifacts/history are retained for inspection.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {getDb} from '../src/db/schema.js';
import {createSession,revokeSession} from '../src/services/auth/session.js';
assert(process.argv.includes('--run'),'Explicit --run required');
const owner=process.env.MULTI_FORMAT_TEST_OWNER||'ceo-bala',agent='balserve',tool='multi-format-content-tool';
const db=getDb();
assert(db.prepare("SELECT 1 FROM platform_users WHERE id=? AND role='ceo' AND enabled=1").get(owner));
assert(db.prepare('SELECT 1 FROM user_agents WHERE user_id=? AND agent_id=? AND enabled=1').get(owner,agent));
assert(db.prepare('SELECT 1 FROM agent_tool_grants WHERE agent_id=? AND tool_name=?').get(agent,tool));
const token=createSession(owner).token,base='http://127.0.0.1:3001',run='conversion-qa-'+Date.now();
const artifacts=[],checks=[];
async function request(path,body){const response=await fetch(base+path,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-openclaw-agent-id':`t-${owner}--${agent}`},body:JSON.stringify(body),signal:AbortSignal.timeout(300000)});return {status:response.status,data:await response.json()};}
async function invoke(params,label){const response=await request('/api/tools/invoke',{tool_name:tool,output_filename:run+'-'+label,...params});assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.ok,true);for(const file of response.data.files){assert.equal(file.security_scan.status,'clean');assert.match(file.paste_exactly,/^MEDIA:/);artifacts.push({filename:file.filename,relative_url:file.relative_url});}checks.push(label);return response.data;}
try {
 if(!process.argv.includes('--chat-only')){
  const text='# Conversion deployment verification\n\n**COO report** — no external actions.\n\n| Item | Count |\n| --- | --- |\n| Leads | 12 |\n| Calls | 7 |';
  const files={};for(const output_format of ['pdf','docx','doc','xlsx','txt','html'])files[output_format]=await invoke({operation:'generate',text,input_format:'md',output_format},'md-'+output_format);
  const source=files.docx.files[0],before=readFileSync(source.local_path);
  await invoke({content_file:source.relative_url,output_format:'pdf'},'content-folder-word-to-pdf');
  assert.equal(createHash('sha256').update(readFileSync(source.local_path)).digest('hex'),createHash('sha256').update(before).digest('hex'));checks.push('source-unchanged');
  await invoke({content_file:files.pdf.files[0].relative_url,output_format:'docx',ocr:'off'},'pdf-to-word');
  const images=await invoke({content_file:files.pdf.files[0].relative_url,output_format:'png'},'pdf-to-images');
  await invoke({content_file:images.files[0].relative_url,output_format:'pdf'},'image-to-pdf');
  const scan=readFileSync('/tmp/multi-format-scan.png');
  const recognized=await invoke({operation:'ocr',input_format:'png',content_base64:scan.toString('base64'),output_format:'txt'},'image-ocr');
  assert.match(readFileSync(recognized.files[0].local_path,'utf8'),/12345/);
  const scannedPdf=await invoke({input_format:'png',content_base64:scan.toString('base64'),output_format:'pdf',ocr:'off'},'scanned-pdf');
  const recognizedPdf=await invoke({operation:'ocr',content_file:scannedPdf.files[0].relative_url,output_format:'docx'},'pdf-ocr');assert.equal(recognizedPdf.ocr_used,true);
  const eicar='X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
  const blocked=await request('/api/tools/invoke',{tool_name:tool,text:eicar,output_format:'txt'});assert.notEqual(blocked.status,200);assert.match(JSON.stringify(blocked.data),/MALWARE|malware|infected|detected/i);checks.push('real-ClamAV-rejection');
  const logs=db.prepare('SELECT request_payload FROM content_tool_logs WHERE tool_name=? AND owner_user_id=? ORDER BY id DESC LIMIT 80').all(tool,owner);
  assert(!logs.some(row=>row.request_payload.includes('COO report')));checks.push('no-inline-content-in-tool-audit');
 }
 if(process.argv.includes('--chat-only')){
  const {ensureChatHistorySchema,getActiveChatSession}=await import('../src/services/chat-history.js');
  const {getChatThreadId,setChatThreadId}=await import('../src/services/chat-session-policy.js');ensureChatHistorySchema();
  const previous=getActiveChatSession(agent,owner),oldThread=getChatThreadId(agent,owner),testId=randomUUID(),thread='qa'+Date.now().toString(36);
  db.transaction(()=>{if(previous)db.prepare("UPDATE chat_sessions SET status='archived' WHERE id=? AND owner_user_id=? AND status='active'").run(previous.id,owner);db.prepare("INSERT INTO chat_sessions(id,agent_id,owner_user_id,title,status,oc_thread_id) VALUES (?,?,?,?,'active',?)").run(testId,agent,owner,'Multi-format conversion deployment verification',thread);setChatThreadId(agent,owner,thread);})();
  try {
   const started=db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM content_tool_logs WHERE owner_user_id=? AND tool_name=?').get(owner,tool).n;
   const response=await request(`/api/agents/${agent}/chat`,{client_turn_id:run,message:'Deployment verification only. Use the selected multi-format-content-tool with input_format="md" to generate a PDF from this Markdown: # COO conversion check\n\n| Check | Result |\n| --- | --- |\n| Content Folder | Supported |\n| Antivirus | Required |\nReturn the PDF attachment using the exact MEDIA directive supplied by the tool. Do not browse, delegate, create tasks/goals, send notifications or change business/trading settings.',tool_refs:[tool]});
   assert.equal(response.status,200,JSON.stringify(response.data));
   const called=db.prepare('SELECT response_payload,status FROM content_tool_logs WHERE id>? AND owner_user_id=? AND tool_name=?').all(started,owner,tool);assert(called.some(row=>['ok','success'].includes(row.status)),'Real COO invocation missing');
   assert.match(response.data.reply,/MEDIA:/,'COO attachment directive missing');assert.doesNotMatch(response.data.reply,/Selected tool use not verified/);
   assert(response.data.tool_calls?.some(call=>call.tool_name===tool),'Chat tool correlation missing');
   const receipt=called.map(row=>JSON.parse(row.response_payload||'{}')).find(r=>r.ok&&r.files?.length);
   assert(receipt?.files[0]?.relative_url,'Real receipt missing');
   const file=receipt.files[0],before=readFileSync(file.local_path);
   const download=await fetch(base+file.relative_url,{headers:{authorization:`Bearer ${token}`}});assert.equal(download.status,200);assert.match(download.headers.get('content-type'),/pdf/);assert.equal(Buffer.from(await download.arrayBuffer()).compare(before),0);
   const denied=await fetch(base+file.relative_url);assert.notEqual(denied.status,200,'Anonymous artifact access must be denied');
   const reuseStarted=db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM content_tool_logs WHERE owner_user_id=? AND tool_name=?').get(owner,tool).n;
   assert(file.content_file_id,'Reusable Content Folder id missing');
   const reuse=await request(`/api/agents/${agent}/chat`,{client_turn_id:run+'-reuse',message:`Deployment verification only. Convert the existing Content Folder PDF to Word using multi-format-content-tool with these exact arguments: ${JSON.stringify({operation:'convert',content_file:{id:file.content_file_id},output_format:'docx'})}. Copy the item id unchanged; do not replace it with inbound/attachments or resend its content. Return the attachment, and do not create tasks, goals, notifications or change settings.`,tool_refs:[tool]});
   assert.equal(reuse.status,200,JSON.stringify(reuse.data));assert.match(reuse.data.reply,/MEDIA:/);assert.doesNotMatch(reuse.data.reply,/Selected tool use not verified/);assert.equal(readFileSync(file.local_path).compare(before),0,'Source PDF changed');
   const reuseRows=db.prepare('SELECT request_payload,response_payload FROM content_tool_logs WHERE id>? AND owner_user_id=? AND tool_name=?').all(reuseStarted,owner,tool).map(row=>({input:JSON.parse(row.request_payload||'{}'),output:JSON.parse(row.response_payload||'{}')}));
   assert(reuseRows.some(row=>row.input.input_kind==='content_file'&&row.output.output_format==='docx'&&row.output.input_sha256===createHash('sha256').update(before).digest('hex')),'Actual Content Folder PDF-to-Word receipt missing');
   console.log(JSON.stringify({chat_passed:true,content_folder_reuse_passed:true,private_download_passed:true,anonymous_download_denied:true,source_unchanged:true,agent,owner,test_session_id:testId,tool_calls:called.length,reply:response.data.reply,reuse_reply:reuse.data.reply},null,2));
  }finally{
   // Restore only if the active chat is still our isolated test: do not override a concurrent user switch.
   if(getActiveChatSession(agent,owner)?.id===testId)db.transaction(()=>{db.prepare("UPDATE chat_sessions SET status='archived',archived_at=datetime('now') WHERE id=? AND owner_user_id=?").run(testId,owner);if(previous){db.prepare('UPDATE chat_sessions SET status=?,archived_at=? WHERE id=? AND owner_user_id=?').run(previous.status,previous.archived_at,previous.id,owner);setChatThreadId(agent,owner,oldThread);}})();
  }
 }
 console.log(JSON.stringify({passed:true,owner,agent,checks,artifacts},null,2));
}finally{revokeSession(token);db.close();}
