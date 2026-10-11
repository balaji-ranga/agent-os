import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { textFilePassages } from './knowledge-text-stream.js';

const exec=promisify(execFile);
export const isKnowledgeOcrImage=name=>/\.(png|jpe?g|tiff?|bmp|webp)$/i.test(name||'');

// No shell or caller-selected executable. Disk-backed, sequential pages keep
// document buffers outside the request-serving process. Container limits bound
// native extractor memory; each subprocess also has a finite execution budget.
export async function* binaryFilePassages(path,{filename=path,signal,run=exec}={}) {
  const input=resolve(path),dir=await mkdtemp(join(tmpdir(),'flolah-extract-'));
  const command=(name,args)=>run(name,args,{signal,timeout:120000,maxBuffer:1024*1024,windowsHide:true,env:{...process.env,OMP_THREAD_LIMIT:'1',LC_ALL:'C'}});
  const emit=async function*(file,fields){for await(const item of textFilePassages(file))yield {...item,...fields};};
  try {
    if(/\.pdf$/i.test(filename)) {
      const info=await command('pdfinfo',[input]);
      const pages=Number(String(info.stdout).match(/^Pages:\s+(\d+)/m)?.[1]);
      if(!Number.isSafeInteger(pages)||pages<1)throw new Error('Cannot determine PDF page count');
      for(let page=1;page<=pages;page++) {
        signal?.throwIfAborted();
        const text=join(dir,'page.txt'),image=join(dir,'page');
        await command('pdftotext',['-f',String(page),'-l',String(page),input,text]);
        // Inspect only a bounded prefix; short/empty pages use OCR.
        const {open}=await import('node:fs/promises');
        const handle=await open(text,'r');let prefix;
        try{const buffer=Buffer.alloc(256);const read=await handle.read(buffer,0,256,0);prefix=buffer.subarray(0,read.bytesRead).toString('utf8');}finally{await handle.close();}
        let method='text';
        if(prefix.trim().length<20) {
          await command('pdftoppm',['-f',String(page),'-l',String(page),'-singlefile','-scale-to','2400','-png',input,image]);
          await command('tesseract',[`${image}.png`,image,'-l','eng']);
          await rm(`${image}.png`,{force:true});method='ocr';
        }
        yield* emit(text,{page,extraction_method:method});
        await rm(text,{force:true});
      }
    } else if(isKnowledgeOcrImage(filename)) {
      const output=join(dir,'image');
      await command('tesseract',[input,output,'-l','eng']);
      yield* emit(`${output}.txt`,{page:1,extraction_method:'ocr'});
    } else {
      const output=join(dir,'office.txt');
      await command(process.execPath,['--max-old-space-size=384',fileURLToPath(new URL('./knowledge-office-extract-child.js',import.meta.url)),input,output]);
      yield* emit(output,{extraction_method:'office'});
    }
  } catch(error) {
    if(error.code==='ENOENT')throw new Error('Knowledge extraction dependency missing; use the knowledge-worker image with Poppler and Tesseract');
    throw error;
  } finally {
    // dir is exclusively created by mkdtemp for this invocation.
    await rm(dir,{recursive:true,force:true});
  }
}
