import {deflateSync} from 'node:zlib';
// Deterministic rendered room, not a real camera. No state labels/metadata are embedded.
export function roomCameraSnapshot({on=false,ambiguous=false}={},at=Date.now()){
 const w=640,h=360,pixels=Buffer.alloc(w*h*3);
 const rect=(x,y,width,height,color)=>{for(let yy=Math.max(0,y);yy<Math.min(h,y+height);yy++)for(let xx=Math.max(0,x);xx<Math.min(w,x+width);xx++)pixels.set(color,(yy*w+xx)*3);};
 rect(0,0,w,245,[211,204,191]);rect(0,245,w,115,[145,111,80]);rect(0,240,w,7,[245,240,225]);
 rect(40,36,110,125,[247,244,227]);rect(48,44,94,109,[116,179,213]);rect(92,44,5,109,[246,244,228]);rect(48,96,94,5,[246,244,228]);
 rect(490,65,82,70,[105,68,38]);rect(497,72,68,56,[224,183,109]);rect(510,90,36,27,[82,130,85]);
 rect(240,70,235,139,[22,23,25]);rect(246,76,223,124,on?[37,121,192]:[9,10,13]);
 if(on){rect(246,144,223,56,[43,135,77]);rect(259,154,56,46,[34,98,58]);rect(387,158,82,42,[26,103,55]);rect(410,88,21,21,[255,228,105]);for(let y=0;y<34;y++)rect(300-y,119+y,2*y+30,1,[175,198,211]);rect(247,194,221,6,[215,222,224]);}
 rect(348,208,17,23,[35,35,38]);rect(318,230,78,5,[35,35,38]);rect(219,237,276,15,[88,57,34]);rect(227,252,18,54,[75,48,30]);rect(470,252,18,54,[75,48,30]);
 rect(90,282,435,58,[173,157,126]);rect(73,194,127,85,[85,105,112]);rect(62,218,150,65,[66,89,100]);rect(77,228,119,46,[93,121,132]);rect(62,269,150,16,[57,74,83]);
 rect(555,176,9,101,[60,60,55]);rect(530,155,59,31,[236,216,170]);rect(536,274,46,6,[55,56,50]);
 if(ambiguous){rect(216,52,284,173,[178,174,163]);for(let x=218;x<500;x+=12)rect(x,52,4,173,[157,155,146]);}
 const rows=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++)pixels.copy(rows,y*(w*3+1)+1,y*w*3,(y+1)*w*3);
 const chunk=(kind,data)=>{const body=Buffer.concat([Buffer.from(kind),data]);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const n=Buffer.alloc(4),sum=Buffer.alloc(4);n.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([n,body,sum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;
 return {kind:'simulator_snapshot',mimeType:'image/png',at,data:Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]).toString('base64')};
}
