import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {pathToFileURL,fileURLToPath} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.ADOPTION_PLAYWRIGHT_PATH).href);
const built=await build({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import Controls from './src/components/CopilotQualityControls.jsx';createRoot(document.getElementById('root')).render(<Controls/>);",resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'jsx'},bundle:true,format:'esm',jsx:'automatic',write:false,define:{'import.meta.env.VITE_API_URL':'"/api"','process.env.NODE_ENV':'"test"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?built.outputFiles[0].text:'<!doctype html><div id="root"></div><script type="module" src="/app.js"></script>');});server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
let state={enabled:true,checkerMode:'ollama_reasoning',maker:{label:'Configured maker'},checker:{label:'Configured reasoning',slot:'ollama_reasoning',configured:true},localModels:[{id:'synthetic-small',name:'Small local','model':'small-local'},{id:'synthetic-reasoner',name:'Reasoning local','model':'reasoner-local'}]},writes=[];
try{const page=await browser.newPage();await page.route('**/api/admin/copilot-quality',async route=>{
 if(route.request().method()==='PUT'){const payload=route.request().postDataJSON();writes.push(payload);state={...state,...payload,checker:{label:payload.checkerDeploymentId||'Configured inactive',slot:payload.checkerMode,configured:true}};}
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(state)});
 });
 await page.goto('http://127.0.0.1:'+server.address().port);await page.getByLabel('Checker route').selectOption('ollama_local');await page.getByLabel('Local checker model').selectOption('synthetic-small');await page.getByRole('button',{name:'Save copilot review settings'}).click();await page.getByRole('status').waitFor();
 assert.deepEqual(writes.at(-1),{enabled:true,checkerMode:'ollama_local',checkerMaxTokens:700,checkerDeploymentId:'synthetic-small',localThinking:false});
 await page.getByLabel('Local checker model').selectOption('synthetic-reasoner');await page.getByLabel(/Enable thinking for this checker/).check();await page.getByRole('button',{name:'Save copilot review settings'}).click();await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent.includes('Maker/checker'));
 assert.deepEqual(writes.at(-1),{enabled:true,checkerMode:'ollama_local',checkerMaxTokens:700,checkerDeploymentId:'synthetic-reasoner',localThinking:true});
 await page.getByLabel('Checker output token budget').fill('1536');await page.getByRole('button',{name:'Save copilot review settings'}).click();await page.waitForTimeout(50);assert.equal(writes.at(-1).checkerMaxTokens,1536);
 await page.getByLabel('Checker output token budget').fill('127');assert.equal(await page.getByRole('button',{name:'Save copilot review settings'}).isDisabled(),true);await page.getByLabel('Checker output token budget').fill('1536');
 await page.getByLabel('Checker route').selectOption('platform_inactive');await page.getByRole('button',{name:'Save copilot review settings'}).click();await page.waitForTimeout(50);assert.deepEqual(writes.at(-1),{enabled:true,checkerMode:'platform_inactive',checkerMaxTokens:1536});
 console.log('PASS browser: independent registered local model selection, thinking option, persisted save payload, and legacy hosted route without local fields. API mocked; no production setting changed.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
