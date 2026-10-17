import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(new URL('../.local/demo-public.json',import.meta.url),'utf8'));
const html=readFileSync(new URL('../test/vps-demo.html',import.meta.url));
createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.url==='/demo-config.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({serviceUrl:config.serviceUrl,installationToken:config.embeddings[0].installationToken}));return;}
 if(!['/','/customer','/opportunity','/note','/goal'].includes(req.url)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);
}).listen(4194,'127.0.0.1',()=>console.log('VPS-connected local demo: http://127.0.0.1:4194/'));
