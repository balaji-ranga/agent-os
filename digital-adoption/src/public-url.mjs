import {lookup as resolveDns} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';

export function publicIPv4(address){
 if(isIP(address)!==4)return false;
 const [a,b,c]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||(b===0&&(c===0||c===2))||(b===88&&c===99)))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
}
export function approvedUrl(value){
 if(typeof value!=='string'||value.length>2048)throw new Error('Invalid help URL');
 const url=new URL(value);
 if(url.protocol!=='https:'||url.port&&url.port!=='443'||url.username||url.password||url.hash||[...url.searchParams.keys()].some(k=>/token|password|secret|credential|api.?key|authorization|session/i.test(k))||isIP(url.hostname)||!url.hostname.includes('.')||/(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname))throw new Error('Only public HTTPS help URLs are supported');
 return url;
}
function download(url,address){
 return new Promise((resolve,reject)=>{
  let done=false,timer;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const req=httpsRequest(url,{method:'GET',family:4,lookup:(_hostname,options,callback)=>callback(null,address,4),headers:{Accept:'text/html,text/plain','User-Agent':'FlolahKnowledge/1.0'}},res=>{
   if(res.statusCode>=300&&res.statusCode<400){res.resume();finish(null,{status:res.statusCode,location:res.headers.location});return;}
   const mime=String(res.headers['content-type']||'').split(';')[0].trim().toLowerCase();
   if(res.statusCode!==200||!['text/html','text/plain'].includes(mime)||res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.destroy();finish(new Error('Unsupported help response'));return;}
   let size=0;const chunks=[];
   res.on('data',chunk=>{size+=chunk.length;if(size>2_000_000){finish(new Error('Help page too large'));res.destroy();req.destroy();}else chunks.push(chunk);});
   res.on('end',()=>finish(null,{status:200,mime,bytes:Buffer.concat(chunks)}));res.on('error',error=>finish(error));res.on('aborted',()=>finish(new Error('Help response interrupted')));
  });
  timer=setTimeout(()=>{finish(new Error('Help fetch timed out'));req.destroy();},10_000);req.setTimeout(10_000,()=>{finish(new Error('Help fetch timed out'));req.destroy();});req.on('error',error=>finish(error));req.end();
 });
}
export function createPublicUrlFetcher({dns=resolveDns,transport=download}={}){
 return async value=>{
  let url=approvedUrl(value);const origin=url.origin;
  for(let redirect=0;redirect<=3;redirect++){
   // Resolve each hop, reject a mixed public/private DNS answer, then pin the
   // validated address into the actual TLS request. No cookies or auth headers.
   let timer;const addresses=await Promise.race([dns(url.hostname,{all:true,family:4}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Help DNS timed out')),10_000);})]).finally(()=>clearTimeout(timer));
   if(!addresses.length||addresses.some(a=>!publicIPv4(a.address)))throw new Error('Help destination denied');
   const result=await transport(url,addresses[0].address);
   if(result.status===200){if(!Buffer.isBuffer(result.bytes)||result.bytes.length>2_000_000||!['text/html','text/plain'].includes(result.mime))throw new Error('Invalid help response');return {...result,url:url.href};}
   if(![301,302,303,307,308].includes(result.status)||!result.location)throw new Error('Help response denied');
   url=approvedUrl(new URL(result.location,url).href);
   if(url.origin!==origin)throw new Error('Help redirect needs separate owner approval');
  }
  throw new Error('Help redirect limit reached');
 };
}
