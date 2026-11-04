import {mkdirSync,readdirSync,statSync,existsSync,writeFileSync,readFileSync,unlinkSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';import {fault} from './contracts.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function createPhysicalEvidenceStore(root,{maxOwnerBytes=64*1024*1024}={}){
 const base=resolve(root);
 return {put(owner,operationId,attachments){
   if(!Array.isArray(attachments)||attachments.length>1)throw fault('One visual attachment per operation is supported');
   const dir=join(base,hash(owner));mkdirSync(dir,{recursive:true,mode:0o700});
   let total=readdirSync(dir).reduce((n,f)=>n+statSync(join(dir,f)).size,0);
   return attachments.map(a=>{
    if(!['image/png','image/jpeg'].includes(a.mimeType)||!['camera_snapshot','device_screenshot','simulator_snapshot'].includes(a.kind)||typeof a.data!=='string'||a.data.length>350000||!Number.isFinite(a.at)||Math.abs(a.at-Date.now())>60000)throw fault('Invalid visual evidence');
    if(!/^[A-Za-z0-9+/]*={0,2}$/.test(a.data))throw fault('Invalid evidence encoding');
    const bytes=Buffer.from(a.data,'base64');if(bytes.length<16||bytes.length>256*1024)throw fault('Evidence image exceeds permitted size');
    if(a.mimeType==='image/png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw fault('Invalid PNG evidence');
    if(a.mimeType==='image/jpeg'&&!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255))throw fault('Invalid JPEG evidence');
    const digest=hash(bytes),file=hash(operationId)+'-'+digest+(a.mimeType==='image/png'?'.png':'.jpg'),path=join(dir,file);
    if(!existsSync(path)){if(total+bytes.length>maxOwnerBytes)throw fault('Visual evidence storage limit reached',409);writeFileSync(path,bytes,{flag:'wx',mode:0o600});total+=bytes.length;}
    return {kind:a.kind,mimeType:a.mimeType,bytes:bytes.length,sha256:digest,at:a.at,file};
   });
  },remove(owner,attachment){
   if(!/^[a-f0-9]{64}-[a-f0-9]{64}\.(png|jpg)$/.test(attachment?.file||''))throw fault('Invalid evidence path');
   const file=join(base,hash(owner),attachment.file);
   try{if(lstatSync(file).isSymbolicLink())throw fault('Evidence symlink refused');unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  },get(owner,attachment){
   if(!/^[a-f0-9]{64}-[a-f0-9]{64}\.(png|jpg)$/.test(attachment?.file||''))throw fault('Evidence not found',404);
   const file=join(base,hash(owner),attachment.file);if(!existsSync(file))throw fault('Evidence not found',404);
   const bytes=readFileSync(file);if(hash(bytes)!==attachment.sha256)throw fault('Evidence integrity check failed',409);return bytes;
  }};
}
