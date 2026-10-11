import {useState} from 'react';
import {useKnowledgeRecords} from '../hooks/useKnowledgeRecords.js';
import {formatLocalDateTime} from '../utils/formatDateTime.js';

export default function KnowledgeRecordBrowser({sources}) {
  const [source,setSource]=useState(''),[query,setQuery]=useState('');
  const {records,next,busy,error,loadMore}=useKnowledgeRecords(source,query,false);
  return <div className="knowledge-record-browser">
    <div className="knowledge-form-grid">
      <label>Source<select value={source} onChange={e=>{setSource(e.target.value);setQuery('');}}><option value="">Choose a source</option>{sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Search records<input type="search" disabled={!source} maxLength={200} placeholder="Name, content or exact record ID" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    </div>
    {error&&<p className="knowledge-alert knowledge-alert-error" role="alert">{error}</p>}
    {!source&&<p className="knowledge-connected-empty">Choose an indexed source to explore its records. Original systems remain the source of truth.</p>}
    <div className="knowledge-record-scroll" onScroll={e=>{const el=e.currentTarget;if(el.scrollHeight-el.scrollTop-el.clientHeight<120&&!error)loadMore();}}>
      {records.map(r=><details key={r.entity}><summary><strong>{r.title||r.object_id}</strong><small>{r.object_id}</small></summary><pre>{r.text}</pre><small>Updated {r.modified_at?formatLocalDateTime(r.modified_at):'not provided'} · Revision {r.revision}</small></details>)}
    </div>
    {source&&<div className="knowledge-picker-footer" role="status">{busy?'Loading records…':records.length?`${records.length} records loaded`:query?'No matching records. Try another search.':'No records yet. Check source synchronization.'}
      {next&&<button type="button" disabled={busy} onClick={loadMore}>Load more records</button>}
    </div>}
  </div>;
}
