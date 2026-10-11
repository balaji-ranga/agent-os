import {useEffect,useState} from 'react';
import {api} from '../api';
import {formatLocalDateTime} from '../utils/formatDateTime.js';

const number=value=>value==null?'Not recorded':Number(value).toLocaleString();
const date=value=>value?formatLocalDateTime(value):'—';
export default function KnowledgeEfficiency({range}){
  const [section,setSection]=useState('sources'),[page,setPage]=useState(0),[source,setSource]=useState(''),[sourceName,setSourceName]=useState(''),[agent,setAgent]=useState('');
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
  useEffect(()=>{setPage(0);},[range,section,source,agent]);
  useEffect(()=>{
    let cancelled=false;setLoading(true);setError('');setData(null);
    api.knowledgeEfficiency({days:range,section,page,source,agent}).then(r=>{if(!cancelled)setData(r);}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[range,section,page,source,agent,refresh]);
  const cards=data?[
    ['Sources',data.health.total],['Paused sources',data.health.paused],['Failed sync runs',data.sync.failed],['Pending jobs',data.pending.count],
    ['Published indexed records',data.index?.available?data.index.records:null],['Indexed chunks',data.index?.available?data.index.chunks:null],
    ['Agent RAG calls',data.usage.rag_calls],['Agent Graph RAG calls',data.usage.graph_calls],['Evidence retrieved¹',data.usage.retrieved],['Empty retrievals',data.usage.empty],['Access denials',data.usage.denied],['Retrieval errors',data.usage.errors]
  ]:[];
  return <section className="ai-snip-card" aria-label="Knowledge efficiency">
    <div className="ai-snip-card-head"><h2>Knowledge health & usage</h2><button type="button" className="ai-snip-pill" disabled={loading} onClick={()=>setRefresh(x=>x+1)}>Refresh metrics</button></div>
    <p className="ai-snip-note">Company-scoped monitoring · current index inventory and sync state; activity follows the selected date range.</p>
    <div className="ai-snip-pills">
      {['sources','runs','agents'].map(value=><button type="button" key={value} className={`ai-snip-pill${section===value?' active':''}`} aria-pressed={section===value} onClick={()=>setSection(value)}>{{sources:'Sources & gaps',runs:'Sync history',agents:'Agent usage'}[value]}</button>)}
      {source&&<button className="ai-snip-pill" onClick={()=>{setSource('');setSourceName('');}}>Clear source: {sourceName}</button>}
      {agent&&<button className="ai-snip-pill" onClick={()=>setAgent('')}>Clear agent: {agent}</button>}
      <a className="ai-snip-pill" href="/master-data#knowledge-connected">Manage Knowledge sources</a>
    </div>
    {loading&&<p role="status" className="ai-snip-loading">Loading Knowledge metrics…</p>}
    {error&&<p role="alert" className="ai-snip-error">{error}</p>}
    {data&&<>
      <div className="eff-metrics">{cards.map(([label,value])=><div className="ai-snip-metric" key={label}><div className="ai-snip-metric-value">{number(value)}</div><div className="ai-snip-metric-label">{label}</div></div>)}</div>
      <p className="ai-snip-note">Checked: {number(data.sync.checked)} · Changed/reindexed: {number(data.sync.changed)} · Unchanged/reused: {number(data.sync.reused)} · Deleted: {number(data.sync.deleted)} · Average completed run: {data.sync.seconds==null?'Not recorded':`${Math.max(0,data.sync.seconds).toFixed(1)}s`} · Average retrieval: {data.usage.latency_ms==null?'Not recorded':`${data.usage.latency_ms.toFixed(0)}ms`}</p>
      <p className="ai-snip-note">Published indexed relationships: {data.index?.available?number(data.index.relationships):'Unavailable'} · Relationships returned by agents: {number(data.usage.relationships)} · Coverage gap: unknown (provider total not recorded). {data.sync.unmeasured_runs>0&&`${data.sync.unmeasured_runs} retained runs lack change counters.`}</p>
      <p className="ai-snip-note">Worker heartbeat: {data.health.worker} · Retrieval p95: {data.usage.p95_ms==null?'Not recorded':`${data.usage.p95_ms}ms`} · Oldest pending start: {date(data.pending.oldest)}</p>
      {!data.index?.available&&<p role="status">Index inventory is unavailable. Sync and retrieval metrics remain available.</p>}
      <div style={{overflowX:'auto'}} tabIndex={0} role="region" aria-label={`${section} metrics table`}>
        <table className="eff-table"><thead><tr>{(section==='sources'?['Source','State','Last success / next run','Retry / exclusions','Actions']:section==='runs'?['Source / run','Status / trigger','Checked / changed / reused / deleted','Started / duration','Details']:['Agent','RAG / Graph calls','Retrieved evidence','Empty / denied / errors','Average latency']).map(c=><th key={c} scope="col">{c}</th>)}</tr></thead><tbody>
        {data.items.map(row=>section==='sources'?<tr key={row.id}>
          <td>{row.name}<br/><small>{row.kind}</small></td><td>{row.enabled?row.status:'Sync paused'}{row.has_error?' · Last error recorded':''}</td>
          <td>{date(row.last_success)}<br/>{row.enabled?date(row.next_sync):'Paused'}</td>
          <td>{row.retry?`${row.retry.failures} failures · ${date(row.retry.retry_at)}`:'No retry pending'}<br/>{number(row.excluded)} deliberately excluded</td>
          <td><button className="ai-snip-pill" onClick={()=>{setSource(row.id);setSourceName(row.name);setSection('runs');}}>View runs & metrics</button></td>
        </tr>:section==='runs'?<tr key={row.id}>
          <td>{row.source_name||row.source_id}<br/><small>{row.id}</small></td><td>{row.status} · {row.trigger||'Not recorded'}</td><td>{[row.checked,row.changed,row.reused,row.deleted].map(number).join(' / ')}</td><td>{date(row.started_at)}<br/>{row.seconds==null?'In progress / not recorded':`${Math.max(0,row.seconds).toFixed(1)}s`}</td><td>{row.has_error?'Failed — open source history for details':'—'}</td>
        </tr>:<tr key={row.agent}><td><button className="ai-snip-pill" onClick={()=>setAgent(row.agent)}>{row.agent}</button></td><td>{number(row.rag_calls)} / {number(row.graph_calls)}</td><td>{number(row.retrieved)}</td><td>{row.empty} / {row.denied} / {row.errors}</td><td>{Math.round(row.latency_ms)}ms</td></tr>)}
        {!data.items.length&&<tr><td colSpan={5}>No {section==='agents'?'recorded agent retrievals':'matching records'} in this range.</td></tr>}
        </tbody></table>
      </div>
      <div className="ai-snip-pills" aria-label="Knowledge metrics pagination"><button className="ai-snip-pill" disabled={page===0} onClick={()=>setPage(x=>x-1)}>Previous</button><span>Page {page+1} · {number(data.total)} records</span><button className="ai-snip-pill" disabled={data.next==null} onClick={()=>setPage(data.next)}>Next</button></div>
      <p className="ai-snip-note">Updated {date(data.as_of)}. ¹ Evidence counts are deduplicated within each call, not across calls. Document-only calls can include built-in platform help.</p>
      {data.notes.map(note=><p className="ai-snip-note" key={note}>{note}</p>)}
    </>}
  </section>;
}
