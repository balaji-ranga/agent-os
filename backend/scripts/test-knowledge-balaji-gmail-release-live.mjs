import assert from 'node:assert/strict';
import {knowledgeStore} from '../src/services/knowledge-store.js';
import {knowledgeSearch} from '../src/services/knowledge-search.js';
const owner=process.env.KNOWLEDGE_TEST_OWNER;
if(owner!=='ceo-bala')throw new Error('Explicit Balaji owner required');
const store=knowledgeStore(),search=knowledgeSearch();
const source=store.get(owner,'c3b1ec18-cfac-4f3d-8835-2175677ef59c');
assert.equal(source?.kind,'gmail');assert.equal(source.query,'label:Flolah-RAG-Test -in:spam -in:trash');
assert.ok(source.enabled,'Test source must remain enabled');
assert.equal(store.get('ceo-demo-brightbox-744921',source.id),undefined);
async function wait(job){
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    const row=store.history(owner,source.id).find(j=>j.id===job.id);
    if(row?.status==='completed')return row;
    if(['failed','cancelled'].includes(row?.status))throw new Error(`Gmail test ${row.status}`);
    await new Promise(r=>setTimeout(r,1000));
  }
  throw new Error('Gmail sync timeout');
}
const full=await wait(store.fullResync(owner,source.id));
assert.equal(full.trigger,'full_resync');assert.ok(full.changed>0);assert.equal(full.reused,0);
const normal=await wait(store.enqueue(owner,source.id));
assert.equal(normal.changed,0);assert.equal(normal.reused,full.records);
const page=await search.browse(owner,[store.get(owner,source.id)],null,{limit:25});
assert.equal(page.records.length,full.records);
console.log(JSON.stringify({test:'balaji_gmail_release',status:'passed',full_resync_job:full.id,incremental_job:normal.id,checked:normal.records,reused:normal.reused,changed:normal.changed,cross_owner_denied:true,message_contents_logged:false}));
