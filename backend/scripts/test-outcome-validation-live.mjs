// Focused local real-provider test. No business actions; secrets never printed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { validateStepOutcome } from '../src/services/step-outcome-validation.js';
const envFile=process.argv[2];
if(!envFile)throw new Error('Pass existing env file path (never credentials)');
const env=parse(readFileSync(envFile));
const slot=process.argv[3] === 'secondary' ? 'SECONDARY' : 'PRIMARY';
const base=env[`OPENAI_${slot}_BASE_URL`] || env.OPENAI_BASE_URL;
const key=env[`OPENAI_${slot}_API_KEY`] || env.OPENAI_API_KEY;
const model=env[`OPENAI_${slot}_MODEL`] || env.OPENAI_DEFAULT_MODEL;
assert(base && key && model,'Missing model configuration');
const cases=[
  {name:'incomplete draft rejected', assignment:'Create a Gmail draft for the lead',response:'Lead identified. The draft has not been saved in Gmail.',expected:false},
  {name:'acknowledgement rejected',assignment:'Get ETF price and percentage change',response:'Opened the browser. I will retrieve the data.',expected:false},
  {name:'complete writing accepted',assignment:'Write a one-sentence launch slogan',response:'Flolah brings your people and AI employees together to get work done.',expected:true},
  {name:'evidenced data accepted',assignment:'Return price and percentage change',response:'Price 42, previous close 40, change +5%.',evidence:[{price:42,previous_close:40}],expected:true},
];
for(const testcase of cases){
 const result=await validateStepOutcome(testcase,async({messages,maxTokens})=>{
  const response=await fetch(base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages,max_tokens:maxTokens,response_format:{type:'json_object'},temperature:0,...(/deepseek/i.test(base)?{thinking:{type:'disabled'}}:{})}),signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error(`Provider status ${response.status}`);
  const json=await response.json();return {content:json.choices?.[0]?.message?.content};
 });
 assert.notEqual(result.missing_outcomes[0],'verification',`${testcase.name}: validation unavailable`);
 assert.equal(result.satisfied,testcase.expected,testcase.name);
 console.log(`PASS: ${testcase.name}`);
}
