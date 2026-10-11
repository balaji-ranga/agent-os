import {useState} from 'react';
import {api} from '../api';
export default function KnowledgeDocumentResults({result}){
 const [page,setPage]=useState({items:result.chunks||[],...(result.page_info||{offset:0,total:result.chunks?.length||0,next:null})});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(offset){setBusy(true);setError('');try{setPage(await api.masterDataRagPage({token:result.page_token,offset}));}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section aria-label="Document evidence pages">{error&&<p role="alert">{error}</p>}
 {!page.items.length&&<p>No relevant document excerpts found.</p>}
 {page.items.map((chunk,i)=><details key={`${chunk.document_id}:${chunk.chunk_index}:${i}`}><summary>[{page.offset+i+1}] {chunk.title||chunk.filename||chunk.document_id}</summary><pre style={{whiteSpace:'pre-wrap'}}>{chunk.content}</pre><small>Document: {chunk.document_id} · Chunk: {chunk.chunk_index}</small></details>)}
 {result.page_token&&page.total>5&&<p><button disabled={busy||page.offset===0} onClick={()=>load(Math.max(0,page.offset-5))}>Previous excerpts</button> <span>{page.offset+1}–{Math.min(page.offset+5,page.total)} of {page.total}</span> <button disabled={busy||page.next===null} onClick={()=>load(page.next)}>Next excerpts</button></p>}
 <small>Up to 20 relevance-ranked excerpts per search; pages are fetched from the server. Narrow your question for more specific evidence.</small></section>;
}
