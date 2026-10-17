import {randomUUID} from 'node:crypto';
import {validateSnapshot} from './proposals.mjs';
const allowedPath=path=>typeof path==='string'&&/^\/(?!\/)[^?#\\]*$/.test(path)&&path.length<=300&&!decodeURIComponent(path).includes('..')&&!path.split('/').some(p=>/^[a-f0-9-]{32,36}$/i.test(p)||/^\d{5,}$/.test(p));
export function createDiscoveryJobs(repository,learning,{clock=Date.now}={}){
 const jobs=repository.map('discovery_jobs');
 const access=scope=>{if(scope?.role!=='maintainer'&&!scope?.capabilities?.coach)throw new Error('Coaching permission required');if(!scope.sessionId||!scope.embeddingId)throw new Error('Authorized discovery session required');return {...scope,audienceId:scope.audienceId||scope.audienceIds?.[0]};};
 const get=(scope,id)=>{const actor=access(scope),job=jobs.get(id);if(!job||job.embeddingId!==actor.embeddingId||job.audienceId!==actor.audienceId||job.origin!==actor.origin)throw new Error('Discovery job not found');return job;};
 const elapsed=job=>job.elapsedMs+(job.runningSince!==null?clock()-job.runningSince:0);
 const report=job=>({id:job.id,origin:job.origin,status:job.status,discovered:job.nodes.length,nodes:job.nodes,blocked:job.blocked,remaining:job.frontier.length+Number(Boolean(job.active)),maxPages:job.maxPages,elapsedMs:elapsed(job),completeness:'bounded approved routes only; discovered does not mean task-tested'});
 return {
  start(scope,{origin,seed,paths,maxPages=30,maxDepth=4}){
   const actor=access(scope);
   if(new URL(origin).origin!==origin||!allowedPath(seed)||!Array.isArray(paths)||!paths.length||paths.length>100||paths.some(p=>!allowedPath(p))||!paths.includes(seed)||!Number.isInteger(maxPages)||maxPages<1||maxPages>50||!Number.isInteger(maxDepth)||maxDepth<0||maxDepth>6)throw new Error('Invalid discovery scope or budget');
   if(jobs.values({embeddingId:actor.embeddingId}).some(j=>j.status==='running'&&elapsed(j)<120_000))throw new Error('Pause or stop the existing discovery job first');
   const job={id:randomUUID(),embeddingId:actor.embeddingId,audienceId:actor.audienceId,origin,paths:[...new Set(paths)],maxPages,maxDepth,frontier:[{path:seed,depth:0}],seen:[seed],nodes:[],blocked:[],active:null,status:'running',elapsedMs:0,runningSince:clock()};jobs.set(job.id,job);return report(job);
  },
  next(scope,id,{hasUnsavedWork}){
   return repository.transaction(()=>{const actor=access(scope),job=get(scope,id);if(hasUnsavedWork!==false){job.elapsedMs=elapsed(job);job.runningSince=null;job.status='paused';job.pauseReason='Host has an edited draft';jobs.set(id,job);return {paused:true,reason:job.pauseReason};}
    if(job.status!=='running')return {paused:true,status:job.status};
    if(elapsed(job)>=120_000||job.nodes.length>=job.maxPages){job.elapsedMs=elapsed(job);job.runningSince=null;job.status='bounded';jobs.set(id,job);return {done:true,report:report(job)};}
    if(job.active&&job.leaseUntil>clock()&&job.leaseSession!==actor.sessionId)throw new Error('Another authorized session is observing this page');
    if(!job.active)job.active=job.frontier.shift()||null;
    if(!job.active){job.elapsedMs=elapsed(job);job.runningSince=null;job.status='completed';jobs.set(id,job);return {done:true,report:report(job)};}
    job.leaseSession=actor.sessionId;job.leaseUntil=clock()+30_000;jobs.set(id,job);return {next:job.active};
   });
  },
  observe(scope,id,input){return repository.transaction(()=>{
   const actor=access(scope),snapshot=validateSnapshot(input),job=get(scope,id);
   if(job.status!=='running'||job.leaseSession!==actor.sessionId||job.leaseUntil<=clock()||snapshot.path!==job.active?.path)throw new Error('Discovery observation is stale');
   const map=learning.observe({...scope,origin:job.origin},snapshot),depth=job.active.depth;
   job.nodes=job.nodes.filter(node=>node.path!==snapshot.path);job.nodes.push({...map,status:'discovered-not-tested'});
   for(const link of snapshot.links){if(!job.paths.includes(link.path)){if(job.blocked.length<100)job.blocked.push({path:link.path,reason:'Route not approved for read-only discovery'});continue;}if(!job.seen.includes(link.path)&&depth<job.maxDepth&&job.seen.length<job.maxPages){job.seen.push(link.path);job.frontier.push({path:link.path,depth:depth+1});}}
   if(input.blockedCount>0&&job.blocked.length<100)job.blocked.push({path:snapshot.path,count:Math.min(1000,input.blockedCount),reason:'Unknown or effectful controls were not activated'});
   job.active=null;job.leaseUntil=0;jobs.set(id,job);return report(job);
  });},
  control(scope,id,operation){return repository.transaction(()=>{const job=get(scope,id),allowed={pause:['running'],resume:['paused'],stop:['running','paused']};if(!allowed[operation]?.includes(job.status))throw new Error('Discovery cannot transition');job.elapsedMs=elapsed(job);job.runningSince=null;if(operation==='resume'){if(job.elapsedMs>=120_000)throw new Error('Discovery budget exhausted');job.status='running';job.runningSince=clock();job.leaseUntil=0;}else job.status=operation==='stop'?'stopped':'paused';jobs.set(id,job);return report(job);});},
  status(scope,id){return report(get(scope,id));},
  list(scope){const actor=access(scope);return jobs.values({embeddingId:actor.embeddingId,audienceId:actor.audienceId,origin:actor.origin}).slice(-20).map(report);},
 };
}
