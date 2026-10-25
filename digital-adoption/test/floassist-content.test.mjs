import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openRepository} from '../src/repository.mjs';
import {createSourceMap} from '../src/source-map.mjs';
import {createPlatformPlanner} from '../src/platform-model.mjs';
const manifest=JSON.parse(readFileSync(new URL('../content/flolah-cloud/floassist-map.json',import.meta.url),'utf8'));
const guide=readFileSync(new URL('../content/flolah-cloud/floassist-onboarding.txt',import.meta.url),'utf8');
const scope={embeddingId:'floassist-content-fixture',audienceId:'public',audienceIds:['public'],role:'maintainer',origin:manifest.origin};

test('FloAssist source hints import with descriptions and exclude private authentication and legal consent',()=>{
 const repo=openRepository();try{const maps=createSourceMap(repo);const result=maps.refresh(scope,{...manifest,reviewed:true});assert.deepEqual(result.counts,{screens:1,forms:3,fields:17});assert.equal(result.evidence,'owner_source_metadata_not_live_acceptance');assert.ok(result.screens[0].fields.every(f=>f.description&&!['code','mfa','consent'].includes(f.key)));assert.equal(manifest.reviewed,false);assert.throws(()=>maps.refresh(scope,manifest));assert.match(guide,/user must personally review and accept/i);assert.match(guide,/never in copilot chat/i);assert.match(guide,/does not promise zero retention/i);}finally{repo.close();}
});

test('FloAssist map covers product choices and conditional finance guidance without granting action authority',()=>{
 const product=JSON.parse(readFileSync(new URL('../../backend/src/services/floassist/product.json',import.meta.url),'utf8'));
 const fields=manifest.screens[0].fields;
 for(const c of product.connectors)assert.ok(fields.some(f=>f.key==='connector_'+c.id&&f.label===c.label));
 for(const r of product.responsibilities)assert.ok(fields.some(f=>f.key==='responsibility_'+r.id&&f.label===r.label));
 assert.match(fields.find(f=>f.key==='financial').description,/only after Administrative/);
 assert.match(fields.find(f=>f.key==='preset').description,/across Flolah/);
 assert.equal(fields.some(f=>'ref' in f||'value' in f),false);
});

test('FloAssist field meaning reaches planner context with only fresh observed executable references',async()=>{
 const repo=openRepository();try{
  const map=createSourceMap(repo);map.refresh(scope,{...manifest,reviewed:true});
  const snapshot={revision:1,path:'/free-tools/floassist/',screen:'Meet FloAssist.',forms:[{key:'details',label:'FloAssist contact details',fields:['email','phone','country']}],fields:[{ref:'r1f0',key:'email',label:'Email',type:'email',required:true,form:'details'},{ref:'r1f1',key:'phone',label:'Your personal WhatsApp number',type:'tel',required:true,form:'details'},{ref:'r1f2',key:'country',label:'Country',type:'select-one',form:'details',choices:['Singapore','India','Indonesia']}],links:[]};
  const sourceGuidance=map.guidance(scope,'Prepare my FloAssist details for Singapore; leave consent to me.',snapshot);
  let called=false;
  const planner=createPlatformPlanner({gatewayUrl:'https://gateway.test/complete',serviceToken:'x'.repeat(40),fetchImpl:async(_url,options)=>{called=true;const payload=JSON.parse(options.body),context=JSON.parse(payload.messages.at(-1).content);assert.match(context.sourceGuidance.matches[0].fields.find(f=>f.key==='phone').description,/Different from the dedicated/);assert.match(context.sourceGuidance.matches[0].forms.find(f=>f.id==='details').description,/personally reviews/);assert.equal(context.observed.fields[2].ref,'r1f2');return new Response(JSON.stringify({content:JSON.stringify({message:'Review Singapore. Enter your email and personal number; accept the terms yourself.',actions:[{type:'fill',ref:'r1f2',value:'Singapore'}]})}));}});
  const result=await planner({text:'Prepare my FloAssist details for Singapore; leave consent to me.',snapshot,sourceGuidance});assert.equal(called,true);assert.deepEqual(result.actions,[{type:'fill',ref:'r1f2',value:'Singapore'}]);
  assert.equal(map.guidance({...scope,embeddingId:'other-website'},'FloAssist',snapshot),null);
  assert.equal(map.guidance({...scope,audienceId:'private'},'FloAssist',snapshot),null);
 }finally{repo.close();}
});
