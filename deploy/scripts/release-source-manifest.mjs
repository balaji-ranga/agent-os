// Build from a committed source snapshot; omit credentials and local artifacts.
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'../..');
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024}).toString().trim();
if(git('status','--porcelain','--untracked-files=no'))throw new Error('Commit reviewed source changes before packaging a release.');
const revision=git('rev-parse','HEAD');
const entries=git('ls-tree','-rz','HEAD').split('\0').filter(Boolean).map(row=>{
  const tab=row.indexOf('\t'),[mode,type,git_blob]=row.slice(0,tab).split(' ');
  return {path:row.slice(tab+1),mode,type,git_blob};
}).filter(e=>e.type==='blob'&&!/(^|\/)(?:\.env(?:\.(?!example$)[^/]*)?|\.git|node_modules)(\/|$)/.test(e.path));
const sha256=createHash('sha256').update(JSON.stringify(entries)).digest('hex');
const output=process.argv[2];if(!output)throw new Error('Usage: node deploy/scripts/release-source-manifest.mjs OUTPUT.json');
writeFileSync(resolve(output),JSON.stringify({revision,sha256,files:entries},null,2));
console.log(JSON.stringify({revision,sha256,files:entries.length}));
