// Package only this feature's working-tree delta; never replace newer VPS trees wholesale.
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,copyFileSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.codex-tmp/multi-format-release');
mkdirSync(out,{recursive:true});
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024});
const modified=git('diff','--name-only','HEAD').toString().trim().split('\n').filter(Boolean);
const added=git('ls-files','--others','--exclude-standard').toString().trim().split('\n').filter(Boolean);
const paths=[...modified,...added].filter(p=>!p.endsWith('.pyc')&&!p.includes('__pycache__'));
writeFileSync(join(out,'tracked.patch'),git('diff','--binary','HEAD','--',...modified));
for(const p of modified){const dest=join(out,'base',p);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,git('show',`HEAD:${p}`));}
writeFileSync(join(out,'manifest.json'),JSON.stringify({base:git('rev-parse','HEAD').toString().trim(),modified,added:paths.filter(p=>added.includes(p))},null,2));
for(const p of paths){const dest=join(out,'files',p);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(root,p),dest);}
execFileSync('tar',['-czf',join(root,'.codex-tmp/multi-format-release.tgz'),'-C',out,'.'],{stdio:'inherit'});
console.log(`Packaged ${paths.length} feature files; tracked changes require apply-check on VPS.`);
