import { useEffect, useState } from 'react';
import { api } from '../api';
import KnowledgeRecordPicker from './KnowledgeRecordPicker.jsx';

function FieldSide({side,sources,rule,setRule}){
  const [fields,setFields]=useState([]),[error,setError]=useState('');
  const source=sources.find(s=>s.id===rule[`${side}_source`]),collection=rule[`${side}_collection`];
  useEffect(()=>{let current=true;setFields([]);setError('');if(source&&collection)api.knowledgeFields(source.id,collection).then(r=>{if(current)setFields(r.fields);}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[source?.id,source?.revision,collection]);
  return <fieldset><legend>{side==='from'?'Source field':'Related source field'}</legend>
    <label>Source<select required value={source?.id||''} onChange={e=>setRule(r=>({...r,[`${side}_source`]:e.target.value,[`${side}_collection`]:'',[`${side}_field`]:''}))}><option value="">Choose source</option>{sources.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
    <label>Collection<select required disabled={!source} value={collection||''} onChange={e=>setRule(r=>({...r,[`${side}_collection`]:e.target.value,[`${side}_field`]:''}))}><option value="">Choose collection</option>{source?.collections.map(c=><option key={c}>{c}</option>)}</select></label>
    <label>Identifier field<select required disabled={!fields.length} value={rule[`${side}_field`]||''} onChange={e=>setRule(r=>({...r,[`${side}_field`]:e.target.value}))}><option value="">Choose indexed field</option>{fields.map(f=><option key={f}>{f}</option>)}</select></label>
    {collection&&!fields.length&&<small>{error||'Loading fields, or no indexed fields yet. Synchronize the source if empty.'}</small>}
  </fieldset>;
}
const empty={relation:'same_customer',normalization:'exact',note:'',identifier_confirmed:false,enabled:true};
export default function KnowledgeRelationshipRules({sources}){
  const [rule,setRule]=useState(empty),[page,setPage]=useState({items:[],next:null}),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const available=sources.filter(s=>s.enabled&&s.graph_enabled&&s.revision);
  async function load(after=''){setPage(await api.knowledgeRelationshipPage('rules',after));}
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  async function act(fn,text){setBusy(true);setError('');setMessage('');try{await fn();await load();setMessage(text);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section aria-label="Field relationship rules"><h3>Connect by matching fields</h3><p className="knowledge-connected-hint">Define a rule once for all records. Use stable identifiers shared by both systems—not display names. Duplicate target identifiers remain unresolved. Rules use the current index and do not modify source records.</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <form className="knowledge-relationship-form" onSubmit={e=>{e.preventDefault();act(async()=>{await api.knowledgeFieldRuleSave(rule,rule.id);setRule(empty);},'Field rule saved. It applies to subsequent connected searches.');}}>
      {['from','to'].map(side=><FieldSide key={side} {...{side,sources:available,rule,setRule}}/>)}
      <label>Relationship<input required pattern="[a-z][a-z0-9_]{0,63}" value={rule.relation} onChange={e=>setRule({...rule,relation:e.target.value})}/></label>
      <label>Match mode<select value={rule.normalization} onChange={e=>setRule({...rule,normalization:e.target.value})}><option value="exact">Exact identifier</option><option value="casefold">Ignore letter case</option></select></label>
      <label>Why these fields match<textarea required maxLength={2000} value={rule.note} onChange={e=>setRule({...rule,note:e.target.value})}/></label>
      <label><input type="checkbox" required checked={rule.identifier_confirmed} onChange={e=>setRule({...rule,identifier_confirmed:e.target.checked})}/>These fields are authoritative matching identifiers.</label>
      <button disabled={busy}>Save field rule</button>{rule.id&&<button type="button" onClick={()=>setRule(empty)}>Cancel edit</button>}
    </form>
    {page.items.map(r=><article key={r.id}><strong>{r.from_collection}.{r.from_field} → {r.relation} → {r.to_collection}.{r.to_field}</strong><p>{r.note}</p><small>{r.enabled?'Enabled':'Disabled'} · {r.normalization}</small><p><button disabled={busy} onClick={()=>setRule(r)}>Edit rule</button><button disabled={busy} onClick={()=>act(()=>api.knowledgeFieldRuleSave({...r,enabled:!r.enabled},r.id),'Rule updated.')}>{r.enabled?'Disable':'Enable'}</button><button disabled={busy} onClick={()=>{if(window.confirm('Remove this field rule?'))act(()=>api.knowledgeFieldRuleDelete(r.id),'Rule removed.');}}>Remove</button></p></article>)}
    <p><button disabled={busy} onClick={()=>act(()=>load(),'First page loaded.')}>First page</button> <button disabled={busy||!page.next} onClick={()=>{setBusy(true);load(page.next).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>Next 25 rules</button></p>
  </section>;
}

export function KnowledgeMappingAdvice({sources}){
  const [source,setSource]=useState(''),[record,setRecord]=useState(''),[target,setTarget]=useState(''),[page,setPage]=useState({items:[],next:null}),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const available=sources.filter(s=>s.enabled&&s.graph_enabled&&s.revision);
  async function load(after=''){setPage(await api.knowledgeRelationshipPage('advice',after));}
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  async function act(fn){setBusy(true);setError('');setMessage('');try{const r=await fn();setMessage(r.note||`Suggestion ${r.status||'updated'}.`);await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section aria-label="Intelligent relationship advice"><h3>Intelligent relationships</h3><p className="knowledge-connected-hint">Supported model links are indexed automatically at 75% or higher estimated confidence. Review is optional and does not block processing. Confirm a link, or reject it and use the manual relationship form below to correct its endpoints or relationship type. Original source records are never changed.</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <form onSubmit={e=>{e.preventDefault();act(()=>api.knowledgeMappingAdvice({source_id:source,object_id:record,target_source_id:target||null}));}}>
      <label>Source<select required value={source} onChange={e=>{setSource(e.target.value);setRecord('');}}><option value="">Choose source</option>{available.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <KnowledgeRecordPicker key={source} sourceId={source} value={record} onChange={setRecord} disabled={busy}/>
      <label>Compare with<select value={target} onChange={e=>setTarget(e.target.value)}><option value="">Other connected sources</option>{available.filter(s=>s.id!==source).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <button disabled={busy||!record}>{busy?'Comparing evidence…':'Suggest relationship'}</button>
    </form>
    {page.items.map(s=><article key={s.id}><strong>{s.from_title} → {s.relation.replaceAll('_',' ')} → {s.to_title}</strong><p>{Math.round(s.confidence*100)}% model-estimated confidence · {s.status==='approved'?'Human confirmed':s.status==='active'?'Indexed automatically · optional review':'Not active · low confidence or awaiting generation'}</p><p>{s.reason}</p><blockquote>{s.from_quote}</blockquote><blockquote>{s.to_quote}</blockquote><details><summary>Technical details</summary><small>{s.from_object} → {s.to_object}</small>{s.model&&<p>Model: {s.model}</p>}</details><p><button disabled={busy||s.status==='approved'} onClick={()=>act(()=>api.knowledgeMappingDecision(s.id,'approve'))}>Confirm relationship</button><button disabled={busy} onClick={()=>act(()=>api.knowledgeMappingDecision(s.id,'reject'))}>Reject / remove link</button></p></article>)}
    {!page.items.length&&<p className="knowledge-connected-empty">No current model relationships. Select a record above or enable intelligent mapping on a source.</p>}
    <p><button disabled={busy} onClick={()=>load().catch(e=>setError(e.message))}>Refresh / first page</button> <button disabled={busy||!page.next} onClick={()=>load(page.next).catch(e=>setError(e.message))}>Next 25 suggestions</button></p>
  </section>;
}
