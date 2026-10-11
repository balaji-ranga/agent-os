import assert from 'node:assert/strict';
import { knowledgeSearch } from '../src/services/knowledge-search.js';
import { embeddingDims } from '../src/services/opensearch/indices.js';
const docs=new Map();let requests=0;
const transport=async(method,path,body)=>{
  if(path.endsWith('/_mget'))return {docs:body.ids.map(id=>({_source:docs.get(id)}))};
  if(path.endsWith('/_bulk')){
    const lines=body.trim().split('\n').map(JSON.parse);
    for(let i=0;i<lines.length;i+=2)docs.set(lines[i].index._id,lines[i+1]);
    return {errors:false};
  }
  return {};
};
const search=knowledgeSearch(transport,{embed:async texts=>{requests++;return texts.map(()=>Array(embeddingDims()).fill(0.01));}});
const source={id:'s1',graph_enabled:false};
const record={object_id:'object1',title:'Document',text:'Unchanged passage'};
await search.putRecord('alice',source,'r1',record);assert.equal(requests,1);
await search.putRecord('alice',{...source,revision:'r1'},'r2',record);assert.equal(requests,1);
await search.putRecord('alice',{...source,revision:'r2'},'r3',{...record,text:'Changed passage'});assert.equal(requests,2);
await search.putRecord('bob',{...source,revision:'r2'},'r4',record);assert.equal(requests,3);
console.log('Embedding reuse: unchanged owner-scoped passages reused; changed content and different owners re-embedded.');
