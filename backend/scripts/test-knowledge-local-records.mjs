import assert from 'node:assert/strict';
import { localKnowledgeRecords } from '../src/services/knowledge-local-records.js';
import { validateSource } from '../src/services/knowledge-contract.js';

assert.deepEqual(validateSource({name:'Knowledge',kind:'knowledge',collections:['tables','documents']}).collections,['tables','documents']);
const calls=[];
const data={
  listTables(owner){assert.equal(owner,'alice');return [{id:'t1',name:'Contracts'}];},
  listRows(owner,id,{offset}){assert.equal(owner,'alice');assert.equal(id,'t1');calls.push(offset);return {rows:Array.from({length:offset===0?100:1},(_,i)=>({id:offset+i,data:{customer:'C1'}})),total:101};},
  async listDocuments(owner){assert.equal(owner,'alice');return {documents:[{id:'d1',title:'Contract',text_excerpt:'Terms'}],total:1,has_more:false};},
};
const records=[];
for await(const record of localKnowledgeRecords('alice','tables',{data}))records.push(record);
assert.equal(records.length,102);assert.deepEqual(calls,[0,100]);
assert.equal(new Set(records.map(r=>r.object_id)).size,102);
assert.equal(records[1].relations[0].target,'tables/t1');
let page=0;
const request=async(method,path,body)=>{
  assert.equal(body.query.bool.filter[0].term.owner_user_id,'alice');
  assert.equal(body.query.bool.filter[1].term.document_id,'d1');
  assert.equal(body.size,100);
  if(page++) {assert.deepEqual(body.search_after,[99]);return {hits:{hits:[]}};}
  return {hits:{hits:Array.from({length:100},(_,i)=>({_source:{chunk_index:i,content:`Passage ${i}`},sort:[i]}))}};
};
const docs=[];
for await(const record of localKnowledgeRecords('alice','documents',{data,request}))docs.push(record);
assert.equal(docs.length,101);assert.equal(docs[100].text,'Passage 99');
assert.equal(docs[100].relations[0].target,'documents/d1');
console.log('Local Knowledge sources: owner-scoped tables, complete pagination, document passages, stable IDs and relationships passed.');
