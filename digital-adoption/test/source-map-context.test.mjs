import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openRepository} from '../src/repository.mjs';
import {createSourceMap} from '../src/source-map.mjs';
import {createPlatformPlanner} from '../src/platform-model.mjs';
import {reviewContext,deterministicReview} from '../integrations/checker-contract.mjs';
const scope={embeddingId:'map-context',audienceId:'public',role:'maintainer',origin:'https://example.test'};
const observation={embeddingId:scope.embeddingId,audienceId:'public',path:'/customer',forms:[{key:'customer',label:'Customer',fields:['region']}],fields:[{key:'region',label:'Region',type:'text',required:true,form:'customer'}],links:[{path:'/records',label:'Records'}]};
const formText='Priority desk customers use Express shipping; ask for missing account details.';
const fieldText='Region means servicing office, not postal location. Northern branch uses SYN-NORTH-42.';
function seed(repo){repo.map('screen_maps').set('map-context:public:/customer',observation);return createSourceMap(repo);}
function describe(map,kind,id,description){const current=map.screen(scope,{path:'/customer'});return map.describe(scope,{path:'/customer',revision:current.revision,target:{kind,...(id?{id}:{})},description,reviewed:true});}

test('observed map context persists across reopen; JSON roundtrip retains page, form, field and navigation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'adoption-map-')),file=join(dir,'map.sqlite');let repo=openRepository(file);
 try{let map=seed(repo);describe(map,'page','','Synthetic customer intake');describe(map,'form','customer',formText);describe(map,'field','region',fieldText);const out=map.export(scope);assert.equal(out.manifest.reviewed,false);assert.equal(out.manifest.screens[0].links[0].path,'/records');assert.equal(out.manifest.screens[0].forms[0].description,formText);assert.equal('ref' in out.manifest.screens[0].fields[0],false);assert.equal('value' in out.manifest.screens[0].fields[0],false);assert.equal(repo.map('screen_maps').get('map-context:public:/customer').fields[0].description,undefined);
 repo.close();repo=openRepository(file);map=createSourceMap(repo);assert.equal(map.screen(scope,{path:'/customer'}).screen.fields[0].description,fieldText);const before=map.summary(scope).revision;map.refresh(scope,{...out.manifest,reviewed:true});assert.equal(map.summary(scope).revision,before);describe(map,'field','region','');assert.equal(map.screen(scope,{path:'/customer'}).screen.fields[0].description,undefined);
 }finally{repo.close();rmSync(dir,{recursive:true,force:true});}
});

test('map context requires review and current revision; rejects private values and preserves state atomically',()=>{
 const repo=openRepository();try{const map=seed(repo),first=map.screen(scope,{path:'/customer'}),patch={path:'/customer',revision:first.revision,target:{kind:'field',id:'region'},description:fieldText,reviewed:true};
 for(const invalid of [{...patch,reviewed:false},{...patch,description:'x'.repeat(1501)},{...patch,value:'private'},{...patch,target:{kind:'field',id:'missing'}},{...patch,description:'bad\0text'}])assert.throws(()=>map.describe(scope,invalid));
 map.describe(scope,patch);assert.throws(()=>map.describe(scope,{...patch,description:'overwrite'}),e=>e.publicCode==='SOURCE_MAP_CHANGED');const before=map.summary(scope).revision;
 assert.throws(()=>map.refresh(scope,{...map.export(scope).manifest,reviewed:true,screens:[{...map.export(scope).manifest.screens[0],fields:[{key:'region',label:'Region',type:'text',value:'private',description:'Context'}]}]}));assert.equal(map.summary(scope).revision,before);
 }finally{repo.close();}
});

test('map enrichment/export respect owner capability, website and audience boundaries',()=>{
 const repo=openRepository();try{const map=seed(repo);describe(map,'field','region',fieldText);for(const variant of [{...scope,role:'visitor'},{...scope,embeddingId:'other'},{...scope,audienceId:'tenant-two'}]){assert.throws(()=>map.screen(variant,{path:'/customer'}));assert.throws(()=>map.describe(variant,{path:'/customer'}));}assert.throws(()=>map.export({...scope,role:'visitor'}));assert.equal(map.export({...scope,embeddingId:'other'}).manifest.screens.length,0);assert.equal(map.guidance({...scope,audienceId:'tenant-two'},'Northern branch',{path:'/customer'}),null);
 }finally{repo.close();}
});

test('form meaning and field descriptions reach the actual planner request with fresh executable refs only',async()=>{
 const repo=openRepository();try{const map=seed(repo);describe(map,'form','customer',formText);describe(map,'field','region',fieldText);const snapshot={revision:1,path:'/customer',screen:'Customer',fields:[{ref:'r1f0',key:'region',label:'Region',type:'text',required:true,form:'customer'}],forms:[{key:'customer',label:'Customer',fields:['region']}],links:[]},text='Prepare Region for the Northern branch using the website guidance.';
 const sourceGuidance=map.guidance({...scope,role:'visitor'},text,snapshot);assert.equal(sourceGuidance.matches[0].forms[0].description,formText);assert.equal(sourceGuidance.matches[0].fields[0].description,fieldText);
 const planner=createPlatformPlanner({gatewayUrl:'https://model.test/complete',serviceToken:'x'.repeat(40),fetchImpl:async(url,options)=>{const request=JSON.parse(options.body),context=JSON.parse(request.messages.at(-1).content);assert.equal(context.sourceGuidance.matches[0].fields[0].description,fieldText);assert.equal(context.sourceGuidance.matches[0].forms[0].description,formText);assert.equal(context.observed.fields[0].ref,'r1f0');return new Response(JSON.stringify({content:JSON.stringify({message:'Northern branch uses servicing office SYN-NORTH-42. Review this field.',actions:[{type:'fill',ref:'r1f0',value:'SYN-NORTH-42'}]})}));}});
 const result=await planner({text,snapshot,sourceGuidance});assert.equal(result.actions[0].value,'SYN-NORTH-42');assert.match(result.message,/servicing office/);const direct=await planner({text:'Set Region to Northern branch.',snapshot,sourceGuidance});assert.equal(direct.actions[0].value,'SYN-NORTH-42');
 }finally{repo.close();}
});

test('large map guidance retains requested field descriptions and reports omitted metadata',()=>{
 const repo=openRepository();try{const map=createSourceMap(repo),fields=Array.from({length:200},(_,i)=>({key:'field'+i,label:'Field '+i,type:'text',form:'form',description:'Purpose '+i+' '+'.'.repeat(1000)}));map.refresh(scope,{schema:1,origin:scope.origin,reviewed:true,screens:[{path:'/large',title:'Large form',forms:[{id:'form',label:'Form',description:'Shared form meaning'}],fields}]});const out=map.guidance(scope,'Prepare Field 199',{path:'/large',fields:[{key:'field199'}]});assert.equal(out.matches[0].fields[0].key,'field199');assert.equal(out.matches[0].fields[0].description,fields[199].description);assert.ok(out.matches[0].omittedFields>0);assert.ok(JSON.stringify(out.matches).length<9200);
 }finally{repo.close();}
});

test('checker accepts documented semantic representations instead of enforcing a literal assignment shortcut',()=>{
 const observed={revision:1,path:'/customer',fields:[{ref:'r1f0',label:'Region',key:'region',type:'text'}],links:[]},proposal={message:'Review the documented code',actions:[{type:'fill',ref:'r1f0',value:'SYN-NORTH-42'}]},task='Set Region to Northern branch.';
 const make=sourceGuidance=>reviewContext([{role:'user',content:JSON.stringify({task,observed,sourceGuidance})}],'digital_adoption_plan',proposal);
 assert.match(deterministicReview(make()),/explicitly requested/);
 const context=make({matches:[{path:'/customer',forms:[],fields:[{key:'region',description:fieldText}]}]});assert.equal(context.serverChecks.explicitAssignmentsMatch,null);assert.equal(deterministicReview(context),null);
});
