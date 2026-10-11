import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatLocalDateTime } from '../utils/formatDateTime.js';
import KnowledgeRecordPicker from './KnowledgeRecordPicker.jsx';
import KnowledgeRecordBrowser from './KnowledgeRecordBrowser.jsx';
import KnowledgeRelationshipRules, { KnowledgeMappingAdvice } from './KnowledgeRelationshipRules.jsx';
import KnowledgeSearchResults from './KnowledgeSearchResults.jsx';
import KnowledgeJobRecords from './KnowledgeJobRecords.jsx';
import KnowledgeRunSummary from './KnowledgeRunSummary.jsx';
import './KnowledgeSources.css';

const collections={crm:['companies','people','opportunities'],erp:['Customer','Contact','Project','Sales Invoice'],content:['uploaded','generated'],knowledge:['tables','documents'],gmail:['messages'],outlook:['messages']};
const empty={name:'',kind:'content',collections:['uploaded','generated'],graph_enabled:true,enabled:true,interval_seconds:300};
export default function KnowledgeSources() {
  const [sources,setSources]=useState([]),[form,setForm]=useState(empty),[editing,setEditing]=useState(null);
  const [tab,setTab]=useState('sources'),[message,setMessage]=useState(''),[error,setError]=useState(''),[disabled,setDisabled]=useState(false);
  const [jobs,setJobs]=useState(null),[busy,setBusy]=useState(false),[query,setQuery]=useState(''),[result,setResult]=useState(null);
  const [mappings,setMappings]=useState({items:[],next:null}),[mapping,setMapping]=useState({relation:'same_customer',note:''});
  const [summarize,setSummarize]=useState(true);
  async function load(){try{const data=await api.knowledgeSources();setSources(data.sources);setDisabled(false);}catch(e){if(e.status===503)setDisabled(true);else setError(e.message);}}
  useEffect(()=>{load();},[]);
  useEffect(()=>{if(disabled)return;const timer=setInterval(load,15000);return()=>clearInterval(timer);},[disabled]);
  async function act(fn,success){setBusy(true);setError('');setMessage('');try{await fn();setMessage(success);await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
  if(disabled)return <section className="master-data-section knowledge-card knowledge-connected" id="knowledge-connected" aria-label="Connected knowledge"><h2>Connected knowledge</h2><p role="status">Connected Knowledge is disabled on the server. Existing source records have not been deleted. Ask your administrator to restore the Knowledge service configuration.</p><button type="button" onClick={load}>Check again</button></section>;
  return <section className="master-data-section knowledge-card knowledge-connected" id="knowledge-connected" aria-label="Connected knowledge">
    <header className="knowledge-connected-header"><div><p className="knowledge-eyebrow">COMPANY INTELLIGENCE</p><h2>Connected knowledge</h2><p>Bring your business sources together. Find records, explore relationships, and ask for cited answers.</p></div><span className="knowledge-source-count">{sources.length} sources · {sources.filter(s=>s.enabled&&s.status==='ready').length} ready</span></header>
    <nav className="knowledge-connected-tabs" aria-label="Connected knowledge views">{[['sources','Sources'],['documents','Documents & records'],['search','Ask & Search'],['relationships','Relationships']].map(([id,label])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>{setTab(id);setMessage('');setError('');if(id==='relationships')act(async()=>setMappings(await api.knowledgeRelationshipPage('mappings')),'');}}>{label}</button>)}</nav>
    {error&&<p className="knowledge-alert knowledge-alert-error" role="alert">{error}</p>}{message&&<p className="knowledge-alert knowledge-alert-success" role="status">{message}</p>}
    {tab==='sources'&&<>
      <form onSubmit={e=>{e.preventDefault();act(async()=>{await api.knowledgeSourceSave(form,editing);setForm(empty);setEditing(null);},'Source saved. Synchronization will run in the background.');}}>
        <h3>{editing?'Edit source':'Add source'}</h3>
        <label>Name <input required maxLength={160} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
        <label>Connection <select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value,collections:collections[e.target.value]})} disabled={!!editing}><option value="content">Flolah content folder</option><option value="knowledge">Flolah Knowledge tables and documents</option><option value="crm">Configured CRM</option><option value="erp">Configured ERP</option><option value="gmail">Connected Gmail — message bodies</option><option value="outlook">Connected Outlook — message bodies</option></select></label>
        {form.kind==='gmail'&&<label>Gmail search scope <input maxLength={2000} placeholder="label:contracts after:2026/01/01" value={form.query||''} onChange={e=>setForm({...form,query:e.target.value})}/></label>}
        {form.kind==='outlook'&&<label>Outlook folder ID (optional) <input maxLength={500} value={form.folder_id||''} onChange={e=>setForm({...form,folder_id:e.target.value})}/></label>}
        {['gmail','outlook'].includes(form.kind)&&<p>Uses your existing authorized connector. Indexes message bodies only; attachments are not indexed by this adapter yet.</p>}
        <fieldset><legend>Content to index</legend>{collections[form.kind].map(c=><label key={c}><input type="checkbox" checked={form.collections.includes(c)} onChange={e=>setForm({...form,collections:e.target.checked?[...form.collections,c]:form.collections.filter(v=>v!==c)})}/>{c} </label>)}</fieldset>
        <label>Sync interval (seconds) <input type="number" min={60} max={86400} value={form.interval_seconds} onChange={e=>setForm({...form,interval_seconds:Number(e.target.value)})}/></label>
        <label><input type="checkbox" checked={form.graph_enabled} onChange={e=>setForm({...form,graph_enabled:e.target.checked})}/>Connect related information</label>
        {form.graph_enabled&&<label><input type="checkbox" checked={!!form.intelligent_mapping} onChange={e=>setForm({...form,intelligent_mapping:e.target.checked})}/>Enable intelligent mapping advice after synchronization</label>}
        {form.graph_enabled&&<p>Field rules match stable identifiers automatically. Optional intelligent advice sends bounded indexed excerpts to your configured model and queues suggestions for human approval in Relationships; it never changes source data.</p>}
        <label><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/>Enabled</label>
        <button disabled={busy||!form.collections.length}>{busy?'Working…':'Save source'}</button>
        {editing&&<button type="button" onClick={()=>{setEditing(null);setForm(empty);}}>Cancel edit</button>}
      </form>
      <KnowledgeRelationshipRules sources={sources}/>
      {!sources.length&&<p className="knowledge-connected-empty">No connected sources yet. Add one above to start background indexing. Your original records are not changed.</p>}
      {sources.map(s=><article key={s.id}><h3>{s.name}</h3><p>{s.enabled?s.status:'Paused'} · Last success: {s.last_success?formatLocalDateTime(s.last_success):'Not yet synchronized'}</p>{s.error&&<p role="alert">{s.error}</p>}<small>Source ID: {s.id}</small><p>
        <button disabled={busy||!s.enabled||s.status==='syncing'} onClick={()=>act(()=>api.knowledgeSourceSync(s.id),'Synchronization queued.')}>Sync now</button>
        <button disabled={busy||s.status==='syncing'} onClick={()=>{setForm(s);setEditing(s.id);}}>Edit</button>
        <button disabled={busy} onClick={()=>act(()=>api.knowledgeSourceEnabled(s.id,!s.enabled),s.enabled?'Source paused and excluded from search.':'Source resumed; synchronization scheduled.')}>{s.enabled?'Pause':'Resume'}</button>
        <button disabled={busy} onClick={()=>{if(window.confirm(`Remove ${s.name} from Knowledge? Original source records are not deleted.`))act(()=>api.knowledgeSourceDelete(s.id),'Source removed from search. Indexed-copy cleanup is queued; original records are unchanged.');}}>Remove source</button>
        <button disabled={busy} onClick={()=>act(async()=>setJobs({id:s.id,name:s.name,...await api.knowledgeSourceHistory(s.id)}),'History loaded.')}>History</button>
      </p></article>)}
      {sources.filter(s=>s.retry&&s.enabled).map(s=><p key={`retry-${s.id}`} role="status">{s.name}: {s.retry.failures} failed attempt(s). Next automatic retry: {formatLocalDateTime(s.retry.retry_at)}. Use Sync now to retry immediately.</p>)}
      {jobs&&<aside aria-label="Source history"><h3>{jobs.name}: history</h3><button onClick={()=>setJobs(null)}>Close history</button>{jobs.jobs.map(j=><div key={j.id}><KnowledgeRunSummary job={j}/><KnowledgeJobRecords job={j}/></div>)}<button disabled={busy} onClick={()=>act(async()=>setJobs({...jobs,...await api.knowledgeSourceHistory(jobs.id)}),'History loaded.')}>First page</button> <button disabled={busy||!jobs.next} onClick={()=>act(async()=>setJobs({...jobs,...await api.knowledgeSourceHistory(jobs.id,jobs.next)}),'History loaded.')}>Next 25 jobs</button></aside>}
    </>}
    {tab==='documents'&&<KnowledgeRecordBrowser sources={sources}/>}
    {tab==='search'&&<><form onSubmit={e=>{e.preventDefault();setResult(null);act(async()=>setResult(await api.knowledgeConnectedSearch({query,summarize,paginate:true})),'Evidence retrieved.');}}><label>Question <textarea required value={query} onChange={e=>setQuery(e.target.value)} maxLength={4000}/></label><label><input type="checkbox" checked={summarize} onChange={e=>setSummarize(e.target.checked)}/>Generate a cited answer</label><button disabled={busy}>{busy?'Searching…':'Find connected information'}</button></form>
      {result&&<KnowledgeSearchResults key={result.page_token||query} result={result}/>}
    </>}
    {tab==='relationships'&&<><KnowledgeMappingAdvice sources={sources}/><div className="knowledge-connected-hint"><strong>Manual relationship exception</strong><p>Search each source, select the records, then describe the relationship and its evidence. Use source field rules for repeatable matches. IDs are attached automatically; similar names alone never create a link.</p></div><form className="knowledge-relationship-form" onSubmit={e=>{e.preventDefault();act(async()=>{await api.knowledgeMappingSave(mapping);setMappings(await api.knowledgeRelationshipPage('mappings'));},'Relationship saved.');}}>
      {['from','to'].map(side=><fieldset key={side}><legend>{side==='from'?'From record':'To record'}</legend><label>Source <select disabled={busy} required value={mapping[`${side}_source`]||''} onChange={e=>setMapping({...mapping,[`${side}_source`]:e.target.value,[`${side}_object`]:''})}><option value="">Select source</option>{sources.filter(s=>s.graph_enabled).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><KnowledgeRecordPicker key={mapping[`${side}_source`]||side} sourceId={mapping[`${side}_source`]} value={mapping[`${side}_object`]} disabled={busy} onChange={value=>setMapping(old=>({...old,[`${side}_object`]:value}))}/></fieldset>)}
      <label>Relationship <input required pattern="[a-z][a-z0-9_]{0,63}" title="Use lowercase letters, numbers and underscores, e.g. contract_for" value={mapping.relation} onChange={e=>setMapping({...mapping,relation:e.target.value})}/><small>For example: same_customer, contract_for, account_register</small></label><label>Supporting evidence <textarea required maxLength={2000} placeholder="Why do these records belong together? Reference a contract, account ID or verified source." value={mapping.note} onChange={e=>setMapping({...mapping,note:e.target.value})}/></label><button disabled={busy||!mapping.from_object||!mapping.to_object}>Save relationship</button>
    </form>{mappings.items.map(m=><p key={m.id}>{m.from_object} → {m.relation} → {m.to_object}<br/><small>{m.note}</small></p>)}<p><button disabled={busy} onClick={()=>act(async()=>setMappings(await api.knowledgeRelationshipPage('mappings')),'First page loaded.')}>First page</button> <button disabled={busy||!mappings.next} onClick={()=>act(async()=>setMappings(await api.knowledgeRelationshipPage('mappings',mappings.next)),'Next page loaded.')}>Next 25 relationships</button></p></>}
  </section>;
}
