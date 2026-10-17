import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenSearch} from '../src/opensearch.mjs';
import {knowledgeScope} from '../src/knowledge-scope.mjs';

test('additive lexical backfill is embedding-filtered and completion is recorded only after successful updates',async()=>{
 const index=knowledgeScope({embeddingId:'fixture',audienceIds:['public']}).index,calls=[];let fail=true,complete=false;
 const search=createOpenSearch({url:'https://search.test',fetchImpl:async(url,options)=>{
  const body=options.body?JSON.parse(options.body):undefined;calls.push({path:url.pathname,method:options.method,body});
  if(options.method==='HEAD')return {ok:true};
  if(options.method==='GET')return {ok:true,json:async()=>({[index]:{mappings:complete?{_meta:{adoptionLexicalVersion:1},properties:{title:{fields:{english:{analyzer:'english'}}},text:{fields:{english:{analyzer:'english'}}}}}:{_meta:{retained:'existing'}}}})};
  if(url.pathname.endsWith('/_update_by_query')){assert.deepEqual(body,{query:{term:{embedding_id:'fixture'}}});return {ok:true,json:async()=>fail?{failures:[{cause:'synthetic'}]}:{updated:3,failures:[]}};}
  if(body?._meta){assert.equal(body._meta.retained,'existing');assert.equal(body._meta.adoptionLexicalVersion,1);complete=true;}
  return {ok:true,json:async()=>({acknowledged:true})};
 }});
 await assert.rejects(search.provision('fixture'),/Search operation failed/);assert.equal(complete,false);assert.equal(calls.some(c=>c.body?._meta),false);
 fail=false;await search.provision('fixture');assert.equal(complete,true);const before=calls.length;await search.provision('fixture');assert.equal(calls.length,before+2);assert.ok(calls.every(c=>c.path.startsWith('/'+index)));
 const fields=calls.find(c=>c.body?.properties)?.body.properties;assert.equal(fields.text.fields.english.analyzer,'english');assert.equal(fields.title.type,'text');
});

test('lexical query combines original and stemmed fields while retaining mandatory source authorization',()=>{
 const scope=knowledgeScope({embeddingId:'fixture',audienceIds:['public']}),body=scope.search({query:'retained drafts'}).body;
 assert.equal(body.query.bool.must[0].multi_match.type,'most_fields');assert.ok(body.query.bool.must[0].multi_match.fields.includes('text.english'));assert.deepEqual(body.query.bool.filter[0],{term:{embedding_id:'fixture'}});
});
