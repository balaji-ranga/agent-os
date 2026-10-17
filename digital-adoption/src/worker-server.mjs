import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';

// Separate private listener. Never route this port through the public proxy.
export function createWorkerServer({ingestion,token}){
 if(typeof token!=='string'||token.length<40||token.length>256)throw new Error('Invalid worker credential');
 const expected=createHash('sha256').update(`Bearer ${token}`).digest();
 let active=0;
 const server=createServer(async(req,res)=>{
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  if(!timingSafeEqual(expected,createHash('sha256').update(req.headers.authorization||'').digest())||req.headers.origin)return send(403,{error:'Worker access denied'});
  if(req.method==='GET'&&req.url==='/status')return send(200,ingestion.metrics());
  if(req.method!=='POST'||!['/claim','/heartbeat','/complete','/fail'].includes(req.url))return send(404,{error:'Not found'});
  if(active>=68)return send(429,{error:'Worker capacity reached'});
  active++;
  try{
   if(req.headers['content-type']!=='application/json')return send(415,{error:'JSON required'});
   const chunks=[];let size=0;const limit=req.url==='/complete'?1_500_000:2048;
   for await(const chunk of req){size+=chunk.length;if(size>limit)return send(413,{error:'Worker request too large'});chunks.push(chunk);}
   const input=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
   if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid worker request');
   if(req.url==='/claim'){
    const claim=ingestion.claim(input.workerId);if(!claim)return send(200,{claim:null});
    try{return send(200,{claim,input:await ingestion.input(claim)});}catch{ingestion.fail(claim);throw new Error('Worker input unavailable');}
   }
   if(req.url==='/heartbeat')return send(200,ingestion.heartbeat(input.claim));
   if(req.url==='/complete')return send(200,await ingestion.complete(input.claim,input.result));
   return send(200,ingestion.fail(input.claim));
  }catch{return send(409,{error:'Worker operation rejected; lease or dependency unavailable'});}
  finally{active--;}
 });
 server.requestTimeout=30_000;server.headersTimeout=10_000;server.maxRequestsPerSocket=1000;
 return server;
}
