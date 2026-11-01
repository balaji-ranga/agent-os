const encode=text=>new TextEncoder().encode(text);
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
// Small, uncompressed ZIP for one-time private enrollment files. No dependencies.
export function physicalEnrollmentArchive(hub,cloudUrl,localToken){
 const config={dataDir:'./.local/site-gateway',localTokenFile:'credentials/local-ui.token',hub:{cloudUrl,hubId:hub.hubId,siteId:hub.siteId,tokenFile:'credentials/hub.token'},adapters:{}};
 const files=[['config/gateway.json',JSON.stringify(config,null,2)],['config/credentials/hub.token',hub.token+'\n'],['config/credentials/local-ui.token',localToken+'\n'],['config/credentials/README.txt','Keep this folder private. Windows: restrict access to your account and SYSTEM. Linux: chmod 700 credentials; chmod 600 credentials/*.token. Put an approved Home Assistant token in home-assistant.token and set the HA adapter tokenFile to credentials/home-assistant.token. Restart the edge after rotating a credential. Never commit or upload this private archive.\n']];
 const parts=[],central=[];let offset=0;
 for(const [path,text]of files){const name=encode(path),body=encode(text),crc=crc32(body),header=new Uint8Array(30),h=new DataView(header.buffer);
  h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint32(14,crc,true);h.setUint32(18,body.length,true);h.setUint32(22,body.length,true);h.setUint16(26,name.length,true);
  parts.push(header,name,body);const entry=new Uint8Array(46),c=new DataView(entry.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,crc,true);c.setUint32(20,body.length,true);c.setUint32(24,body.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.push(entry,name);offset+=header.length+name.length+body.length;
 }
 const centralSize=central.reduce((n,p)=>n+p.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
 return new Blob([...parts,...central,end],{type:'application/zip'});
}
