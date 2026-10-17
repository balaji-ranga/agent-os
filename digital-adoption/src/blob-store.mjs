import {mkdir,open,readFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';

// Paths are derived from server-issued IDs; original filenames never select paths.
export function createBlobStore(root){
 const base=resolve(root), valid=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
 const path=(embeddingId,id)=>{
  if(typeof embeddingId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(embeddingId)||!valid(id))throw new Error('Invalid object scope');
  return join(base,createHash('sha256').update(embeddingId).digest('hex'),id);
 };
 return {
  async put(embeddingId,id,bytes){
   const file=path(embeddingId,id);await mkdir(resolve(file,'..'),{recursive:true,mode:0o700});
   const handle=await open(file,'wx',0o600);try{await handle.writeFile(bytes);}catch(error){await rm(file,{force:true});throw error;}finally{await handle.close();}
   return {sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
  },
  read:(embeddingId,id)=>readFile(path(embeddingId,id)),
  remove:(embeddingId,id)=>rm(path(embeddingId,id),{force:true}),
  path,
 };
}
