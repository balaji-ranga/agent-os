import test from 'node:test';
import assert from 'node:assert/strict';
import {goalResponseSchema,parseGoalResponse} from '../src/goal-contract.mjs';
import {completeProvider} from '../integrations/provider-completion.mjs';

test('goal schemas separate local and exact available peer shapes; no peer kind without a peer',()=>{
 const local=goalResponseSchema().properties.steps.items;
 assert.equal(local.additionalProperties,false);assert.equal(local.properties.recipient,undefined);assert.ok(!local.properties.kind.enum.includes('peer'));
 const variants=goalResponseSchema('plan',[{instanceId:'authorized-peer'}]).properties.steps.items.anyOf;
 assert.deepEqual(variants[1].properties.recipient.enum,['authorized-peer']);assert.equal(variants[1].additionalProperties,false);
 assert.deepEqual(goalResponseSchema('assess').properties.status.enum,['complete','continue','clarify']);
});

test('consecutive work for one recipient preserves every instruction/outcome in one task without crossing scope',()=>{
 const step=(instruction,extra={})=>({title:'Paired task',kind:'peer',recipient:'peer-a',mode:'goal',instruction,expected:'Observed '+instruction,...extra});
 const parse=steps=>parseGoalResponse(JSON.stringify({message:'Review',steps})).steps;
 const merged=parse([step('Share the reviewed reference privately.'),step('Use that reference; preserve the current selection and never submit.')]);
 assert.equal(merged.length,1);assert.match(merged[0].instruction,/Share the reviewed reference privately/);assert.match(merged[0].instruction,/never submit/);assert.match(merged[0].instruction,/Observed Share/);
 assert.equal(parse([step('One'),step('Two',{recipient:'peer-b'})]).length,2);
 assert.equal(parse([step('One'),step('Inspect',{mode:'inspect'}),step('Two')]).length,3);
 assert.equal(parse([step('x'.repeat(1200),{expected:'First result'}),step('y'.repeat(1200),{expected:'Second result'})]).length,2);
 assert.throws(()=>parse([step('One',{executionToken:'untrusted'})]));
});

test('official OpenAI schema output is strict; compatible cloud endpoints retain their JSON protocol',async()=>{
 const schema=goalResponseSchema('plan',[{instanceId:'authorized-peer'}]);
 for(const baseUrl of ['https://api.openai.com/v1','https://compatible.example/v1']){
  let sent;
  await completeProvider({config:{baseUrl,model:'configured-model',apiKey:'synthetic'},messages:[{role:'user',content:'JSON descriptions only'}],maxTokens:2000,outputSchema:schema},async(_,{body})=>{sent=JSON.parse(body);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"message":"Clarify","steps":[]}'}}]})};});
  assert.equal(sent.response_format.type,baseUrl.includes('api.openai.com')?'json_schema':'json_object');
  if(sent.response_format.type==='json_schema'){assert.equal(sent.response_format.json_schema.strict,true);assert.deepEqual(sent.response_format.json_schema.schema,schema);}
 }
});
