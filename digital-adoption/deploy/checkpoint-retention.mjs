import {readdir,lstat,realpath,unlink,readFile} from 'node:fs/promises';
import {resolve,dirname,basename,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const supported=name=>/^(?:before-[A-Za-z0-9_-]{1,80}\.sqlite|config-before-[A-Za-z0-9_-]{1,80}\.tgz)$/.test(name);
export async function planRetention({directories,retentionDays,now=Date.now()}){
 if(!Array.isArray(directories)||directories.length!==2||directories.some(d=>typeof d!=='string'||!isAbsolute(d))||!Number.isSafeInteger(retentionDays)||retentionDays<1||retentionDays>3650||!Number.isFinite(now))throw new Error('Invalid retention policy');
 const roots=[];for(const directory of directories){const path=resolve(directory),stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(path)!==path)throw new Error('Invalid checkpoint directory');roots.push(path);}
 if(new Set(roots).size!==2)throw new Error('Distinct checkpoint directories required');
 const candidates=[];for(const root of roots)for(const entry of await readdir(root,{withFileTypes:true})){if(!entry.isFile()||!supported(entry.name))continue;const path=resolve(root,entry.name),stat=await lstat(path);if(stat.isFile()&&!stat.isSymbolicLink()&&stat.mtimeMs<=now-retentionDays*86400000)candidates.push({path,root,bytes:stat.size,mtimeMs:stat.mtimeMs,ino:stat.ino,dev:stat.dev});}
 return {retentionDays,plannedAt:now,roots,candidates};
}
export async function applyRetention(plan){
 if(!plan||!Array.isArray(plan.roots)||plan.roots.length!==2||!Array.isArray(plan.candidates)||!Number.isSafeInteger(plan.retentionDays)||plan.retentionDays<1||plan.retentionDays>3650||!Number.isFinite(plan.plannedAt))throw new Error('Invalid retention plan');
 for(const root of plan.roots){if(!isAbsolute(root)||await realpath(root)!==root||(await lstat(root)).isSymbolicLink())throw new Error('Checkpoint directory changed');}
 // Validate the complete snapshot before the first deletion. Recheck each
 // candidate at dispatch; directories are operator-owned, never upload paths.
 const check=async candidate=>{if(!plan.roots.includes(candidate.root)||!isAbsolute(candidate.path)||dirname(candidate.path)!==candidate.root||resolve(candidate.path)!==candidate.path||!supported(basename(candidate.path)))throw new Error('Checkpoint escaped its approved directory');const s=await lstat(candidate.path);if(!s.isFile()||s.isSymbolicLink()||s.size!==candidate.bytes||s.mtimeMs!==candidate.mtimeMs||s.ino!==candidate.ino||s.dev!==candidate.dev||s.mtimeMs>plan.plannedAt-plan.retentionDays*86400000)throw new Error('Checkpoint changed; generate a fresh plan');};
 for(const candidate of plan.candidates)await check(candidate);
 let deleted=0;for(const candidate of plan.candidates){await check(candidate);await unlink(candidate.path);deleted++;}return {deleted};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [policyFile,...directories]=process.argv.slice(2).filter(a=>a!=='--apply'),policy=JSON.parse(await readFile(policyFile,'utf8'));if(policy.mode==='manual')console.log(JSON.stringify({service:'digital-adoption-retention',mode:'manual',deleted:0}));else{if(policy.mode!=='automatic')throw new Error('Invalid retention mode');const plan=await planRetention({directories,retentionDays:policy.retentionDays}),result=process.argv.includes('--apply')?await applyRetention(plan):{deleted:0};console.log(JSON.stringify({service:'digital-adoption-retention',mode:process.argv.includes('--apply')?'apply':'plan',retentionDays:plan.retentionDays,eligible:plan.candidates.length,...result}));}}catch{console.error('Checkpoint retention failed safely; review the policy, directory access and a fresh plan.');process.exitCode=1;}
}
