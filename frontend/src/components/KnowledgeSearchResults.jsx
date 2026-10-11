import { useState } from 'react';
import KnowledgeFeedback from './KnowledgeFeedback.jsx';
import { api } from '../api';
import { renderChatMarkdown } from '../utils/chatMarkdown.js';
import {formatLocalDateTime} from '../utils/formatDateTime.js';

const human=value=>String(value||'Related to').replaceAll('_',' ');
function RecordSummary({record}){
  return <div className="knowledge-evidence-record"><strong>{record?.title||'Related record'}</strong><small>{record?.source_name||record?.source_kind||'Knowledge source'}{record?.source_kind?` · ${record.source_kind.toUpperCase()}`:''}</small>{record?.preview&&<p>{record.preview}</p>}</div>;
}
function BusinessFields({fields={},displayFields}){
  const entries=displayFields?displayFields.map(f=>[f.label,f.value]):Object.entries(fields).filter(([key,value])=>value!==null&&value!==''&&['string','number','boolean'].includes(typeof value)&&!/(^id$|_id$|token|secret|password)/i.test(key)).slice(0,12);
  return entries.length?<dl className="knowledge-evidence-fields">{entries.map(([key,value])=><div key={key}><dt>{human(key)}</dt><dd>{String(value).slice(0,400)}</dd></div>)}</dl>:null;
}

function ResultPage({result,kind,render}){
  const [page,setPage]=useState({items:result[kind]||[],...(result.page_info?.[kind]||{offset:0,total:(result[kind]||[]).length,next:null})});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load(offset){setBusy(true);setError('');try{setPage(await api.knowledgeSearchPage({token:result.page_token,kind,offset,limit:25}));}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section aria-label={`${kind} results`}><h3>{kind[0].toUpperCase()+kind.slice(1)} ({page.total})</h3>{error&&<p role="alert">{error}</p>}{page.items.map(render)}
    {result.page_token&&page.total>25&&<p><button disabled={busy||page.offset===0} onClick={()=>load(Math.max(0,page.offset-25))}>Previous</button> <span>{page.offset+1}–{Math.min(page.offset+25,page.total)} of {page.total}</span> <button disabled={busy||page.next===null} onClick={()=>load(page.next)}>Next</button></p>}
  </section>;
}
export default function KnowledgeSearchResults({result}){
  return <><KnowledgeFeedback query={result.query}/>{result.answer&&<article aria-label="Knowledge answer"><h3>Answer</h3><div className="chat-message-md">{renderChatMarkdown(result.answer)}</div></article>}<p>{result.note}</p>
    {result.live_checks?.length>0&&<details><summary>Live source checks ({result.live_checks.length})</summary>{result.live_checks.map((c,i)=><p key={i}>{c.operation||'Invoice verification'} · {c.status} · {formatLocalDateTime(c.checked_at,{second:'2-digit'})}</p>)}</details>}
    <ResultPage result={result} kind="citations" render={c=><details key={c.id}><summary>[{c.id}] {c.title}</summary><p>{c.text}</p><small>{c.object_id} · Revision {c.revision}</small></details>}/>
    <ResultPage result={result} kind="evidence" render={e=><article className="knowledge-evidence-card" key={e.entity}><RecordSummary record={{...e,preview:e.preview||e.text?.slice(0,320)}}/><p><small>{e.value_origin==='live'?'Verified live':'Indexed snapshot'}{(e.live_checked_at||e.modified_at)&&` · ${formatLocalDateTime(e.live_checked_at||e.modified_at,{second:'2-digit'})}`}</small></p><BusinessFields fields={e.fields} displayFields={e.display_fields}/><details><summary>Read evidence</summary><p style={{whiteSpace:'pre-wrap'}}>{e.text||'No text excerpt available for this record.'}</p>{e.text_truncated&&<small>Excerpt shortened for this search.</small>}</details><details><summary>Technical details</summary><small>Record: {e.object_id} · Source: {e.source} · Revision: {e.revision}</small></details></article>}/>
    <ResultPage result={result} kind="relationships" render={(e,i)=><article className="knowledge-evidence-card" key={`${e.from}:${e.to}:${e.relation}:${i}`}><div className="knowledge-relationship-endpoints"><RecordSummary record={e.from_record}/><strong className="knowledge-relationship-label">→ {human(e.relation)} →</strong><RecordSummary record={e.to_record}/></div><p>{e.evidence?.note||'Linked by a reference in the indexed source record.'}</p><small>{human(e.evidence?.origin||'source relationship')}{Number.isFinite(e.evidence?.confidence)?` · ${Math.round(e.evidence.confidence*100)}% model-estimated confidence`:''}{e.evidence?.review_status?` · ${e.evidence.review_status==='approved'?'Human confirmed':'Automatically established; not human verified'}`:''}</small>{(e.evidence?.from_quote||e.evidence?.to_quote)&&<details><summary>Supporting evidence</summary><blockquote>{e.evidence.from_quote}</blockquote><blockquote>{e.evidence.to_quote}</blockquote></details>}<details><summary>Technical details</summary><small>{e.from} → {e.to}</small>{e.evidence?.model&&<p>Model: {e.evidence.model}</p>}</details></article>}/>
  </>;
}
