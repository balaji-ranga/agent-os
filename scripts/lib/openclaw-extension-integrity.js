import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const ids=['agent-os-content-tools','agent-os-bootstrap-watcher'];
const sha=b=>createHash('sha256').update(b).digest('hex');
// Git may export Windows CRLF. Compare executable JS text, not checkout EOLs.
const codeHash=path=>sha(readFileSync(path,'utf8').replace(/\r\n/g,'\n'));
export function verifyExtensionIntegrity(sourceRoot,runtimeRoot=null){
 const records=[];
 for(const id of ids){
  const source=join(sourceRoot,id);
  if(!existsSync(join(source,'index.js')))throw new Error(`Missing shipped extension: ${id}`);
  const walk=(dir,relative='')=>{for(const item of readdirSync(dir,{withFileTypes:true})){
   const path=join(dir,item.name),rel=join(relative,item.name);
   if(item.isDirectory())walk(path,rel);
   else if(item.name.endsWith('.js')){
    const digest=codeHash(path);
    if(runtimeRoot){const active=join(runtimeRoot,id,rel);if(!existsSync(active)||codeHash(active)!==digest)throw new Error(`Extension source/runtime mismatch: ${id}/${rel}`);}
    records.push([`${id}/${rel.replaceAll('\\','/')}`,digest]);
   }
  }};walk(source);
 }
 for(const name of ['index.js','index.ts']){
  const path=join(sourceRoot,'agent-os-content-tools',name);
  if(!existsSync(path))continue;
  const text=readFileSync(path,'utf8');
  if(!text.includes("from './floassist-schemas.js'")||!text.includes('...floassistSchemas'))throw new Error(`FloAssist schemas are not registered in ${name}`);
 }
 const schema=join(sourceRoot,'agent-os-content-tools','floassist-schemas.js');
 if(!existsSync(schema))throw new Error('Missing FloAssist tool schema module');
 records.sort((a,b)=>a[0].localeCompare(b[0]));
 return {files:records.length,sha256:sha(JSON.stringify(records)),runtime_verified:!!runtimeRoot};
}
