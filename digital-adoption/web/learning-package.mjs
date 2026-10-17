export async function recordedPackage({title,steps,origin}){
 if(typeof title!=='string'||!title.trim()||title.length>120||!Array.isArray(steps)||!steps.length||steps.length>24)throw new Error('Name and record the workflow first');
 const payload={format:'flolah-learning',schema:1,sdk:1,sourceOrigin:origin,bundle:{schema:1,title,steps}};
 const bytes=new TextEncoder().encode(JSON.stringify(payload)),digest=await crypto.subtle.digest('SHA-256',bytes);
 return {...payload,checksum:[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')};
}
