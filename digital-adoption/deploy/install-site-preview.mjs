import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {withHostPreview} from './nginx-preview.mjs';
const [rootArg,configPath,backupArg,...pages]=process.argv.slice(2),root=resolve(rootArg),backup=resolve(backupArg),config=JSON.parse(readFileSync(configPath,'utf8'));
if(!pages.length||pages.length>30||Object.keys(config).some(key=>!['embeddingId','origin','serviceUrl','installationToken','expiresAt'].includes(key))||new URL(config.origin).origin!==config.origin||config.expiresAt<=Date.now()||typeof config.installationToken!=='string'||! /^dac_install_[A-Za-z0-9_-]{43}$/.test(config.installationToken))throw new Error('Invalid site preview scope');
const script=new URL('site-loader.mjs',config.serviceUrl);script.searchParams.set('config',new URL('/free-tools/adoption-preview.json',config.origin).href);
const marker='<!-- digital-adoption-preview -->',snippet=`${marker}<script type="module" src="${script.href}"></script><!-- /digital-adoption-preview -->`;
mkdirSync(backup,{recursive:true});const changes=[];
for(const page of pages){
 if(!/^[a-zA-Z0-9_/-]+\.html$/.test(page)||page.split('/').includes('..')||page.startsWith('/'))throw new Error('Invalid static page');
 const file=join(root,page),before=readFileSync(file,'utf8');if((before.match(/<\/head>/gi)||[]).length!==1)throw new Error('Expected one head boundary');
 const cleaned=before.replace(/<!-- digital-adoption-preview -->[\s\S]*?<!-- \/digital-adoption-preview -->/g,'');
 const after=cleaned.replace(/<\/head>/i,snippet+'</head>');const saved=join(backup,page.replaceAll('/','_'));if(!existsSync(saved))copyFileSync(file,saved);
 changes.push({file,after,beforeHash:createHash('sha256').update(before).digest('hex')});
}
// Back up all targets before mutation; no unrelated content is replaced.
copyFileSync(configPath,join(root,'free-tools/adoption-preview.json'));
chmodSync(join(root,'free-tools/adoption-preview.json'),0o644); // Publishable installation only; private credentials are rejected above.
for(const change of changes)writeFileSync(change.file,change.after);
if(process.env.ADOPTION_PREVIEW_NGINX_FILE){const file=process.env.ADOPTION_PREVIEW_NGINX_FILE,before=readFileSync(file,'utf8'),after=withHostPreview(before,new URL(config.origin).hostname,snippet);copyFileSync(file,join(backup,'nginx-before-preview.conf'));writeFileSync(file,after);}
console.log(JSON.stringify({pages:changes.map(({file,beforeHash})=>({file,beforeHash})),preview:'explicit tab opt-in only',expiresAt:config.expiresAt}));
