// Run only on the authorized VPS with server-side configuration mounts. It
// creates/removes only its own synthetic source; never accepts an arbitrary ID.
import {readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as wait} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {createOpenSearch} from '../src/opensearch.mjs';
import {createKnowledgeService} from '../src/knowledge-service.mjs';
import {createSourceIngestion} from '../src/source-ingestion.mjs';
import {createBlobStore} from '../src/blob-store.mjs';
import {createPublicUrlFetcher} from '../src/public-url.mjs';
const phase=process.argv[2],config=JSON.parse(readFileSync('/config/service.json','utf8')),repository=openRepository('/data/adoption.sqlite');
const scope={embeddingId:'adoption-demo-alpha',audienceIds:['public'],role:'maintainer'};
const knowledge=createKnowledgeService(repository,createOpenSearch({...config.search,privateNetwork:true})),blobs=createBlobStore('/data/objects');
const ingestion=createSourceIngestion(repository,{knowledge,blobs,fetchUrl:createPublicUrlFetcher()});
const statePath='/data/url-acceptance-20261017.json';
async function ready(id){for(let i=0;i<60;i++){const status=ingestion.status(scope,id);if(status.status==='ready')return;if(status.status==='failed')throw new Error(status.lastError);await wait(1000);}throw new Error('URL processing timed out');}
try{
 if(phase==='create'){
  const source=ingestion.addUrl(scope,{title:'CedarURLProbe20261017',url:'https://flolah.cloud/free-tools/digital-adoption-acceptance-20261017.html',sharedConsent:true,operationId:'CedarURLProbe20261017-create'});
  await ready(source.id);const indexed=knowledge.inspect(scope,source.id),found=await knowledge.retrieve(scope,{query:'CedarURLProbe20261017'});
  assert.match(indexed.text,/thirty six hours/);assert.ok(found.evidence.some(e=>e.url?.startsWith('https://flolah.cloud/')));
  writeFileSync(statePath,JSON.stringify({id:source.id,originalRevision:indexed.revision,checks:['real HTTPS URL fetch, parsing, indexing and source URL citation']}),{mode:0o600});console.log('URL create: real public HTTPS page indexed with URL citation.');
 }else{
  const state=JSON.parse(readFileSync(statePath,'utf8'));const source=knowledge.inspect(scope,state.id);
  assert.equal(source.title,'CedarURLProbe20261017');assert.equal(source.url,'https://flolah.cloud/free-tools/digital-adoption-acceptance-20261017.html');
  if(phase==='refresh'){
   ingestion.refresh(scope,state.id);await ready(state.id);const updated=knowledge.inspect(scope,state.id),found=await knowledge.retrieve(scope,{query:'CedarURLProbe20261017'});
   assert.notEqual(updated.revision,state.originalRevision);assert.match(updated.text,/sixty hours/);assert.doesNotMatch(updated.text,/thirty six hours/);assert.ok(found.evidence.every(e=>e.revision===updated.revision));
   state.checks.push('changed public page refreshed with new revision; obsolete evidence excluded');writeFileSync(statePath,JSON.stringify(state));console.log('URL refresh: changed page and current revision verified.');
  }else if(phase==='delete'){
   await ingestion.remove(scope,state.id);assert.equal((await knowledge.retrieve(scope,{query:'CedarURLProbe20261017'})).evidence.length,0);await assert.rejects(()=>blobs.read(scope.embeddingId,state.id));assert.equal(knowledge.inspect(scope,state.id).status,'deleted');
   state.checks.push('source deletion removes raw object and indexed retrieval');state.fullPhaseCertification=false;writeFileSync(statePath,JSON.stringify(state,null,2));console.log(JSON.stringify(state,null,2));
  }else throw new Error('Unknown acceptance phase');
 }
}finally{repository.close();}
