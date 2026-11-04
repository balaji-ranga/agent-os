import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function registerNativeRetentionService(api,{baseUrl,brokerSecret,root}){
 if(typeof api.registerService!=='function')return;
 let timer,child,running=false,stopped=true;
 const request=async(path,body={})=>{
  const base=String(baseUrl||'').replace(/\/$/,'');if(!base)throw Error('Retention API unavailable');
  const response=await fetch(base+'/api/tools/native-retention/'+path,{method:'POST',headers:{'Content-Type':'application/json','x-agent-os-tool-broker':brokerSecret()},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(`Retention API ${response.status}`);return response.json();
 };
 const tick=async()=>{
  if(stopped||running)return;running=true;
  try{
   const {job}=await request('claim');if(!job||stopped)return;
   const result=await new Promise((resolve,reject)=>{
    child=fork(fileURLToPath(new URL('./native-retention-worker.mjs',import.meta.url)),[],{stdio:['ignore','ignore','pipe','ipc']});
    // Content-free worker diagnostics only; never forward arbitrary DB contents.
    child.stderr.on('data',()=>{});
    const deadline=setTimeout(()=>{child?.kill();reject(Error('Retention worker deadline exceeded'));},25*60000);
    child.once('message',value=>{clearTimeout(deadline);resolve(value);});
    child.once('error',error=>{clearTimeout(deadline);reject(error);});
    child.once('exit',()=>{clearTimeout(deadline);reject(Error('Retention worker exited without a result'));});
    child.send({job,root});
   });
   await request('complete',{id:job.id,lease:job.lease,result});
   api.logger?.info?.(`Company SQLite retention worker completed ok=${result.ok} agents=${result.agents.length}`);
  }catch(error){api.logger?.warn?.('Company SQLite retention worker: '+error.message);}
  finally{child=null;running=false;}
 };
 api.registerService({id:'flolah-native-retention',start(){stopped=false;timer=setInterval(()=>void tick(),60000);timer.unref?.();},stop(){stopped=true;clearInterval(timer);child?.kill();}});
}
