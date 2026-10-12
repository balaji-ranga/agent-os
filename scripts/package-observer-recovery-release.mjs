// Immutable feature delta: overlay only reviewed files, preserve parallel releases.
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const [base,feature,revision]=process.argv.slice(2);
if(!base||!feature||!revision||!/^[-\w]+$/.test(revision))throw new Error('Usage: node scripts/package-observer-recovery-release.mjs BASE FEATURE REVISION');
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024});
const out=join(root,'.codex-tmp',`observer-${revision}`);
if(existsSync(out))throw new Error('Package already exists');
mkdirSync(out,{recursive:true});
const changes=git('diff','--name-status',base,feature).toString().trim().split('\n').map(s=>s.split('\t'));
if(changes.some(([kind])=>!['A','M'].includes(kind)))throw new Error('Only additive/modifying feature paths supported');
const modified=changes.filter(([k])=>k==='M').map(([,p])=>p),added=changes.filter(([k])=>k==='A').map(([,p])=>p);
writeFileSync(join(out,'feature.patch'),git('diff','--binary',base,feature));
for(const p of modified){const dest=join(out,'base',p);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,git('show',`${base}:${p}`));}
for(const p of [...modified,...added]){const dest=join(out,'files',p);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,git('show',`${feature}:${p}`));}
// Release plumbing is explicit; never sweep unrelated working-tree files into a package.
for(const p of ['backend/scripts/vps-test-observer-recovery-live.mjs','scripts/package-observer-recovery-release.mjs','deploy/scripts/vps-observer-recovery-release.py']){
 if(modified.includes(p)||added.includes(p))continue;
 const dest=join(out,'files',p);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(root,p),dest);added.push(p);
}
// Keep release documentation current, with an explicit base for three-way reconciliation.
for(const p of ['docs/KANBAN-OBSERVER-RECOVERY.md','deploy/README.md']){
 if(!modified.includes(p)&&!added.includes(p)){
  const previous=join(out,'base',p);mkdirSync(dirname(previous),{recursive:true});writeFileSync(previous,git('show',`${base}:${p}`));modified.push(p);
 }
 const dest=join(out,'files',p);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(root,p),dest);
}
writeFileSync(join(out,'manifest.json'),JSON.stringify({base,feature,mergedMain:git('rev-parse','HEAD').toString().trim(),revision,modified,added},null,2));
copyFileSync(join(root,'deploy/scripts/vps-observer-recovery-release.py'),join(out,'vps-observer-recovery-release.py'));
execFileSync('tar',['-czf',`${out}.tgz`,'-C',out,'.'],{stdio:'inherit'});
console.log(`${out}.tgz (${modified.length+added.length} reviewed feature/release paths)`);
