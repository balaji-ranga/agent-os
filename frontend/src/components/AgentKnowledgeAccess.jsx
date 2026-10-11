import { useEffect, useState } from 'react';
import { api } from '../api';

export default function AgentKnowledgeAccess({agentId}) {
  const [sources,setSources]=useState([]),[selected,setSelected]=useState([]),[hidden,setHidden]=useState(false);
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>{
    let disposed=false;setBusy(true);setError('');setMessage('');
    api.knowledgeAgentAccess(agentId).then(result=>{if(!disposed){setSources(result.sources);setSelected(result.source_ids);setHidden(false);}})
      .catch(err=>{if(!disposed){if([403,503].includes(err.status))setHidden(true);else setError(err.message);}})
      .finally(()=>{if(!disposed)setBusy(false);});
    return()=>{disposed=true;};
  },[agentId]);
  if(hidden)return null;
  return <details style={{border:'1px solid var(--border)',borderRadius:8,padding:'1rem',marginBottom:'1rem'}}>
    <summary>Knowledge access</summary>
    <p>Select the sources this employee may retrieve with Master Data — RAG Search, including ordinary document search. Company documents must be indexed in a visible Knowledge source containing documents; source filters and selected fields apply. The employee also needs the tool grant. Built-in Flolah Help remains separate. Direct table tools are unchanged. Changes apply to subsequent retrievals without restarting the gateway.</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {sources.map(source=><label key={source.id} style={{display:'block',padding:'0.35rem'}}><input type="checkbox" disabled={busy} checked={selected.includes(source.id)} onChange={e=>setSelected(prior=>e.target.checked?[...prior,source.id]:prior.filter(id=>id!==source.id))}/>{source.name} ({source.kind}){!source.enabled?' — Paused':''}</label>)}
    {!sources.length&&!busy&&<p>Add sources in Knowledge before granting access.</p>}
    <button disabled={busy} onClick={async()=>{setBusy(true);setError('');setMessage('');try{await api.knowledgeAgentAccessSave(agentId,selected);setMessage('Knowledge access saved.');}catch(err){setError(err.message);}finally{setBusy(false);}}}>{busy?'Loading…':'Save Knowledge access'}</button>
  </details>;
}
