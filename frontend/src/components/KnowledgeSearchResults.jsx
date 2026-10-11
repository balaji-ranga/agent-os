import { useState } from 'react';
import { api } from '../api';
import { renderChatMarkdown } from '../utils/chatMarkdown.js';

function ResultPage({result,kind,render}){
  const [page,setPage]=useState({items:result[kind]||[],...(result.page_info?.[kind]||{offset:0,total:(result[kind]||[]).length,next:null})});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load(offset){setBusy(true);setError('');try{setPage(await api.knowledgeSearchPage({token:result.page_token,kind,offset,limit:25}));}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section aria-label={`${kind} results`}><h3>{kind[0].toUpperCase()+kind.slice(1)} ({page.total})</h3>{error&&<p role="alert">{error}</p>}{page.items.map(render)}
    {result.page_token&&page.total>25&&<p><button disabled={busy||page.offset===0} onClick={()=>load(Math.max(0,page.offset-25))}>Previous</button> <span>{page.offset+1}–{Math.min(page.offset+25,page.total)} of {page.total}</span> <button disabled={busy||page.next===null} onClick={()=>load(page.next)}>Next</button></p>}
  </section>;
}
export default function KnowledgeSearchResults({result}){
  return <>{result.answer&&<article aria-label="Knowledge answer"><h3>Answer</h3><div className="chat-message-md">{renderChatMarkdown(result.answer)}</div></article>}<p>{result.note}</p>
    <ResultPage result={result} kind="citations" render={c=><details key={c.id}><summary>[{c.id}] {c.title}</summary><p>{c.text}</p><small>{c.object_id} · Revision {c.revision}</small></details>}/>
    <ResultPage result={result} kind="evidence" render={e=><details key={e.entity}><summary>{e.title} — {e.object_id}</summary><p style={{whiteSpace:'pre-wrap'}}>{e.text}</p><small>Source: {e.source} · Revision: {e.revision}</small></details>}/>
    <ResultPage result={result} kind="relationships" render={(e,i)=><details key={`${e.from}:${e.to}:${e.relation}:${i}`}><summary>{e.relation}</summary><small>{e.from} → {e.to}</small><p>{e.evidence?.note}</p><small>{e.evidence?.origin||'Source relationship'}</small></details>}/>
  </>;
}
