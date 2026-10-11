import {useState} from 'react';
import {useKnowledgeRecords} from '../hooks/useKnowledgeRecords.js';
import {formatLocalDateTime} from '../utils/formatDateTime.js';
import {api} from '../api';

export default function KnowledgeRecordBrowser({sources}) {
  const [source,setSource]=useState(''),[query,setQuery]=useState('');
  const [selected,setSelected]=useState([]),[refresh,setRefresh]=useState(0),[notice,setNotice]=useState(''),[acting,setActing]=useState(false),[excluded,setExcluded]=useState(null);
  const {records,next,busy,error,loadMore}=useKnowledgeRecords(source,query,false,refresh);
  async function act(action,ids=selected){
    if(action==='exclude'&&!window.confirm(`Remove ${ids.length} indexed copies and exclude them from future sync? Original source records will NOT be deleted. You can restore indexing later.`))return;
    setActing(true);setNotice('');
    try{const result=await api.knowledgeManageRecords({source_id:source,action,object_ids:ids,...(action==='exclude'?{confirm:'INDEX_ONLY'}:{})});setNotice(`${result.processed} indexed records: ${action}. Originals unchanged. ${result.job_id?'Synchronization queued.':'Source remains paused.'}`);setSelected([]);setExcluded(null);setRefresh(n=>n+1);}catch(e){setNotice(e.message);}finally{setActing(false);}
  }
  async function exclusions(after=''){try{const page=await api.knowledgeExclusions(source,after);setExcluded(page);}catch(e){setNotice(e.message);}}
  return <div className="knowledge-record-browser">
    <div className="knowledge-form-grid">
      <label>Source<select value={source} disabled={acting} onChange={e=>{setSource(e.target.value);setQuery('');setSelected([]);setExcluded(null);setNotice('');}}><option value="">Choose a source</option>{sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Search records<input type="search" disabled={!source} maxLength={200} placeholder="Name, content or exact record ID" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    </div>
    {error&&<p className="knowledge-alert knowledge-alert-error" role="alert">{error}</p>}
    {notice&&<p role="status" className="knowledge-alert">{notice}</p>}
    {source&&<div className="knowledge-picker-footer"><button disabled={acting||!records.length} onClick={()=>setSelected(records.slice(0,100).map(r=>r.object_id))}>Select loaded (up to 100)</button><button disabled={acting||!selected.length} onClick={()=>setSelected([])}>Clear selection</button><button disabled={acting||!selected.length} onClick={()=>act('refresh')}>Refresh selected</button><button disabled={acting||!selected.length} onClick={()=>act('exclude')}>Remove indexed copies ({selected.length})</button><button disabled={acting} onClick={()=>exclusions()}>Excluded records</button></div>}
    {excluded&&<section aria-label="Excluded records">{excluded.items.map(r=><p key={r.object_id}>{r.object_id} <button disabled={acting} onClick={()=>act('restore',[r.object_id])}>Restore indexing</button></p>)}{!excluded.items.length&&<p>No excluded records.</p>}{excluded.next&&<button onClick={()=>exclusions(excluded.next)}>Next excluded records</button>}</section>}
    {!source&&<p className="knowledge-connected-empty">Choose an indexed source to explore its records. Original systems remain the source of truth.</p>}
    <div className="knowledge-record-scroll" onScroll={e=>{const el=e.currentTarget;if(el.scrollHeight-el.scrollTop-el.clientHeight<120&&!error)loadMore();}}>
      {records.map(r=><div key={r.entity}><label><input type="checkbox" disabled={acting||(!selected.includes(r.object_id)&&selected.length>=100)} checked={selected.includes(r.object_id)} onChange={e=>setSelected(old=>e.target.checked?[...old,r.object_id]:old.filter(id=>id!==r.object_id))}/>Select {r.title||r.object_id}</label><details><summary><strong>{r.title||r.object_id}</strong><small>{r.object_id}</small></summary><pre style={{whiteSpace:'pre-wrap'}}>{r.text}</pre><dl><dt>Source updated</dt><dd>{r.modified_at?formatLocalDateTime(r.modified_at):'Not provided by source'}</dd><dt>Record version</dt><dd>{r.object_revision||r.revision}</dd><dt>Published sync snapshot</dt><dd>{r.revision}</dd><dt>Processing</dt><dd>{r.object_revision&&r.object_revision!==r.revision?'Reused unchanged from an earlier sync':'Indexed in this sync'}</dd></dl><details><summary>Structured source fields</summary><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(r.fields||{},null,2)}</pre></details><p>Read-only indexed evidence. Older content versions are not retained in this view. Use source History for processing attempts.</p></details></div>)}
    </div>
    {source&&<div className="knowledge-picker-footer" role="status">{busy?'Loading records…':records.length?`${records.length} records loaded`:query?'No matching records. Try another search.':'No records yet. Check source synchronization.'}
      {next&&<button type="button" disabled={busy} onClick={loadMore}>Load more records</button>}
    </div>}
  </div>;
}
