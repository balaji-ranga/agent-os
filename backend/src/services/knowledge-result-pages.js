import { randomUUID } from 'node:crypto';
import { fingerprint } from './knowledge-contract.js';

// Bounded, short-lived read snapshots. No LLM calls when switching pages.
export function knowledgeResultPages({maxEntries=20,ttl=300000,clock=Date.now}={}){
  const cache=new Map();
  const signature=sources=>fingerprint(sources.map(s=>[s.id,s.revision,s.enabled,s.status,s.connection_ref]).sort((a,b)=>a[0].localeCompare(b[0])));
  const page=(result,kind,offset=0,limit=25)=>{
    if(!['evidence','relationships','citations'].includes(kind)||!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)throw Object.assign(new Error('Invalid result page'),{status:400});
    const items=result[kind]||[];
    return {items:items.slice(offset,offset+limit),offset,total:items.length,next:offset+limit<items.length?offset+limit:null};
  };
  return {
    create(owner,result,sources){
      for(const [id,entry] of cache)if(entry.expires<=clock())cache.delete(id);
      while(cache.size>=maxEntries)cache.delete(cache.keys().next().value);
      const {chunks,...bounded}=result;
      if(Buffer.byteLength(JSON.stringify(bounded))>1000000)throw new Error('Result too large; narrow source scope');
      const ids=new Set(result.sources.map(s=>s.id));const scoped=sources.filter(s=>ids.has(s.id));
      if(scoped.length!==ids.size||(result.evidence||[]).some(record=>record.source&&!scoped.some(s=>s.id===record.source&&s.revision===record.revision&&s.enabled&&['ready','syncing'].includes(s.status))))throw Object.assign(new Error('Knowledge changed while answering; search again'),{status:409});
      const token=randomUUID();cache.set(token,{owner,result:bounded,sourceIds:[...ids],signature:signature(scoped),expires:clock()+ttl});
      const pages=Object.fromEntries(['evidence','relationships','citations'].map(kind=>[kind,page(bounded,kind)]));
      const metadata=Object.fromEntries(Object.entries(pages).map(([kind,{items,...info}])=>[kind,info]));
      return {...bounded,evidence:pages.evidence.items,relationships:pages.relationships.items,citations:pages.citations.items,page_token:token,page_info:metadata};
    },
    async read(owner,{token,kind,offset=0,limit=25},getSource,assertAccess){
      const entry=cache.get(token);
      if(!entry||entry.owner!==owner||entry.expires<=clock())throw Object.assign(new Error('Search expired; run the question again'),{status:410});
      const sources=entry.sourceIds.map(id=>getSource(owner,id));
      if(sources.some(s=>!s)||signature(sources)!==entry.signature){cache.delete(token);throw Object.assign(new Error('Knowledge changed; run the question again'),{status:409});}
      for(const source of sources)await assertAccess(owner,source);
      return page(entry.result,kind,Number(offset),Number(limit));
    },
  };
}
export const knowledgePages=knowledgeResultPages();
