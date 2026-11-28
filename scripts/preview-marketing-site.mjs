// Static local preview only; never proxies to the production application/API.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const site=fileURLToPath(new URL('../deploy/static/flolah-home/',import.meta.url));
const docs=fileURLToPath(new URL('../docs-site/build/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.mp4':'video/mp4','.vtt':'text/vtt'};
const server=createServer(async(req,res)=>{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
 try{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname),isDocs=path==='/docs'||path.startsWith('/docs/');
  const root=resolve(isDocs?docs:site),relative=isDocs?path.slice(5):path;
  let file=resolve(root,'.'+(relative||'/'));
  if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  if((await stat(file)).isDirectory())file=resolve(file,'index.html');
  const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404,{'Content-Type':'text/plain'}).end('Not found in the local static preview. Build docs with npm run build --prefix docs-site.');}
});
const port=Number(process.env.PREVIEW_PORT||4173);
server.listen(port,'127.0.0.1',()=>console.log(`Flolah local preview: http://127.0.0.1:${port}/`));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
