import {randomUUID} from 'node:crypto';
// Owner-bound, bounded relevance snapshots. Paging never reruns the LLM.
export function documentResultPages({clock=Date.now,ttl=300000,maxEntries=20}={}){
 const cache=new Map(),stamp=d=>JSON.stringify([d?.id,d?.updated_at,d?.knowledge_content_revision,d?.knowledge_indexing]);
 const page=(entry,offset=0)=>({items:entry.chunks.slice(offset,offset+5),offset,total:entry.chunks.length,next:offset+5<entry.chunks.length?offset+5:null});
 async function check(owner,entry,getDocument){for(const [id,revision] of entry.revisions){const doc=await getDocument(owner,id);if(!doc||stamp(doc)!==revision)throw Object.assign(new Error('Documents changed; search again'),{status:409});}}
 return {
  async create(owner,result,getDocument){
   const chunks=(result.chunks||[]).slice(0,20);
   if(Buffer.byteLength(JSON.stringify(chunks))>1000000)throw new Error('Search results too large; narrow query');
   const revisions=[];for(const id of new Set(chunks.map(c=>c.document_id))){if(!id)throw new Error('Document reference missing');const doc=await getDocument(owner,id);if(!doc)throw new Error('Document no longer available');revisions.push([id,stamp(doc)]);}
   for(const [key,entry] of cache)if(entry.expires<=clock())cache.delete(key);
   while(cache.size>=maxEntries)cache.delete(cache.keys().next().value);
   const token=randomUUID(),entry={owner,chunks,revisions,expires:clock()+ttl};cache.set(token,entry);
   const first=page(entry);return {...result,chunks:first.items,page_token:token,page_info:{offset:0,total:first.total,next:first.next,limit:5}};
  },
  async read(owner,{token,offset=0},getDocument){
   if(!Number.isInteger(offset)||offset<0||offset%5)throw Object.assign(new Error('Invalid document result page'),{status:400});
   const entry=cache.get(token);if(!entry||entry.owner!==owner||entry.expires<=clock())throw Object.assign(new Error('Search expired; search again'),{status:410});
   await check(owner,entry,getDocument);return page(entry,offset);
  },
 };
}
export const documentPages=documentResultPages();
