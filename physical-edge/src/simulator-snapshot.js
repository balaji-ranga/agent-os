import {deflateSync} from 'node:zlib';
// A synthetic TV state visualization, never a photograph of a physical device.
export function simulatorSnapshot(state,at=Date.now()){
 const w=160,h=90,rows=Buffer.alloc((w*3+1)*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*(w*3+1)+1+x*3,screen=x>10&&x<150&&y>8&&y<75;
  const color=screen?(state.on?[25,125,180]:[12,15,20]):[55,60,65];
  rows.set(color,i);
 }
 const chunk=(kind,data)=>{const type=Buffer.from(kind),body=Buffer.concat([type,data]);let crc=0xffffffff;
  for(const b of body){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,body,sum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;
 const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('tEXt',Buffer.from('Description\0SIMULATED TV state: '+JSON.stringify(state))),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
 return {kind:'simulator_snapshot',mimeType:'image/png',at,data:bytes.toString('base64')};
}
