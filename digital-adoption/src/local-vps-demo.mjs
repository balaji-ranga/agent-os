import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const config=JSON.parse(readFileSync(process.env.ADOPTION_DEMO_CONFIG||new URL('../.local/demo-public.json',import.meta.url),'utf8'));
const html=readFileSync(new URL('../test/vps-demo.html',import.meta.url));
const recordsFile=process.env.ADOPTION_DEMO_RECORDS||new URL('../.local/local-host-records.json',import.meta.url);
const records=existsSync(recordsFile)?JSON.parse(readFileSync(recordsFile,'utf8')):[];
createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.url==='/api/records'){
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET'){res.end(JSON.stringify({records}));return;}
  if(req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:4194'){res.writeHead(403);res.end('{}');return;}
  try{
   let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>16000)throw new Error('Too large');}
   const input=JSON.parse(raw);if(!/^\/(customer|opportunity|note|goal)$/.test(input.path)||! /^[a-f0-9-]{36}$/.test(input.operationId)||!input.values||Array.isArray(input.values)||Object.entries(input.values).some(([key,value])=>!/^[a-z][a-z0-9_]{0,79}$/.test(key)||typeof value!=='string'||value.length>8000))throw new Error('Invalid record');
   const previous=records.find(record=>record.operationId===input.operationId);
   if(previous){res.end(JSON.stringify(previous));return;}
   if(records.length>=1000)throw new Error('Fixture budget reached');
   const record={id:randomUUID(),...input,createdAt:new Date().toISOString()};records.push(record);writeFileSync(recordsFile,JSON.stringify(records,null,2));res.end(JSON.stringify(record));return;
  }catch{res.writeHead(400);res.end(JSON.stringify({error:'Synthetic record save failed'}));return;}
 }
 if(req.url==='/records'){
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Saved synthetic records</title><h1>Saved synthetic records</h1><p>Persisted by this local host, separate from copilot state.</p><a href="/customer">Customer</a><a href="/opportunity">Opportunity</a><a href="/note">Note</a><a href="/goal">Scheduled goal</a><ul id="records"></ul><script type="module">const data=await(await fetch("/api/records")).json();for(const record of data.records){const item=document.createElement("li");item.textContent=JSON.stringify(record);document.querySelector("#records").append(item);}const config=await(await fetch("/demo-config.json")).json();const {mount}=await import(config.serviceUrl+"sdk.mjs");await mount(config);</script></html>');return;
 }
 if(req.url==='/demo-config.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({serviceUrl:config.serviceUrl,installationToken:config.embeddings[0].installationToken}));return;}
 if(!['/','/customer','/opportunity','/note','/goal'].includes(req.url)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);
}).listen(4194,'127.0.0.1',()=>console.log('VPS-connected local demo: http://127.0.0.1:4194/'));
