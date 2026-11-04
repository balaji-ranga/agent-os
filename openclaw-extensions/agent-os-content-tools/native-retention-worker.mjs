import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {readdirSync,lstatSync,realpathSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {join,resolve,sep} from 'node:path';
import {purgeNativeHistory} from './native-retention.js';

process.once('message',async({job,root})=>{
 const result={ok:true,agents:[],errors:[]};
 try{
  if(!/^ceo-[a-z0-9_-]+$/.test(job.owner)||!Number.isFinite(job.cutoffMs))throw Error('Invalid retention owner');
  const agentsRoot=realpathSync(join(root,'agents'));
  const req=createRequire('/usr/local/lib/node_modules/openclaw/package.json');
  const extension=req('sqlite-vec').getLoadablePath();
  const dist='/usr/local/lib/node_modules/openclaw/dist';
  let rewriteRows;
  if(!job.dryRun){
    if(!readFileSync(join(dist,'extensions/memory-core/manager-runtime.js'),'utf8').includes('assertRetentionSnapshot(this.db, entry);'))throw Error('Native retention snapshot fence is not installed');
    const files=readdirSync(dist).filter(f=>/^session-accessor-[\w-]+\.js$/.test(f));
    if(files.length!==1)throw Error('Unsupported native session accessor ABI');
    const mod=await import(pathToFileURL(join(dist,files[0])).href);
    rewriteRows=Object.values(mod).find(f=>typeof f==='function'&&f.name==='rewriteTranscriptEventRowsExact');
    if(!rewriteRows)throw Error('Canonical transcript rewrite unavailable');
  }
  for(const entry of readdirSync(agentsRoot,{withFileTypes:true})){
   // Same first-separator convention as tenant identity parsing; no fuzzy owner match.
   const split=entry.name.indexOf('--');
   if(!entry.isDirectory()||!entry.name.startsWith('t-')||split<0||entry.name.slice(2,split)!==job.owner)continue;
   let db;
   try{
    const path=join(agentsRoot,entry.name,'agent','openclaw-agent.sqlite');
    try{if(lstatSync(path).isSymbolicLink())throw Error('Database symlink refused');}catch(e){if(e.code==='ENOENT')continue;throw e;}
    const real=realpathSync(path);
    if(real!==resolve(path)||!real.startsWith(agentsRoot+sep))throw Error('Database path escaped agent root');
    db=new DatabaseSync(path,{allowExtension:true,readOnly:job.dryRun});db.loadExtension(extension);
    const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name);
    if(!names.includes('schema_meta')&&names.every(n=>['auth_profile_store','auth_profile_state'].includes(n)))continue;
    const report=await purgeNativeHistory(db,{agentId:entry.name,cutoffMs:job.cutoffMs,dryRun:job.dryRun,rewriteRows,storePath:join(agentsRoot,entry.name,'sessions','sessions.json')});
    result.agents.push(report);
    if(report.deferred_active_payloads){result.ok=false;result.errors.push({agent:entry.name,error:'Active session payloads deferred; another retention pass is required'});}
   }catch(error){result.ok=false;result.errors.push({agent:entry.name,error:error.message});}
   finally{db?.close();}
  }
 }catch(error){result.ok=false;result.errors.push({error:error.message});}
 process.send?.(result,()=>process.disconnect());
});
