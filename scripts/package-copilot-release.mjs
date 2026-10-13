import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
const root=resolve(import.meta.dirname,'..'),[base,revision]=process.argv.slice(2);
if(!base||!revision||!/^[-\w]+$/.test(revision))throw Error('Usage: BASE REVISION');
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024});
const changes=git('diff','--name-status',base,'HEAD').toString().trim().split('\n').map(s=>s.split('\t'));
if(changes.some(([type,path])=>!['A','M'].includes(type)||path.includes('IMPLEMENTATION-STATUS')||/\.env|\.pem/.test(path)))throw Error('Unapproved release paths');
const out=join(root,'.codex-tmp',`copilot-${revision}`);if(existsSync(out))throw Error('Release exists');mkdirSync(out,{recursive:true});
for(const [type,path] of changes){
 for(const [folder,ref] of [['files','HEAD'],...(type==='M'?[['base',base]]:[])]){const dest=join(out,folder,path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,git('show',`${ref}:${path}`));}
}
writeFileSync(join(out,'manifest.json'),JSON.stringify({revision,base,commit:git('rev-parse','HEAD').toString().trim(),changes},null,2));
writeFileSync(join(out,'release.py'),git('show','HEAD:deploy/scripts/vps-copilot-release.py'));
execFileSync('tar',['-czf',`${out}.tgz`,'-C',out,'.'],{stdio:'inherit'});console.log(`${out}.tgz`);
