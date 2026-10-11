import assert from 'node:assert/strict';
import {knowledgeStore} from '../src/services/knowledge-store.js';
import {knowledgeSearch} from '../src/services/knowledge-search.js';
const owner=process.env.KNOWLEDGE_TEST_OWNER;
if(!owner?.startsWith('ceo-demo-'))throw new Error('Explicit retained demo owner required');
const store=knowledgeStore(),search=knowledgeSearch();
for(const kind of ['crm','erp','content','knowledge']){
  const source=store.list(owner).find(s=>s.kind===kind&&s.enabled);
  assert.ok(source,`Missing retained ${kind} source`);
  async function sync(){
    const job=store.enqueue(owner,source.id),deadline=Date.now()+240000;
    while(Date.now()<deadline){
      const current=store.history(owner,source.id).find(j=>j.id===job.id);
      if(current?.status==='failed')throw new Error(`${kind}: ${current.error}`);
      if(current?.status==='completed')return store.get(owner,source.id);
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    throw new Error(`${kind} worker timeout`);
  }
  const first=await sync();assert.ok(first.revision.startsWith('g:'));
  const before=await search.browse(owner,[first],null,{limit:100});
  assert.ok(before.records.length);
  const second=await sync();assert.notEqual(first.revision,second.revision);
  const after=await search.browse(owner,[second],null,{limit:100});
  const versions=new Map(before.records.map(r=>[r.object_id,r.object_revision]));
  const unchanged=after.records.filter(r=>versions.get(r.object_id)===r.object_revision).length;
  assert.equal(unchanged,before.records.length,`${kind}: unchanged object versions should be reused`);
  console.log(JSON.stringify({kind,status:'passed',sampled_records:unchanged,checks:['deployed-worker sync','unchanged object versions retained across syncs','published generation advances']}));
}
