import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatLocalDateTime } from '../utils/formatDateTime.js';

const collections={crm:['companies','people','opportunities'],erp:['Customer','Contact','Project','Sales Invoice'],content:['uploaded','generated']};
const empty={name:'',kind:'content',collections:['uploaded','generated'],graph_enabled:true,enabled:true,interval_seconds:300};
export default function KnowledgeSources() {
  const [sources,setSources]=useState([]),[form,setForm]=useState(empty),[editing,setEditing]=useState(null);
  const [tab,setTab]=useState('sources'),[message,setMessage]=useState(''),[error,setError]=useState(''),[disabled,setDisabled]=useState(false);
  const [jobs,setJobs]=useState(null),[busy,setBusy]=useState(false),[query,setQuery]=useState(''),[result,setResult]=useState(null);
  const [mappings,setMappings]=useState([]),[mapping,setMapping]=useState({relation:'same_customer',note:''});
  async function load(){try{const data=await api.knowledgeSources();setSources(data.sources);setDisabled(false);}catch(e){if(e.status===503)setDisabled(true);else setError(e.message);}}
  useEffect(()=>{load();},[]);
  useEffect(()=>{if(disabled)return;const timer=setInterval(load,15000);return()=>clearInterval(timer);},[disabled]);
  async function act(fn,success){setBusy(true);setError('');setMessage('');try{await fn();setMessage(success);await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
  if(disabled)return null;
  return <section className="master-data-section" id="knowledge-connected" aria-label="Connected knowledge">
    <h2>Connected knowledge</h2>
    <p>Index your connected business records and Flolah content, then explore evidence-backed relationships.</p>
    <nav aria-label="Connected knowledge views">{[['sources','Sources'],['search','Connected information'],['relationships','Relationships']].map(([id,label])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>{setTab(id);if(id==='relationships')act(async()=>setMappings((await api.knowledgeMappings()).mappings),'Relationships loaded.');}}>{label}</button>)}</nav>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {tab==='sources'&&<>
      <form onSubmit={e=>{e.preventDefault();act(async()=>{await api.knowledgeSourceSave(form,editing);setForm(empty);setEditing(null);},'Source saved. Synchronization will run in the background.');}}>
        <h3>{editing?'Edit source':'Add source'}</h3>
        <label>Name <input required maxLength={160} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
        <label>Connection <select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value,collections:collections[e.target.value]})} disabled={!!editing}><option value="content">Flolah content folder</option><option value="crm">Configured CRM</option><option value="erp">Configured ERP</option></select></label>
        <fieldset><legend>Content to index</legend>{collections[form.kind].map(c=><label key={c}><input type="checkbox" checked={form.collections.includes(c)} onChange={e=>setForm({...form,collections:e.target.checked?[...form.collections,c]:form.collections.filter(v=>v!==c)})}/>{c} </label>)}</fieldset>
        <label>Sync interval (seconds) <input type="number" min={60} max={86400} value={form.interval_seconds} onChange={e=>setForm({...form,interval_seconds:Number(e.target.value)})}/></label>
        <label><input type="checkbox" checked={form.graph_enabled} onChange={e=>setForm({...form,graph_enabled:e.target.checked})}/>Connect related information</label>
        <label><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/>Enabled</label>
        <button disabled={busy||!form.collections.length}>{busy?'Working…':'Save source'}</button>
        {editing&&<button type="button" onClick={()=>{setEditing(null);setForm(empty);}}>Cancel edit</button>}
      </form>
      {sources.map(s=><article key={s.id}><h3>{s.name}</h3><p>{s.enabled?s.status:'Paused'} · Last success: {s.last_success?formatLocalDateTime(s.last_success):'Not yet synchronized'}</p>{s.error&&<p role="alert">{s.error}</p>}<small>Source ID: {s.id}</small><p>
        <button disabled={busy||!s.enabled||s.status==='syncing'} onClick={()=>act(()=>api.knowledgeSourceSync(s.id),'Synchronization queued.')}>Sync now</button>
        <button disabled={busy||s.status==='syncing'} onClick={()=>{setForm(s);setEditing(s.id);}}>Edit</button>
        <button disabled={busy} onClick={()=>act(async()=>setJobs({name:s.name,...await api.knowledgeSourceHistory(s.id)}),'History loaded.')}>History</button>
      </p></article>)}
      {jobs&&<aside aria-label="Source history"><h3>{jobs.name}: history</h3><button onClick={()=>setJobs(null)}>Close history</button>{jobs.jobs.map(j=><p key={j.id}>{j.status} · {j.records} records · {j.started_at?formatLocalDateTime(j.started_at):'Queued'} {j.error||''}</p>)}</aside>}
    </>}
    {tab==='search'&&<><form onSubmit={e=>{e.preventDefault();act(async()=>setResult(await api.knowledgeConnectedSearch({query})),'Evidence retrieved.');}}><label>Question <textarea required value={query} onChange={e=>setQuery(e.target.value)} maxLength={4000}/></label><button disabled={busy}>{busy?'Searching…':'Find connected information'}</button></form>
      {result&&<><p>{result.note}</p><p>{result.evidence.length} records · {result.relationships.length} relationships</p>{result.evidence.map(e=><details key={e.entity}><summary>{e.title} — {e.object_id}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{e.text}</pre><small>Source: {e.source} · Revision: {e.revision}</small></details>)}<details><summary>Relationships and evidence</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(result.relationships,null,2)}</pre></details></>}
    </>}
    {tab==='relationships'&&<><p>Use exact source record IDs to connect systems. Matching names alone does not establish a relationship.</p><form onSubmit={e=>{e.preventDefault();act(async()=>{await api.knowledgeMappingSave(mapping);setMappings((await api.knowledgeMappings()).mappings);},'Relationship saved.');}}>
      {['from','to'].map(side=><fieldset key={side}><legend>{side==='from'?'From record':'To record'}</legend><label>Source <select required value={mapping[`${side}_source`]||''} onChange={e=>setMapping({...mapping,[`${side}_source`]:e.target.value})}><option value="">Select source</option>{sources.filter(s=>s.graph_enabled).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Record ID <input required placeholder="Customer/CUST-001" value={mapping[`${side}_object`]||''} onChange={e=>setMapping({...mapping,[`${side}_object`]:e.target.value})}/></label></fieldset>)}
      <label>Relationship <input required value={mapping.relation} onChange={e=>setMapping({...mapping,relation:e.target.value})}/></label><label>Supporting evidence <textarea required value={mapping.note} onChange={e=>setMapping({...mapping,note:e.target.value})}/></label><button disabled={busy}>Save relationship</button>
    </form>{mappings.map(m=><p key={m.id}>{m.from_object} → {m.relation} → {m.to_object}<br/><small>{m.note}</small></p>)}</>}
  </section>;
}
