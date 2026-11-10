import {useEffect,useState} from 'react';
import {api} from '../api';

export default function AgentModelPreference({agentId}){
 const [data,setData]=useState(null),[model,setModel]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let active=true;setData(null);setError('');setMessage('');api.agentModelGet(agentId).then(value=>{if(active){setData(value);setModel(value.model||'');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[agentId]);
 async function save(){setBusy(true);setError('');setMessage('');try{const value=await api.agentModelSet(agentId,model);setData(value);setModel(value.model||'');setMessage('Saved. New turns use this preference unless that conversation has an explicit model override.');}catch(e){setError(e.message);}finally{setBusy(false);}}
 const unavailable=model&&data&&!data.models.some(x=>x.id===model);
 return <section style={{marginBottom:'1.25rem',padding:'1rem',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10}}>
  <h2 style={{margin:'0 0 0.5rem',fontSize:'1rem'}}>AI model</h2>
  <p style={{color:'var(--muted)',fontSize:'0.85rem'}}>Choose a model for this employee in your company. Leave blank to follow the platform’s active primary or secondary slot.</p>
  <label htmlFor="agent-model-choice">Employee model</label>{' '}
  <select id="agent-model-choice" value={model} disabled={!data||busy} onChange={e=>setModel(e.target.value)} style={{maxWidth:'100%',padding:'0.5rem',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:6}}>
   <option value="">Use active platform default{data?.default_model?` — ${data.default_model}`:''}</option>
   {unavailable&&<option value={model}>{model} (no longer in catalog)</option>}
   {(data?.models||[]).map(x=><option key={x.id} value={x.id}>{x.name} · {x.provider}</option>)}
  </select>{' '}<button type="button" disabled={!data||busy||unavailable} onClick={save}>{busy?'Saving…':'Save model'}</button>
  <p style={{color:'var(--muted)',fontSize:'0.8rem'}}>Applies to new web and channel turns. Running turns and explicit conversation model overrides are unchanged. Existing company BYOK settings remain in effect until you save a preference here.</p>
  {message&&<p role="status">{message}</p>}{error&&<p role="alert" style={{color:'var(--danger,#f87171)'}}>{error}</p>}
 </section>;
}
