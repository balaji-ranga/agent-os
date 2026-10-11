import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { parseFragment } from 'parse5';

const source=readFileSync(new URL('../src/components/EfficiencyControls.jsx',import.meta.url),'utf8');
await transform(source,{loader:'jsx'});
for(const value of ['AdminEfficiencyControls','CompanyEfficiencyPreferences','CompanyEfficiencyEvidence','Save efficiency policy','Save efficiency preferences','Also run the same synthetic prompts','not separate OpenClaw inference','cost_note']) assert(source.includes(value),value);
for(const [file,name] of [['AdminModels.jsx','AdminEfficiencyControls'],['UserProfile.jsx','CompanyEfficiencyPreferences'],['EfficiencyView.jsx','CompanyEfficiencyEvidence']]) {
  const text=readFileSync(new URL('../src/pages/'+file,import.meta.url),'utf8');
  assert(text.includes('<'+name),'Mounted in existing '+file);
}
const activity={status:'running',current:{label:'Agent is working'},events:[],tool_calls:[],model_calls:[
  {id:'latest',tool_name:'summarize_url',status:'fallback',requested_model:'llama3.2',actual_model:'deepseek-chat',fallback_reason:'local_output_invalid_json',local:0},
  {id:'second',tool_name:'brain_history',status:'queued',requested_model:'<img src=x onerror=evil()>',local:null},
  {id:'third',tool_name:'learnings_summary',status:'processing',requested_model:'llama3.2',local:1},
  {id:'fourth',tool_name:'master_data_rag',status:'success',actual_model:'llama3.2',local:1},
  {id:'oldest',tool_name:'oldest_hidden',status:'success',actual_model:'llama3.2'},
]};
const compiled=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Indicator from './src/components/ChatActivityIndicator.jsx';module.exports=renderToStaticMarkup(React.createElement(Indicator,{activity:${JSON.stringify(activity)}}));`,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,define:{'import.meta.env.VITE_API_URL':'"/api"'}});
const module={exports:{}};
new Function('require','module',compiled.outputFiles[0].text)(createRequire(import.meta.url),module);
const html=module.exports;
assert(html.includes('deepseek-chat')&&html.includes('local_output_invalid_json'),'Actual model and fallback rendered');
assert(html.includes('queued')&&html.includes('processing'),'Queue and processing state rendered');
assert(!html.includes('oldest_hidden'),'Latest four calls shown, not oldest calls');
const fragment=parseFragment(html);
function tags(node){return [node.tagName,...(node.childNodes||[]).flatMap(tags)].filter(Boolean);}
assert(!tags(fragment).includes('img'),'Provider metadata is escaped, not executable HTML');
assert(html.includes('&lt;img'),'Escaped metadata remains readable');
console.log('EFFICIENCY_UI_OK (JSX compilation, menu bindings, real React activity rendering and metadata escaping)');
