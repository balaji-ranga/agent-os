import { createReadStream } from 'node:fs';

// Bounded UTF-8 decoding; no array containing the entire file is constructed.
export async function* textFilePassages(path,{size=16000,overlap=200}={}) {
  if(!Number.isInteger(size)||size<1000||size>64000||!Number.isInteger(overlap)||overlap<0||overlap>=size)throw new Error('Invalid passage limits');
  let buffer='',offset=0,index=0,emitted=false;
  for await(const block of createReadStream(path,{encoding:'utf8',highWaterMark:16384})) {
    buffer+=block;
    while(buffer.length>=size) {
      yield {text:buffer.slice(0,size),offset,index:index++};
      buffer=buffer.slice(size-overlap);offset+=size-overlap;emitted=true;
    }
  }
  if(buffer.length>(emitted?overlap:0))yield {text:buffer,offset,index};
}
