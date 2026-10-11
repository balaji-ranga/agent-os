import { useEffect,useState } from 'react';
import { api } from '../api';
export default function KnowledgeSourcePicker({values=[],onChange}) {
  const [sources,setSources]=useState([]),[error,setError]=useState('');
  useEffect(()=>{let active=true;api.knowledgeSources().then(r=>{if(active)setSources(r.sources);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  return <fieldset className="wf-field"><legend>Knowledge sources</legend>
    {error&&<p role="alert">{error}</p>}
    {sources.map(s=><label key={s.id}><input type="checkbox" checked={values.includes(s.id)} onChange={e=>onChange(e.target.checked?[...values,s.id]:values.filter(id=>id!==s.id))}/>{s.name} ({s.kind})</label>)}
    {!sources.length&&!error&&<small>No sources available. Configure them in Knowledge first.</small>}
    <small>Only these owner-scoped sources are available to this workflow node.</small>
  </fieldset>;
}
