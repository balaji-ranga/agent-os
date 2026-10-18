import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import CopilotQualityControls from '../components/CopilotQualityControls.jsx';

export default function AdminDigitalAdoption() {
  const [data,setData]=useState(null),[query,setQuery]=useState(''),[status,setStatus]=useState('all'),[filters,setFilters]=useState({query:'',status:'all',offset:0,limit:25});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0),requestRevision=useRef(0);
  useEffect(()=>{const version=++requestRevision.current;setBusy(true);setError('');api.adminDigitalAdoptionWebsites(filters).then(result=>{if(version===requestRevision.current)setData(result);}).catch(e=>{if(version===requestRevision.current)setError(e.message);}).finally(()=>{if(version===requestRevision.current)setBusy(false);});return()=>{requestRevision.current++;};},[filters,revision]);
  const search=event=>{event.preventDefault();setFilters(previous=>({...previous,query:query.trim(),status,offset:0}));};
  return <div className="page">
    <header className="page-hero"><div><h1>Digital Adoption websites</h1><p>Platform-wide registrations across all website owners. Each website keeps its own knowledge, maps, lessons and visitor permissions.</p></div><button type="button" className="wf-btn" disabled={busy} onClick={()=>setRevision(v=>v+1)}>{busy?'Loading…':'Refresh websites'}</button></header>
    <p><a href="/free-tools/digital-adoption/manage.html" target="_blank" rel="noreferrer">Open registration management</a>{' · '}<Link to="/admin/models">Model routing and review settings</Link></p>
    {data&&<p role="status"><strong>{data.summary.total}</strong> registered websites across <strong>{data.summary.owners}</strong> owners. {data.summary.approved} approved · {data.summary.pending} pending · {data.summary.suspended} suspended · {data.summary.removed} removed.</p>}
    <section className="panel" aria-label="Platform website registrations">
      <form onSubmit={search}><label>Search websites or owner ID <input type="search" value={query} maxLength={200} onChange={e=>setQuery(e.target.value)}/></label>{' '}<label>Registration status <select value={status} onChange={e=>setStatus(e.target.value)}>{['all','pending','approved','suspended','removed'].map(value=><option key={value} value={value}>{value}</option>)}</select></label>{' '}<button type="submit" className="wf-btn" disabled={busy}>Search websites</button></form>
      {error&&<p role="alert">{error}</p>}
      <div style={{overflowX:'auto'}}><table aria-label="All registered Digital Adoption websites"><thead><tr><th>Website / registration</th><th>Owner ID</th><th>Environment / status</th><th>Verified</th><th>Visitor capabilities enabled</th><th>Management</th></tr></thead><tbody>
        {(data?.websites||[]).map(site=><tr key={site.id}><td><strong>{site.origin}</strong>{site.label&&<div>{site.label}</div>}<small>{site.id}</small></td><td><code>{site.ownerId}</code></td><td>{site.environment}<br/>{site.status}</td><td>{site.verified?'Yes':'No'}</td><td>{Object.entries(site.capabilities).filter(([,enabled])=>enabled).map(([name])=>name).join(', ')||'None'}<div><small>{site.installationsIssued} installations issued; this is not an online-visitor count.</small></div></td><td><a href={'/free-tools/digital-adoption/manage.html?website='+encodeURIComponent(site.id)} target="_blank" rel="noreferrer">Manage website</a></td></tr>)}
        {data&&!data.websites.length&&<tr><td colSpan={6}>No registrations match these filters.</td></tr>}
      </tbody></table></div>
      {data&&<div><p>{data.pagination.total} matching registrations · Page {Math.floor(data.pagination.offset/data.pagination.limit)+1} of {Math.max(1,Math.ceil(data.pagination.total/data.pagination.limit))}</p><button type="button" className="wf-btn" disabled={busy||!data.pagination.hasPrevious} onClick={()=>setFilters(f=>({...f,offset:Math.max(0,f.offset-f.limit)}))}>Previous websites</button>{' '}<button type="button" className="wf-btn" disabled={busy||!data.pagination.hasNext} onClick={()=>setFilters(f=>({...f,offset:f.offset+f.limit}))}>Next websites</button></div>}
    </section>
    <CopilotQualityControls/>
  </div>;
}
