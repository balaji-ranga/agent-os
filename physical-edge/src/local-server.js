import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fault } from '../../backend/src/services/physical/contracts.js';

export function localServer({token,gateway,simulator,host='127.0.0.1'}){
  if(!token||token.length<24)throw fault('Strong local control token required');
  return createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    try{
      // Reject DNS rebinding and cross-origin browser writes. Never allow arbitrary remote hosts.
      const hostname=String(req.headers.host||'').split(':')[0];
      if(!['127.0.0.1','localhost'].includes(hostname))throw fault('Local host required',403);
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await readFile(new URL('../public/index.html',import.meta.url)));return;}
      if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)throw fault('Same-origin request required',403);
      const provided=String(req.headers.authorization||'').replace(/^Bearer /,'');const a=Buffer.from(token),b=Buffer.from(provided);
      if(a.length!==b.length||!timingSafeEqual(a,b))throw fault('Local authentication required',401);
      let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>16384)throw fault('Request too large',413);chunks.push(chunk);}
      const body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
      const currentGateway=typeof gateway==='function'?gateway():gateway;
      if(req.method==='GET'&&url.pathname==='/status'){res.end(JSON.stringify({gateway:currentGateway?.status(),simulator:simulator?.state}));return;}
      if(req.method==='POST'&&url.pathname==='/simulator/control'&&simulator){simulator.control(body.deviceId,body);res.end('{"ok":true}');return;}
      if(req.method==='POST'&&url.pathname==='/offline'&&currentGateway){res.end(JSON.stringify(await currentGateway.offline(body.deviceId)));return;}
      throw fault('Not found',404);
    }catch(e){res.statusCode=e.status||400;res.end(JSON.stringify({error:e.status?e.message:'Invalid local request'}));}
  });
}
