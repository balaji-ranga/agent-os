// Opt-in VPS acceptance using only synthetic tasks and the separate private
// search prefix. Reads server configuration; never prints secrets or passages.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createOpenSearch } from '../src/opensearch.mjs';
import { createPrivateTasks } from '../src/private-tasks.mjs';
import { createDocumentExtractor } from '../src/document-extractor.mjs';
const config=JSON.parse(await readFile(process.env.ADOPTION_TEST_SERVICE_CONFIG||'/config/service.json','utf8'));
const search=createOpenSearch({...config.search,privateNetwork:true}),root=await mkdtemp(join(tmpdir(),'private-retention-live-'));
const prefix='adoption-private-tasks-v1-',request=async path=>{
  const response=await fetch(new URL(path,config.search.url),{headers:config.search.authorization?{Authorization:config.search.authorization}:{},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Acceptance search read failed '+response.status);return response.json();
};
const cases=[],record=(id,detail)=>cases.push({id,status:'passed',detail});
const sites=new Map(),tasks=await createPrivateTasks({root,passageStore:search.privateTasks,website:id=>sites.get(id),activeScope:()=>true,planner:async()=>({message:'No host actions',actions:[]})});
try{
  const index=await search.privateTasks.provision(),explain=await request('_plugins/_ism/explain/'+index);
  assert.equal(explain[index].policy_id,'adoption-private-task-24h-v1');record('RETENTION_POLICY','Hourly private index uses the 24-hour ISM policy.');
  const add=()=>{
    const id='retention-uat-'+randomUUID(),scope={embeddingId:id,sessionId:randomUUID(),origin:'https://synthetic.invalid',audienceIds:['public'],role:'visitor'};
    sites.set(id,{id,origin:scope.origin,organizationId:'retention-synthetic-owner',verified:true,status:'approved',taskPolicy:{attachments:true}});
    const ticket=tasks.ticket(scope,{});tasks.connect(ticket.ticket,scope.origin,()=>{});return {scope,instanceId:ticket.instanceId};
  };
  const a=add(),b=add(),task=tasks.start(a.scope,a),input={...a,taskId:task.taskId};
  const upload=await tasks.upload(a.scope,{...input,filename:'synthetic-retention.txt',mime:'text/plain',operationId:randomUUID(),content:Buffer.from('Company name: Synthetic Orchid\nReference: Private retention acceptance').toString('base64')});
  const claim=tasks.claim('retention-acceptance'),raw=await tasks.input(claim),path=join(root,'parse.txt');
  await writeFile(path,Buffer.from(raw.content,'base64'));
  const extracted=await createDocumentExtractor({python:process.env.ADOPTION_TEST_PYTHON||'/opt/adoption-python/bin/python'})({path,kind:'text'});
  await tasks.complete(claim,extracted);
  const summary=await tasks.summary(a.scope,input);assert.ok(summary.evidence.some(e=>e.text.includes('Synthetic Orchid')));record('REAL_PARSE_AND_SEARCH','Real text extraction indexed and retrieved with source locators.');
  assert.equal(tasks.metrics().retainedExtractionBytes,0);record('NO_RETAINED_EXTRACTION_RAM','Full extracted documents are not retained in coordinator task state.');
  await assert.rejects(tasks.summary(b.scope,{...b,taskId:task.taskId}));record('UNRELATED_VISITOR_DENIED','Another visitor cannot read the task.');
  tasks.end(a.scope,input);await tasks.cleanup();await assert.rejects(tasks.summary(a.scope,input));record('END_TASK_ACCESS_REVOKED','Ended task cannot search or restore its context.');
  const retained=await request(prefix+'*/_count?allow_no_indices=true&ignore_unavailable=true&source_content_type=application%2Fjson&source='+encodeURIComponent(JSON.stringify({query:{term:{task_id:task.taskId}}})));
  assert.ok(retained.count>0);record('RETENTION_OWNS_PHYSICAL_CLEANUP','Synthetic passages remain indexed after End task for ISM cleanup.');
  const newer=tasks.start(a.scope,a);assert.deepEqual((await tasks.summary(a.scope,{...a,taskId:newer.taskId})).evidence,[]);tasks.end(a.scope,{...a,taskId:newer.taskId});record('NEW_TASK_CANNOT_REVIVE_CONTENT','New task has no access to ended-task passages.');
  const snapshots=await request('_snapshot/_all');
  console.log(JSON.stringify({at:new Date().toISOString(),cases,temporaryIndex:index,snapshotRepositories:Object.keys(snapshots).length,physical24HourDeletion:'pending_elapsed_policy_cycle',hostWrites:0}));
}finally{await tasks.close();await rm(root,{recursive:true,force:true});}
