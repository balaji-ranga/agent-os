import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {knowledgeStore} from '../src/services/knowledge-store.js';
import {runIncrementalKnowledge} from '../src/services/knowledge-incremental.js';
import {manageKnowledgeRecords} from '../src/services/knowledge-record-management.js';
const db=new Database(':memory:'),store=knowledgeStore(db),owner='test-incremental';
const source=store.save(owner,{name:'Incremental',kind:'content',collections:['generated']});
const objects=new Map();let writes=0,fail=null;
const search={processingProfile:'fixture',ensure:async()=>{},refresh:async()=>{},pruneIncremental:async()=>{},
  async markIncrementalSeen(o,s,d,id,v,scan){const item=objects.get(id);if(!item)return false;item.scan=scan;return true;},
  async putIncrementalRecord(o,s,d,r,h,scan){if(r.object_id===fail)throw new Error('Injected object failure');writes++;objects.set(r.object_id,{record:r,scan});},
  async closeUnseenIncremental(o,s,d,scan){let n=0;for(const [id,item] of objects)if(item.scan!==scan){objects.delete(id);n++;}return n;},
  async deleteIndexedRecords(o,s,ids){ids.forEach(id=>objects.delete(id));},
};
let rows=[{object_id:'a',text:'Alpha'},{object_id:'b',text:'Bravo'}];
const run=async()=>{store.enqueue(owner,source.id);const job=store.claim();return runIncrementalKnowledge(job,{store,search,records:async function*(){yield* rows;}});};
assert.equal((await run()).changed,2);assert.equal(writes,2);
assert.equal((await run()).reused,2);assert.equal(writes,2);
assert.deepEqual(((j)=>({checked:j.records,changed:j.changed,reused:j.reused,deleted:j.deleted,trigger:j.trigger}))(store.history(owner,source.id)[0]),{checked:2,changed:0,reused:2,deleted:0,trigger:'manual'});
rows[0]={object_id:'a',text:'Alpha changed'};assert.equal((await run()).changed,1);assert.equal(writes,3);
rows.push({object_id:'c',text:'Charlie'},{object_id:'d',text:'Delta'});fail='d';
const prior=store.get(owner,source.id).revision;
assert.equal((await run()).status,'failed');assert.equal(store.get(owner,source.id).revision,prior);
fail=null;const retried=await run();assert.equal(retried.changed,1);assert.equal(retried.reused,3);
rows=rows.filter(r=>r.object_id!=='b');assert.equal((await run()).deleted,1);
await assert.rejects(()=>manageKnowledgeRecords('other',{source_id:source.id,action:'exclude',object_ids:['a'],confirm:'INDEX_ONLY'},{store,search,assertAccess:async()=>{}}),/not found/);
await assert.rejects(()=>manageKnowledgeRecords(owner,{source_id:source.id,action:'exclude',object_ids:['a']},{store,search,assertAccess:async()=>{}}),/Confirm/);
await manageKnowledgeRecords(owner,{source_id:source.id,action:'exclude',object_ids:['a'],confirm:'INDEX_ONLY'},{store,search,assertAccess:async()=>{}});
await run();assert.equal(objects.has('a'),false);assert.ok(rows.some(r=>r.object_id==='a'));
await manageKnowledgeRecords(owner,{source_id:source.id,action:'restore',object_ids:['a']},{store,search,assertAccess:async()=>{}});
await run();assert.equal(objects.has('a'),true);
console.log('Incremental harness passed: unchanged reuse, changed-only writes, failure resume, deletion, exclude/restore, originals unchanged and tenant isolation.');
db.close();
