import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
test('repository applies owner/embedding filters before returning records and rejects arbitrary query fields',()=>{
 const repository=openRepository();try{
  const rows=repository.map('sources');rows.set('a',{embeddingId:'A',organizationId:'owner-A',audienceId:'public',text:'alpha'});rows.set('b',{embeddingId:'B',organizationId:'owner-B',audienceId:'public',text:'beta'});
  assert.deepEqual(rows.values({embeddingId:'A'}).map(row=>row.text),['alpha']);assert.deepEqual(rows.entries({organizationId:'owner-B',audienceId:'public'}).map(([id])=>id),['b']);
  assert.equal(rows.values({embeddingId:"A' OR 1=1 --"}).length,0);assert.throws(()=>rows.values({"embeddingId') OR 1=1 --":'A'}));assert.throws(()=>rows.values({embeddingId:{$ne:'B'}}));
 }finally{repository.close();}
});
