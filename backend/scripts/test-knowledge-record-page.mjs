import assert from 'node:assert/strict';
import {recordPageOptions,recordPreview} from '../src/services/knowledge-record-page.js';
assert.match(recordPreview({fields:{crm_account_id:'hidden-id',project:'PROJ-2',renewal_terms:'30 days notice'}}),/project: PROJ-2/);
assert.ok(!recordPreview({fields:{crm_account_id:'hidden-id',project:'PROJ-2'}}).includes('hidden-id'));
assert.equal(recordPreview({text:'x'.repeat(500)}).length,240);
assert.equal(recordPreview({fields:{chunk_index:0,filename:'file.md'},text:'Actual contract content'}),'Actual contract content');
const contactPreview=recordPreview({fields:{id:'hidden',companyId:'hidden',name:{firstName:'Priya',lastName:'Tan'},emails:{primaryEmail:'priya@example.test'}},text:'{"id":"hidden"}'});
assert.match(contactPreview,/first Name: Priya/);
assert.match(contactPreview,/priya@example.test/);
assert.ok(!contactPreview.includes('hidden'));
import {knowledgeSearch} from '../src/services/knowledge-search.js';
const source={id:'source-1',revision:'revision-1'},entity='a'.repeat(64);
const options=recordPageOptions('owner',source,null,{query:'Acme',limit:25});
const token=options.cursor(entity);
assert.equal(recordPageOptions('owner',source,token,{query:'Acme'}).entity,entity);
for(const [owner,s,q] of [['other',source,'Acme'],['owner',{...source,id:'other'},'Acme'],['owner',{...source,revision:'new'},'Acme'],['owner',source,'Changed']]) {
  assert.throws(()=>recordPageOptions(owner,s,token,{query:q}),e=>e.status===409);
}
assert.throws(()=>recordPageOptions('owner',source,'invalid',{}));
assert.throws(()=>recordPageOptions('owner',source,null,{query:'x'.repeat(201)}));
assert.throws(()=>recordPageOptions('owner',source,null,{limit:10000}));
assert.equal(recordPageOptions('owner',source,entity,{}).entity,entity);
let request;
const search=knowledgeSearch(async(method,path,body)=>{
  request=body;return {hits:{hits:[{_source:{entity,object_id:'record-1'},sort:[entity]},{_source:{entity:'b'.repeat(64)},sort:['b'.repeat(64)]}]}};
});
const page=await search.browse('owner',[source],null,{query:'Acme',limit:1,compact:true});
assert.equal(page.records.length,1);assert.ok(page.next);
assert.equal(request.size,2);assert.equal(request.track_total_hits,false);
assert.ok(!request._source.includes('text'));
assert.ok(request._source.includes('preview'));
assert.equal(request.highlight.fields.text.fragment_size,240);
assert.ok(JSON.stringify(request.query).includes('owner'));
assert.ok(JSON.stringify(request.query).includes('Acme'));
assert.equal(recordPageOptions('owner',source,page.next,{query:'Acme'}).entity,entity);
const contentSearch=knowledgeSearch(async(method,path,body)=>{
  const query=JSON.stringify(body.query);
  assert.ok(query.includes('renewal terms'));
  assert.ok(query.includes('text'));
  return {hits:{hits:[{_source:{entity,title:'Contract A',object_id:'record-123',preview:'Original generic preview'},highlight:{text:['The renewal terms require 30 days written notice.']},sort:[entity]}]}};
});
const contentPage=await contentSearch.browse('owner',[source],null,{query:'renewal terms',limit:25,compact:true});
assert.equal(contentPage.records[0].preview,'The renewal terms require 30 days written notice.');
assert.equal(contentPage.records[0].title,'Contract A');
console.log('Knowledge record search: bounded pages, compact projection, legacy cursor and owner/source/revision/query cursor binding passed.');
