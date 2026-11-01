import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, openSync, closeSync, unlinkSync, fsyncSync } from 'node:fs';
import { dirname } from 'node:path';

export function replaceJournal(from,to,{rename=renameSync,wait=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}={}){
  const delays=[10,25,50,100,200];
  for(let attempt=0;;attempt++){try{return rename(from,to);}catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=delays.length)throw error;wait(delays[attempt]);}}
}

export class FileStore {
  constructor(path, initial) {
    this.path=path;mkdirSync(dirname(path),{recursive:true,mode:0o700});
    // One process owns a journal. Reclaim only a demonstrably dead owner's lock.
    this.lock=path+'.lock';
    if(existsSync(this.lock)){const pid=Number(readFileSync(this.lock,'utf8'));if(Number.isSafeInteger(pid)&&pid>0){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')unlinkSync(this.lock);}}}
    this.fd=openSync(this.lock,'wx',0o600);writeFileSync(this.fd,String(process.pid));
    try{this.state=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):structuredClone(initial);}catch(e){this.close();throw e;}
  }
  load(){return structuredClone(this.state);}
  save(value){const fd=openSync(this.path+'.tmp','w',0o600);try{writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);}finally{closeSync(fd);}replaceJournal(this.path+'.tmp',this.path);this.state=structuredClone(value);}
  close(){if(this.fd!==undefined){closeSync(this.fd);this.fd=undefined;unlinkSync(this.lock);}}
}
