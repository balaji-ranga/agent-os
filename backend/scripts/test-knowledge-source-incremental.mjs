import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {knowledgeStore} from '../src/services/knowledge-store.js';
import {runIncrementalKnowledge} from '../src/services/knowledge-incremental.js';
import {versionedSource} from '../src/services/knowledge-versioned-source.js';
import {mailRecords} from '../src/services/knowledge-mail-adapter.js';
import {localKnowledgeRecords} from '../src/services/knowledge-local-records.js';
import {sourceRecords} from '../src/services/knowledge-source-adapters.js';
import {mapMetaHit} from '../src/services/opensearch/documents.js';
assert.equal(mapMetaHit({_id:'legacy',_version:7,_source:{}}).knowledge_content_revision,'meta:7');
assert.equal(mapMetaHit({_id:'ready',_version:7,_source:{knowledge_content_revision:'content-v2'}}).knowledge_content_revision,'content-v2');

function harness(kind='content',collections=['generated']){
  const db=new Database(':memory:'),store=knowledgeStore(db),owner='incremental-fixture';
  const source=store.save(owner,{name:'Versioned source',kind,collections,query:kind==='gmail'?'label:Fixture':undefined});
  const objects=new Map();let writes=0;
  const search={processingProfile:'test-v1',ensure:async()=>{},refresh:async()=>{},pruneIncremental:async()=>{},
    async markIncrementalSeen(o,s,d,id,v,scan){assert.equal(o,owner);const item=objects.get(id);if(!item)return false;item.scan=scan;return true;},
    async putIncrementalRecord(o,s,d,record,h,scan){objects.set(record.object_id,{record,scan});writes++;},
    async closeUnseenIncremental(o,s,d,scan){let n=0;for(const [id,r]of objects)if(r.scan!==scan){objects.delete(id);n++;}return n;}};
  return {db,store,source,objects,search,get writes(){return writes;},async run(records){store.enqueue(owner,source.id);return runIncrementalKnowledge(store.claim(),{store,search,records});}};
}

// Persist >1 page of derived members, skip extraction, and invalidate safely.
{
 const h=harness();let loads=0,version=1,size=205,fail=false;
 const records=async function*(o,s,{incremental}){yield* versionedSource('file',version,async function*(){loads++;for(let n=0;n<size;n++){if(fail&&n===150)throw new Error('Interrupted extraction');yield {object_id:`file/${n}`,text:`v${version}:${n}`};}},incremental);};
 assert.equal((await h.run(records)).changed,205);
 assert.equal((await h.run(records)).reused,205);assert.equal(loads,1);
 const latest=h.store.history(h.source.owner,h.source.id)[0];
 assert.equal(h.store.recordPage(h.source.owner,latest.id,{limit:100}).items.length,100);
 h.objects.delete('file/110');assert.equal((await h.run(records)).changed,1);assert.equal(loads,2);
 version++;fail=true;const revision=h.store.get(h.source.owner,h.source.id).revision;
 assert.equal((await h.run(records)).status,'failed');assert.equal(h.store.get(h.source.owner,h.source.id).revision,revision);
 fail=false;assert.equal((await h.run(records)).status,'completed');
 size=2;version++;assert.equal((await h.run(records)).deleted,203);
 h.search.processingProfile='test-v2';await h.run(records);assert.equal(loads,6);
 h.store.fullResync(h.source.owner,h.source.id);await runIncrementalKnowledge(h.store.claim(),{store:h.store,search:h.search,records});assert.equal(loads,7);
 assert.equal(h.store.sourceVersion({owner:'other',source_id:h.source.id},'file'),undefined);
 h.db.close();
}

// Gmail: no received-date shortcut; an old message can change labels or draft.
{
 const h=harness('gmail',['messages']);let history='10',events=[],ids=['old','new'],reads=0,expired=false,fail=false;
 const execute=async(owner,action,input)=>{
   assert.equal(owner,h.source.owner);
   if(action==='gmail.get_profile')return {historyId:history};
   if(action==='gmail.list_history'){assert.ok(input.startHistoryId);if(expired)throw Object.assign(new Error('Expired'),{status:404});return {history:events,historyId:history};}
   if(action==='gmail.fetch_emails'){assert.equal(input.query,'label:Fixture');assert.equal(input.detail,'ids');return {messages:ids.map(id=>({id}))};}
   if(action==='gmail.fetch_message_by_message_id'){reads++;if(fail)throw new Error('Injected read failure');return {messageId:input.messageId,subject:'Old mail',sender:'fixture@example.test',messageText:`${input.messageId}:${history}`};}
   throw new Error(action);
 };
 const records=(owner,source,options)=>mailRecords(owner,source,{...options,execute});
 assert.equal((await h.run(records)).changed,2);assert.equal(reads,2);
 history='11';assert.equal((await h.run(records)).reused,2);assert.equal(reads,2);
 history='12';events=[{id:'12',labelsAdded:[{message:{id:'old'}}]},{id:'11',messages:[{id:'old'}]}];
 assert.equal((await h.run(records)).changed,1);assert.equal(reads,3);
 events=[];ids=['old'];assert.equal((await h.run(records)).deleted,1);assert.equal(reads,3);
 expired=true;history='20';assert.equal((await h.run(records)).status,'completed');assert.equal(reads,4);
 expired=false;history='21';events=[{messages:[{id:'old'}]}];fail=true;
 assert.equal((await h.run(records)).status,'failed');
 assert.equal(h.store.sourceVersion({owner:h.source.owner,source_id:h.source.id},'@checkpoint/gmail'),'20');
 fail=false;assert.equal((await h.run(records)).status,'completed');
 assert.equal(h.store.sourceVersion({owner:h.source.owner,source_id:h.source.id},'@checkpoint/gmail'),'21');
 h.db.close();
}

// Outlook: only IDs and versions are listed; only changed messages fetch bodies.
{
 const h=harness('outlook',['messages']);let version='v1',reads=0;
 const execute=async(owner,action,input)=>{
   if(action==='outlook.list_messages'){assert.deepEqual(input.select,['id','lastModifiedDateTime','changeKey']);return {messages:[{id:'a',changeKey:version}],nextLink:null};}
   assert.equal(action,'outlook.get_message');reads++;return {id:'a',body:{content:version}};
 };
 const records=(o,s,x)=>mailRecords(o,s,{...x,execute});
 await h.run(records);await h.run(records);assert.equal(reads,1);
 version='v2';assert.equal((await h.run(records)).changed,1);assert.equal(reads,2);h.db.close();
}

// Knowledge table revision, not second-resolution time; documents reuse chunks.
{
 const h=harness('knowledge',['tables','documents']);let version=0,rowReads=0,chunkReads=0;
 const doc={id:'d',title:'Document',knowledge_content_revision:'ready-1',chunk_count:1};
 const data={listTables:()=>[{id:'t',name:'Table',updated_at:'same-second'}],knowledgeTableVersion:()=>version,
   listRows:()=>{rowReads++;return {rows:[{id:'r',data:{value:version}}],total:1};},
   listDocuments:async()=>({documents:[doc],has_more:false,total:1}),getDocument:async()=>doc};
 const request=async()=>{chunkReads++;return {hits:{hits:[{_source:{chunk_index:0,content:'Document text'}}]}};};
 const records=async function*(o,s,x){for(const c of s.collections)yield* localKnowledgeRecords(o,c,{...x,data,request});};
 await h.run(records);assert.equal((await h.run(records)).reused,4);assert.equal(rowReads,1);assert.equal(chunkReads,1);
 version++;await h.run(records);assert.equal(rowReads,2);assert.equal(chunkReads,1);
 doc.knowledge_indexing=true;assert.equal((await h.run(records)).status,'failed');h.db.close();
}
console.log('Source incremental harness passed: paged member reuse, missing index recovery, failure/restart, profile/full-resync invalidation, Gmail history/expiry/filter exit, Outlook metadata, same-second table edits, document readiness and tenant isolation.');

for(const kind of ['crm','erp']){
 const h=harness(kind,kind==='crm'?['companies']:['Customer']);let version='one',reads=0,present=true;
 const dependencies={access:async()=>({crm_provider:'twenty'}),
   crmPage:async(o,c,cursor,options)=>{assert.equal(options.metadataOnly,true);return {rows:present?[{id:'a',updatedAt:version}]:[],cursor:null};},
   crmRead:async()=>{reads++;return {id:'a',name:version,updatedAt:version};},
   erpPage:async(o,c,options)=>{assert.deepEqual(options.fields,['name','modified']);return {mode:'live',data:present?[{name:'a',modified:version}]:[],has_more:false};},
   erpRead:async()=>{reads++;return {mode:'live',data:{name:'a',customer_name:version,modified:version}};}};
 const records=(o,s,x)=>sourceRecords(o,s,{...x,dependencies});
 assert.equal((await h.run(records)).changed,1);assert.equal((await h.run(records)).reused,1);assert.equal(reads,1);
 version='two';assert.equal((await h.run(records)).changed,1);assert.equal(reads,2);
 present=false;assert.equal((await h.run(records)).deleted,1);assert.equal(reads,2);
 h.db.close();
}
console.log('CRM/ERP metadata-only discovery and changed-only body fetching passed.');
