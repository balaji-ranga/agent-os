export async function recordedPackage({title,steps,origin}){
 if(typeof title!=='string'||!title.trim()||title.length>120||!Array.isArray(steps)||!steps.length||steps.length>24)throw new Error('Name and record the workflow first');
 const payload={format:'flolah-learning',schema:1,sdk:1,sourceOrigin:origin,bundle:{schema:1,title,steps}};
 const bytes=new TextEncoder().encode(JSON.stringify(payload)),digest=await crypto.subtle.digest('SHA-256',bytes);
 return {...payload,checksum:[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')};
}

// Early owner feedback; the server independently repeats all validation.
export async function validateLearningPackage(pack){
 if(!pack||Array.isArray(pack)||typeof pack!=='object'||JSON.stringify(pack).length>24_000||Object.keys(pack).some(key=>!['format','schema','sdk','sourceOrigin','bundle','checksum'].includes(key))||pack.format!=='flolah-learning'||pack.schema!==1||pack.sdk!==1||pack.bundle?.schema!==1)throw new Error('Unsupported learning package format or SDK version. Choose a current exported learning JSON package.');
 try{if(new URL(pack.sourceOrigin).origin!==pack.sourceOrigin)throw new Error();}catch{throw new Error('The learning package has an invalid source website. Export a fresh package.');}
 const {checksum,...payload}=pack,digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))),expected=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 if(checksum!==expected)throw new Error('Learning package checksum does not match. Export a fresh package; use the route and field mapping controls to adapt it.');
 return pack;
}
