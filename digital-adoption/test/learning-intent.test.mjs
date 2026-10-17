import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanRecipeIntent,selectWorkflows,learnedWorkflowGraph} from '../src/learning-intent.mjs';
import {openRepository} from '../src/repository.mjs';
import {createLearningStore} from '../src/learning-store.mjs';
import {createLearningRuntime} from '../src/learning-runtime.mjs';
const metadata={purpose:'Prepare search filters',use_when:'Search query and transport need reviewed values',expected_outcome:'Requested search filters are visible; nothing submitted',not_for:'delete invoice records'};
const recipe={id:'lesson-a',version:2,status:'published',title:'Search filters',metadata,steps:[{action:'navigate',path:'/search'},{action:'fill',path:'/search',field:'query',parameter:'query'}]};
test('automatic matching requires reviewed purpose, handles ambiguity and preserves a complete cross-page journey',()=>{
 const snapshot={path:'/home',links:[]},task='Set the search query and transport';
 assert.equal(selectWorkflows([{...recipe,metadata:undefined}],task,snapshot).status,'none');
 assert.equal(selectWorkflows([recipe],task,snapshot).status,'matched');
 assert.deepEqual(selectWorkflows([recipe],task,snapshot).matches[0].steps,recipe.steps);
 assert.equal(selectWorkflows([recipe,{...recipe,id:'lesson-b'}],task,snapshot).status,'ambiguous');
 assert.deepEqual(selectWorkflows([recipe,{...recipe,id:'lesson-b'}],task,snapshot).matches,[]);
 assert.equal(selectWorkflows([recipe],'Delete invoice records using search filters',snapshot).status,'none');
 assert.equal(selectWorkflows([recipe],'Delete invoice records with a query and transport',snapshot).status,'none');
 assert.equal(selectWorkflows([{...recipe,metadata:undefined}],'Use Search filters for this request',snapshot).status,'matched');
 assert.throws(()=>cleanRecipeIntent({...metadata,purpose:'api_key=secret-value'}));
});
test('learned graph derives reviewed transitions without values and excludes drafts',()=>{
 const workflow={...recipe,steps:[{action:'fill',path:'/home',field:'category',parameter:'category'},...recipe.steps]};
 const graph=learnedWorkflowGraph([workflow,{...recipe,id:'draft',status:'draft',steps:[{action:'navigate',path:'/hidden'}]}]);
 assert.deepEqual(graph.nodes.map(node=>node.path),['/home','/search']);assert.equal(graph.edges.length,1);assert.equal(graph.edges[0].from,'/home');assert.equal(graph.edges[0].to,'/search');assert.doesNotMatch(JSON.stringify(graph),/hidden|value/);
});
test('intent edits become scoped drafts and invalidate old published hints while preserving history and export',()=>{
 const repository=openRepository();try{
  const learning=createLearningRuntime(repository,createLearningStore(repository)),owner={embeddingId:'site-a',audienceId:'public',role:'maintainer'},other={...owner,embeddingId:'site-b'},visitor={embeddingId:'site-a',audienceIds:['public'],capabilities:{coach:false}};
  const draft=learning.create(owner,{title:recipe.title,steps:[recipe.steps[1]],metadata});learning.observe(owner,{revision:1,path:'/search',fields:[{ref:'r1f0',key:'query',label:'Query',type:'text'}],links:[]});learning.validate(owner,{id:draft.id,version:1});learning.publish(owner,{id:draft.id,version:1,reviewed:true});
  assert.equal(learning.context(visitor,'Prepare search filters',{path:'/search'}).status,'matched');assert.equal(learning.graph(other).nodes.length,0);assert.throws(()=>learning.graph(visitor));
  assert.deepEqual(learning.export(owner,{id:draft.id}).bundle.metadata,cleanRecipeIntent(metadata));
  const changed=learning.describe(owner,{id:draft.id,version:2,metadata:{...metadata,purpose:'A corrected search purpose'}});assert.equal(changed.status,'draft');assert.equal(learning.context(visitor,'Prepare search filters',{path:'/search'}).status,'none');assert.equal(learning.graph(owner).nodes.length,0);assert.equal(learning.versions(owner,{id:draft.id})[1].metadata.purpose,metadata.purpose);
 }finally{repository.close();}
});
