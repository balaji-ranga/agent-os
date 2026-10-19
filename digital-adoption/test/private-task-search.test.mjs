import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createPrivateTaskSearch } from '../src/private-task-search.mjs';
import { createPrivateTasks } from '../src/private-tasks.mjs';
import { createOpenSearch } from '../src/opensearch.mjs';

const notFound=()=>Object.assign(new Error('missing'),{statusCode:404});
function cluster() {
  const calls=[],documents=[],indexes=new Set(),managed=new Map();let policy;
  const request=async(path,method,body,ndjson)=>{
    calls.push({path,method,body,ndjson});
    if(path.includes('/_ism/policies/')){
      if(method==='GET'){if(!policy)throw notFound();return {policy};}
      policy=structuredClone(body.policy);return {_id:'policy'};
    }
    if(path.endsWith('/_mapping')){if(!indexes.has(path.split('/')[1]))throw notFound();return {};}
    if(path.includes('/_ism/explain/')){const index=path.split('/').at(-1);return {[index]:{policy_id:managed.get(index)}};}
    if(path.includes('/_ism/add/')){managed.set(path.split('/').at(-1),body.policy_id);return {updated_indices:1};}
    if(path.startsWith('/_bulk')){
      const lines=body.trim().split('\n').map(JSON.parse);
      for(let n=0;n<lines.length;n+=2){assert.ok(indexes.has(lines[n].index._index));documents.push(lines[n+1]);}
      return {errors:false};
    }
    if(path.includes('/_search')){
      const filters=body.query.bool.filter,owner=filters[0].term.owner_id,task=filters[1].term.task_id,expiry=filters[2].range.expires_at.gt;
      const allows=filters[3].bool.should.map(item=>Object.assign({},...item.bool.filter.map(f=>f.term)));
      return {hits:{hits:documents.filter(d=>d.owner_id===owner&&d.task_id===task&&d.expires_at>expiry&&allows.some(a=>Object.entries(a).every(([k,v])=>d[k]===v))).slice(0,8).map(d=>({_source:d}))}};
    }
    if(method==='PUT'){indexes.add(path.slice(1));return {acknowledged:true};}
    throw new Error('Unexpected test request '+path);
  };
  return {request,calls,documents,indexes,managed,getPolicy:()=>policy};
}
const file=()=>({id:randomUUID(),embeddingId:'website-a',uploaderId:randomUUID(),attemptId:randomUUID(),filename:'synthetic.txt'});

test('24-hour ISM policy manages hourly private indexes; rollover never touches website knowledge',async()=>{
  let now=Date.UTC(2026,9,19,1);const c=cluster(),store=createPrivateTaskSearch({request:c.request,clock:()=>now});
  const first=await store.provision();await store.provision();
  assert.equal(first,'adoption-private-tasks-v1-2026101901');assert.equal(c.indexes.size,1);
  assert.equal(c.getPolicy().states[0].transitions[0].conditions.min_index_age,'24h');
  assert.equal(c.getPolicy().states[1].actions[0].delete.constructor,Object);
  now+=3600000;assert.notEqual(await store.provision(),first);assert.equal(c.indexes.size,2);
  assert.equal(c.calls.filter(x=>x.method==='PUT'&&x.path.includes('/policies/')).length,1);
  assert.ok([...c.managed.keys()].every(index=>index.startsWith('adoption-private-tasks-v1-')));
});

test('missing or changed retention policy fails closed instead of silently storing unretained content',async()=>{
  const missing=createPrivateTaskSearch({request:async()=>{throw Object.assign(new Error('disabled'),{statusCode:403});}});
  await assert.rejects(missing.provision(),/disabled/);
  const c=cluster();await createPrivateTaskSearch({request:c.request}).provision();
  c.getPolicy().states[0].transitions[0].conditions.min_index_age='7d';
  await assert.rejects(createPrivateTaskSearch({request:c.request}).provision(),/unavailable/);
});

test('ISM enrollment acknowledgement can precede visible managed-index metadata',async()=>{
  const c=cluster();let reads=0;
  const store=createPrivateTaskSearch({request:async(...args)=>{
    const result=await c.request(...args);
    if(args[0].includes('/_ism/explain/')&&++reads<=2)return {};
    return result;
  }});
  await store.provision();assert.ok(reads>=3);
});

test('passages are chunked with locators; task/owner/website/uploader/attempt and expiry restrict retrieval',async()=>{
  let now=Date.now();const c=cluster(),store=createPrivateTaskSearch({request:c.request,clock:()=>now}),a=file(),b={...file(),embeddingId:'website-b'};
  await store.index({ownerId:'owner',taskId:'task-a',file:a,sections:[{text:'Synthetic Orchid '.repeat(400),locator:'Page 2'}]});
  await store.index({ownerId:'owner',taskId:'task-b',file:b,sections:[{text:'PRIVATE_OTHER_TASK',locator:'Page 1'}]});
  const query={ownerId:'owner',taskId:'task-a',files:[a],query:'Orchid'};
  const found=await store.search(query);assert.ok(found.length>1);assert.ok(found.every(d=>d.text.length<=1800&&d.locator==='Page 2'));
  assert.equal(JSON.stringify(found).includes('PRIVATE_OTHER_TASK'),false);
  assert.deepEqual(await store.search({...query,ownerId:'other'}),[]);
  assert.deepEqual(await store.search({...query,taskId:'task-b'}),[]);
  assert.deepEqual(await store.search({...query,files:[{...a,embeddingId:'website-b'}]}),[]);
  assert.deepEqual(await store.search({...query,files:[{...a,attemptId:randomUUID()}]}),[]);
  now+=86400001;assert.deepEqual(await store.search(query),[]);
  assert.ok(c.calls.find(x=>x.path.includes('/_search')).path.startsWith('/adoption-private-tasks-v1-*'));
});

test('empty authorized file set does not search; poisoned cross-task results are rejected',async()=>{
  let calls=0;const store=createPrivateTaskSearch({request:async()=>{calls++;return {hits:{hits:[{_source:{owner_id:'other'}}]}};}});
  assert.deepEqual(await store.search({ownerId:'owner',taskId:'task',files:[]}),[]);assert.equal(calls,0);
  await assert.rejects(store.search({ownerId:'owner',taskId:'task',files:[file()]}),/unavailable/);
});

test('bulk indexing errors and shard failures do not become ready private files',async()=>{
  const c=cluster(),search=createOpenSearch({url:'https://search.test',fetchImpl:async(url,options)=>{
    let result;try{result=await c.request(url.pathname+url.search,options.method,options.body?(options.headers['Content-Type']==='application/x-ndjson'?options.body:JSON.parse(options.body)):undefined);}
    catch(error){return {ok:false,status:error.statusCode||500,json:async()=>({error:'synthetic'})};}
    return {ok:true,status:200,json:async()=>url.pathname==='/_bulk'?{errors:true}:result};
  }});
  await assert.rejects(search.privateTasks.index({ownerId:'owner',taskId:'task',file:file(),sections:[{text:'test',locator:'Page'}]}),/Search operation failed/);
});

async function fixture(t,{store,planner,answer}={}) {
  const root=await mkdtemp(join(tmpdir(),'private-search-')),sites=new Map();
  const tasks=await createPrivateTasks({root,passageStore:store,website:id=>sites.get(id),activeScope:()=>true,
    planner:planner||(async()=>({message:'Review',actions:[]})),answer});
  t.after(async()=>{await tasks.close();await rm(root,{recursive:true,force:true});});
  const add=websiteId=>{
    sites.set(websiteId,{id:websiteId,origin:'https://'+websiteId+'.test',organizationId:'owner',verified:true,status:'approved',taskPolicy:{attachments:true,pairing:true,workflow:true}});
    const scope={embeddingId:websiteId,sessionId:randomUUID(),origin:'https://'+websiteId+'.test',audienceIds:['public'],role:'visitor'},ticket=tasks.ticket(scope,{});
    tasks.connect(ticket.ticket,scope.origin,()=>{});return {scope,instanceId:ticket.instanceId};
  };
  const upload=async a=>{
    const task=tasks.start(a.scope,a),f=await tasks.upload(a.scope,{...a,taskId:task.taskId,filename:'synthetic.txt',mime:'text/plain',operationId:randomUUID(),content:Buffer.from('Company: Synthetic Orchid').toString('base64')});
    const claim=tasks.claim('worker');return {...task,file:f,claim};
  };
  return {tasks,add,upload};
}

test('production task reads indexed passages without retaining extraction; End task denies reads while ISM owns cleanup',async t=>{
  const c=cluster(),store=createPrivateTaskSearch({request:c.request}),f=await fixture(t,{store}),a=f.add('website-a'),task=await f.upload(a);
  await f.tasks.complete(task.claim,{sections:[{text:'Company: Synthetic Orchid',locator:'Document'}]});
  assert.equal(f.tasks.metrics().retainedExtractionBytes,0);
  const input={...a,taskId:task.taskId};assert.equal((await f.tasks.summary(a.scope,input)).evidence[0].text,'Company: Synthetic Orchid');
  f.tasks.end(a.scope,input);assert.equal(f.tasks.metrics().tasks,0);assert.equal(c.documents.length,1);
  const requests=c.calls.length;await assert.rejects(f.tasks.summary(a.scope,input),/TASK_ENDED/);assert.equal(c.calls.length,requests);
  assert.equal(c.calls.some(x=>x.path.includes('_delete')||x.method==='DELETE'),false);
});

test('ending a task during extraction indexing fences completion and leaves only inaccessible retained passages',async t=>{
  let finish;const c=cluster(),base=createPrivateTaskSearch({request:c.request}),store={...base,index:async input=>{await new Promise(resolve=>finish=resolve);return base.index(input);}};
  const f=await fixture(t,{store}),a=f.add('website-a'),task=await f.upload(a),pending=f.tasks.complete(task.claim,{sections:[{text:'Late private text',locator:'Document'}]});
  f.tasks.end(a.scope,{...a,taskId:task.taskId});finish();await assert.rejects(pending,/LEASE_LOST/);
  assert.equal(c.documents.length,1);assert.equal(f.tasks.metrics().tasks,0);
});

test('End task during search stops context before any model request',async t=>{
  let finish,modelCalls=0;const c=cluster(),base=createPrivateTaskSearch({request:c.request}),store={...base,search:async input=>{await new Promise(resolve=>finish=resolve);return base.search(input);}};
  const f=await fixture(t,{store,answer:async()=>{modelCalls++;return {message:'Never'};}}),a=f.add('website-a'),task=await f.upload(a);
  await f.tasks.complete(task.claim,{sections:[{text:'Private text',locator:'Document'}]});
  const input={...a,taskId:task.taskId},pending=f.tasks.summary(a.scope,input);f.tasks.end(a.scope,input);finish();
  await assert.rejects(pending,/TASK_ENDED/);assert.equal(modelCalls,0);
});

test('removing a file during search invalidates the answer despite retained search documents',async t=>{
  const c=cluster(),base=createPrivateTaskSearch({request:c.request});let release,block=true;
  const store={...base,search:async input=>{if(block)await new Promise(resolve=>release=resolve);return base.search(input);}};
  const f=await fixture(t,{store}),a=f.add('website-a'),task=await f.upload(a);await f.tasks.complete(task.claim,{sections:[{text:'Private text',locator:'Document'}]});
  const input={...a,taskId:task.taskId},pending=f.tasks.summary(a.scope,input);f.tasks.remove(a.scope,{...input,attachmentId:task.file.id});release();
  await assert.rejects(pending,/TASK_CHANGED/);block=false;assert.deepEqual((await f.tasks.summary(a.scope,input)).evidence,[]);assert.equal(c.documents.length,1);
});

test('removing a file during model inference prevents returning its now-invalid answer',async t=>{
  let release,entered;const started=new Promise(resolve=>entered=resolve),c=cluster(),store=createPrivateTaskSearch({request:c.request});
  const f=await fixture(t,{store,answer:async()=>{entered();await new Promise(resolve=>release=resolve);return {message:'Private answer'};}}),a=f.add('website-a'),task=await f.upload(a);
  await f.tasks.complete(task.claim,{sections:[{text:'Private text',locator:'Document'}]});
  const input={...a,taskId:task.taskId},pending=f.tasks.summary(a.scope,input);await started;
  f.tasks.remove(a.scope,{...input,attachmentId:task.file.id});release();await assert.rejects(pending,/TASK_CHANGED/);
});

test('paired handoff loads only authorized passages from search; revocation during retrieval stops delivery',async t=>{
  const c=cluster(),base=createPrivateTaskSearch({request:c.request});let release,block=false;
  const store={...base,search:async input=>{if(block)await new Promise(resolve=>release=resolve);return base.search(input);}},f=await fixture(t,{store}),a=f.add('website-a'),b=f.add('website-b');
  const invite=f.tasks.invite(a.scope,a);f.tasks.join(b.scope,{...b,code:invite.code});const invitationId=f.tasks.pairStatus(a.scope,a).pending[0].invitationId;
  f.tasks.confirm(a.scope,{...a,invitationId});f.tasks.confirm(b.scope,{...b,invitationId});const task=await f.upload(a);
  await f.tasks.complete(task.claim,{sections:[{text:'Shared private passage',locator:'Document'}]});
  const relay={...a,taskId:task.taskId,targetId:b.instanceId,shareConsent:true,instruction:'Summarize'};
  assert.equal((await f.tasks.relay(a.scope,relay)).shared,true);assert.equal((await f.tasks.summary(b.scope,{...b,taskId:task.taskId})).evidence[0].text,'Shared private passage');
  block=true;const pending=f.tasks.relay(a.scope,relay);f.tasks.revoke(a.scope,{...a,targetId:b.instanceId});release();await assert.rejects(pending,/HANDOFF_DENIED/);
});

test('coordinator restart cannot restore access from surviving indexed passages',async t=>{
  const c=cluster(),store=createPrivateTaskSearch({request:c.request}),f=await fixture(t,{store}),a=f.add('website-a'),task=await f.upload(a);
  await f.tasks.complete(task.claim,{sections:[{text:'Old coordinator text',locator:'Document'}]});await f.tasks.close();
  const fresh=await fixture(t,{store}),b=fresh.add('website-a');await assert.rejects(fresh.tasks.summary(b.scope,{...b,taskId:task.taskId}),/TASK_ENDED/);
  const newTask=fresh.tasks.start(b.scope,b);assert.deepEqual((await fresh.tasks.summary(b.scope,{...b,taskId:newTask.taskId})).evidence,[]);assert.equal(c.documents.length,1);
});
