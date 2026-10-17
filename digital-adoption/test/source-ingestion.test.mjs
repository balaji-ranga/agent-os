import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openRepository} from '../src/repository.mjs';
import {createKnowledgeService} from '../src/knowledge-service.mjs';
import {createSourceIngestion} from '../src/source-ingestion.mjs';
import {createBlobStore} from '../src/blob-store.mjs';
import {createDocumentExtractor} from '../src/document-extractor.mjs';

const owner={embeddingId:'upload-alpha',audienceIds:['public'],role:'maintainer'},other={...owner,embeddingId:'upload-beta'};
const file={title:'Upload canary',filename:'handbook.txt',mime:'text/plain',content:Buffer.from('The synthetic upload canary is CEDAR_UPLOAD_176.').toString('base64'),sharedConsent:true,operationId:'unique-operation-176'};
async function setup(extract){
 const root=await mkdtemp(join(tmpdir(),'adoption-upload-')),repository=openRepository();let chunks=[];
 const search={index:async(_,batch)=>{chunks=batch;},remove:async(_,id)=>{chunks=chunks.filter(c=>c.source_id!==id);},search:async()=>({hits:{hits:chunks.map(_source=>({_source}))}})};
 const knowledge=createKnowledgeService(repository,search),blobs=createBlobStore(root);
 const ingestion=createSourceIngestion(repository,{knowledge,blobs,extract:extract||createDocumentExtractor({python:process.platform==='win32'?'python':'python3'})});
 return {repository,knowledge,blobs,ingestion,search,root,close:async()=>{ingestion.stop();repository.close();await rm(root,{recursive:true,force:true});}};
}
test('real text/HTML extraction, queued status, same-embedding sharing and deletion of raw/indexed data',async()=>{
 const env=await setup();try{
  const source=await env.ingestion.upload({...owner,sessionId:'session-A'},file);
  assert.equal(source.status,'queued');assert.equal((await env.knowledge.retrieve(owner,{query:'canary'})).evidence.length,0);
  await env.ingestion.drain();
  assert.equal(env.ingestion.status({...owner,role:'visitor',sessionId:'session-A'},source.id).status,'ready');
  assert.throws(()=>env.ingestion.status({...owner,role:'visitor',sessionId:'session-B'},source.id));
  assert.equal((await env.knowledge.retrieve({...owner,sessionId:'session-B',role:'visitor'},{query:'canary'})).evidence[0].locator,'Document');
  assert.equal((await env.knowledge.retrieve(other,{query:'canary'})).evidence.length,0);
  await assert.rejects(()=>env.ingestion.raw(other,source.id));
  await env.ingestion.remove(owner,source.id);
  assert.equal((await env.knowledge.retrieve(owner,{query:'canary'})).evidence.length,0);
  await assert.rejects(()=>env.blobs.read(owner.embeddingId,source.id));
  const html=await env.ingestion.upload(owner,{...file,operationId:'unique-html-operation',filename:'guide.html',mime:'text/html',content:Buffer.from('<h1>Help</h1><script>SECRET_SCRIPT_CANARY</script><p>HTML_CEDAR_176</p>').toString('base64')});await env.ingestion.drain();
  assert.equal(env.ingestion.status(owner,html.id).status,'ready');const raw=env.knowledge.inspect(owner,html.id);assert.match(raw.text,/HTML_CEDAR_176/);assert.doesNotMatch(raw.text,/SECRET_SCRIPT_CANARY/);
 }finally{await env.close();}
});
test('concurrent upload retry has one object/job; conflict, traversal, spoofed type, malware fixture and permission denied',async()=>{
 const env=await setup(async()=>({sections:[{text:'safe',locator:'Page 1'}]}));try{
  const [a,b]=await Promise.all([env.ingestion.upload(owner,file),env.ingestion.upload(owner,file)]);assert.equal(a.id,b.id);assert.equal(env.knowledge.list(owner).length,1);
  const dirs=await readdir(env.root);assert.equal((await readdir(join(env.root,dirs[0]))).length,1);
  for(const patch of [{title:'conflict'},{filename:'../secret.txt'},{filename:'bad.pdf',mime:'application/pdf'},{content:Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE').toString('base64')},{sharedConsent:false},{content:'invalid!'}])await assert.rejects(()=>env.ingestion.upload(owner,{...file,...patch}));
  await assert.rejects(()=>env.ingestion.upload({...owner,role:'visitor'},file));
  assert.throws(()=>env.blobs.path('../outside',a.id));
 }finally{await env.close();}
});
test('interrupted/failed extraction retries visibly; delete during indexing removes later writes',async()=>{
 let fail=true,begin,finish;const env=await setup(async()=>{if(fail)throw new Error('private parser trace');return {sections:[{text:'CEDAR_RECOVERY_176',locator:'Page 2'}]};});try{
  const source=await env.ingestion.upload(owner,file);await env.ingestion.drain();assert.equal(env.ingestion.status(owner,source.id).status,'failed');assert.doesNotMatch(env.ingestion.status(owner,source.id).lastError,/private/);
  fail=false;env.ingestion.retry(owner,source.id);await env.ingestion.drain();assert.equal(env.ingestion.status(owner,source.id).status,'ready');assert.equal(env.knowledge.inspect(owner,source.id).chunks,1);
  const second=await env.ingestion.upload(owner,{...file,operationId:'second-upload-operation'});
  const started=new Promise(resolve=>{begin=resolve;}),blocked=new Promise(resolve=>{finish=resolve;});const original=env.search.index;env.search.index=async(...args)=>{begin();await blocked;await original(...args);};
  const work=env.ingestion.drain();await started;await env.ingestion.remove(owner,second.id);finish();await work;
  assert.equal(env.ingestion.status(owner,second.id).status,'deleted');assert.equal((await env.knowledge.retrieve(owner,{query:'canary'})).evidence.length,0);
 }finally{await env.close();}
});
test('video playlists cannot reach a parser and the worker rotates websites instead of draining one backlog',async()=>{
 let env;const processed=[];env=await setup(async({path})=>{const id=path.split(/[\\/]/).at(-1);processed.push(env.repository.map('source_jobs').get(id).embeddingId);return {sections:[{text:'Fair queue fixture',locator:'Document'}]};});
 try{
  await assert.rejects(()=>env.ingestion.upload(owner,{...file,filename:'playlist.mp4',mime:'video/mp4',content:Buffer.from('#EXTM3U\nhttp://169.254.169.254/metadata').toString('base64')}),/signature/);
  for(let i=0;i<3;i++)await env.ingestion.upload(owner,{...file,operationId:`fair-alpha-operation-${i}`});
  await env.ingestion.upload(other,file);await env.ingestion.upload({...owner,embeddingId:'upload-gamma'},file);
  for(let i=0;i<5;i++)await env.ingestion.drain();
  assert.equal(new Set(processed.slice(0,3)).size,3);assert.equal(processed.length,5);
 }finally{await env.close();}
});
