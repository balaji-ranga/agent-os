import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

export function createIngestionWorker({coordinatorUrl,token,extract,workerId=`worker-${randomUUID()}`,fetchImpl=fetch,development=false}){
 const base=new URL(coordinatorUrl);
 if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||!(base.protocol==='https:'||base.protocol==='http:'&&(base.hostname==='adoption'||development&&['127.0.0.1','localhost'].includes(base.hostname)))||typeof token!=='string'||token.length<40||token.length>256)throw new Error('Invalid worker coordinator');
 const request=async(path,input)=>{
  const response=await fetchImpl(new URL(path,base),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30_000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input)});
  if(!response.ok)throw new Error('Coordinator rejected worker operation');
  const text=await response.text();if(Buffer.byteLength(text)>23_000_000)throw new Error('Invalid coordinator response');return JSON.parse(text);
 };
 let stopped=false,currentAbort;
 return {
  async once(){
   if(stopped)return false;
   const task=await request('/claim',{workerId});if(!task.claim)return false;
   const abort=new AbortController();currentAbort=abort;let heartbeatBusy=false,root,publicationStarted=false;
   const heartbeat=setInterval(async()=>{
    if(heartbeatBusy||abort.signal.aborted)return;heartbeatBusy=true;
    try{await request('/heartbeat',{claim:task.claim});}catch{abort.abort();}finally{heartbeatBusy=false;}
   },Math.max(250,Math.floor(task.claim.leaseMs/3)));heartbeat.unref();
   try{
    const {content,kind}=task.input||{};
    if(!['pdf','docx','text','html','image','video'].includes(kind)||typeof content!=='string'||content.length>22_369_624)throw new Error('Invalid worker input');
    const bytes=Buffer.from(content,'base64');if(!bytes.length||bytes.length>16*1024*1024||bytes.toString('base64')!==content)throw new Error('Invalid worker input');
    root=await mkdtemp(join(tmpdir(),'adoption-worker-'));const path=join(root,'input');await writeFile(path,bytes,{mode:0o600});
    const result=await extract({path,kind,signal:abort.signal});
    if(abort.signal.aborted||stopped)throw new Error('Worker stopped');
    // A lost response may leave a healthy publication in flight. Join it rather
    // than failing that attempt or claiming another job for the same worker.
    publicationStarted=true;const deadline=Date.now()+45_000;let failures=0;
    while(true){
     if(abort.signal.aborted||stopped||Date.now()>=deadline)throw new Error('Worker stopped');
     let completion;try{completion=await request('/complete',{claim:task.claim,result});}catch(error){if(++failures>=2)throw error;continue;}
     if(completion.status==='ready')break;
     if(completion.pending!==true)throw new Error('Invalid worker completion');
     await delay(250);
    }
    return true;
   }catch{if(!publicationStarted&&!abort.signal.aborted&&!stopped)await request('/fail',{claim:task.claim}).catch(()=>{});return false;}
   finally{clearInterval(heartbeat);currentAbort=null;if(root)await rm(root,{recursive:true,force:true});}
  },
  stop(){stopped=true;currentAbort?.abort();},
 };
}
