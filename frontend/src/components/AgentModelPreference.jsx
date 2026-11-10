import {useEffect,useState} from 'react';
import {api} from '../api';

export default function AgentModelPreference({agentId}){
 const [data,setData]=useState(null),[model,setModel]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let active=true;setData(null);setError('');setMessage('');api.agentModelGet(agentId).then(value=>{if(active){setData(value);setModel(value.model||'');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[agentId]);
 async function save(){setBusy(true);setError('');setMessage('');try{const value=await api.agentModelSet(agentId,model);setData(value);setModel(value.model||'');setMessage('Saved. New turns use this preference unless that conversation has an explicit model override.');}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section style={{marginBottom:'1.25rem',padding:'1rem',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10}}>
  <h2 style={{margin:'0 0 0.5rem',fontSize:'1rem'}}>AI model</h2>
  <p style={{color:'var(--muted)',fontSize:'0.85rem'}}>Leave blank to follow the active platform default. Enter a provider model ID to override it for this employee. If your Profile uses BYOK, the override uses your BYOK provider and key.</p>
  <label htmlFor="agent-model-choice">Employee model ID</label>{' '}
  <input id="agent-model-choice" value={model} maxLength={300} disabled={!data||busy} onChange={e=>setModel(e.target.value)} placeholder="Blank uses default" style={{maxWidth:'100%',padding:'0.5rem',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:6}} />{' '}
  <button type="button" disabled={!data||busy} onClick={save}>{busy?'Saving…':'Save model'}</button>
  <p style={{color:'var(--muted)',fontSize:'0.8rem'}}>Default: {data?.default_model||'Loading…'}. Model availability depends on your provider account. An explicit model does not silently fall back to another model or key. Running turns and explicit conversation overrides are unchanged.</p>
  {data?.routing?.model&&<p style={{fontSize:'0.8rem'}}>Saved route: {data.routing.model} · {data.routing.credential_source==='byok'?'Your BYOK key':'Platform credentials'}</p>}
  {data?.routing?.error&&<p role="alert">{data.routing.error}</p>}
  {message&&<p role="status">{message}</p>}{error&&<p role="alert" style={{color:'var(--danger,#f87171)'}}>{error}</p>}
 </section>;
}
