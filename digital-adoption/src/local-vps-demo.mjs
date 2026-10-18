import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const config=JSON.parse(readFileSync(process.env.ADOPTION_DEMO_CONFIG||new URL('../.local/demo-public.json',import.meta.url),'utf8'));
const html=()=>readFileSync(new URL('../test/vps-demo.html',import.meta.url));
const recordsFile=process.env.ADOPTION_DEMO_RECORDS||new URL('../.local/local-host-records.json',import.meta.url);
const records=existsSync(recordsFile)?JSON.parse(readFileSync(recordsFile,'utf8')):[];
createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method==='GET'&&(req.url==='/uat-evidence'||/^\/uat-evidence\/[A-Za-z0-9_.-]+\.(html|png|json|csv)$/.test(req.url))){try{const name=req.url==='/uat-evidence'?'index.html':req.url.split('/').at(-1);res.setHeader('Content-Type',name.endsWith('.png')?'image/png':name.endsWith('.json')?'application/json':name.endsWith('.csv')?'text/csv':'text/html; charset=utf-8');res.end(readFileSync(new URL('../test/evidence/feedback-20261018/'+name,import.meta.url)));}catch{res.writeHead(404);res.end('Evidence has not been generated.');}return;}
 if(req.method==='GET'&&/^\/fixtures\/(react|angular)\.bundle\.mjs$/.test(req.url)){try{res.setHeader('Content-Type','text/javascript');res.end(readFileSync(new URL('../.local/frameworks/'+req.url.split('/').at(-1),import.meta.url)));}catch{res.writeHead(404);res.end('Build test/frameworks before using framework fixtures.');}return;}
 if(req.method==='GET'&&/^\/fixtures\/web\/[a-z-]+\.mjs$/.test(req.url)){try{res.setHeader('Content-Type','text/javascript');res.end(readFileSync(new URL('../web/'+req.url.split('/').at(-1),import.meta.url)));}catch{res.writeHead(404);res.end();}return;}
 if(['/framework-react','/framework-angular'].includes(req.url)){const name=req.url.slice('/framework-'.length);res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Real ${name} framework fixture</title><style>body{font:16px system-ui;padding:24px}label{display:block;margin:16px}input,select{font:inherit;margin:8px}output,pre{display:block;white-space:pre-wrap}</style><h1>${name} controlled form</h1><a data-adoption-navigation="safe" href="/customer">Customer</a><framework-root id="framework-root"></framework-root><pre id="saved" role="status"></pre><script type="module" src="/fixtures/${name}.bundle.mjs"></script><script type="module">const config=await(await fetch('/demo-config.json')).json();const {mount}=await import(config.serviceUrl+'sdk.mjs');mount(config).catch(console.error);</script></html>`);return;}
 if(req.url==='/api/records'){
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET'){res.end(JSON.stringify({records}));return;}
  if(req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:4194'){res.writeHead(403);res.end('{}');return;}
  try{
   let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>16000)throw new Error('Too large');}
   const input=JSON.parse(raw);if(!/^\/(customer|opportunity|note|goal|framework-react|framework-angular)$/.test(input.path)||! /^[a-f0-9-]{36}$/.test(input.operationId)||!input.values||Array.isArray(input.values)||Object.entries(input.values).some(([key,value])=>!/^[a-z][a-z0-9_]{0,79}$/.test(key)||typeof value!=='string'||value.length>8000))throw new Error('Invalid record');
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
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html());
}).listen(4194,'127.0.0.1',()=>console.log('VPS-connected local demo: http://127.0.0.1:4194/'));
