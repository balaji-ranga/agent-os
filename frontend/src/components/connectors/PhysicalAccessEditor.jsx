import {useState} from 'react';
import {physicalRequest} from '../../services/physicalApi';
export default function PhysicalAccessEditor({entity,refresh}){
 const [grants,setGrants]=useState(entity.entitlements||[]),[error,setError]=useState('');
 const actions=Object.keys(entity.description.actions);
 function update(i,patch){setGrants(grants.map((g,j)=>j===i?{...g,...patch}:g));}
 async function save(){try{await physicalRequest(`/entities/${entity.id}/entitlements`,{method:'PUT',body:{grants}});setError('Saved. Pending operations were invalidated; new requests use these grants.');await refresh();}catch(e){setError(e.message);}}
 return <details><summary>Resource access</summary><p>{Array.isArray(entity.entitlements)?'Explicit device access applies.':'Legacy company tool access applies until you save explicit grants.'} Company owners administer access. Tool grants and device action policies also apply.</p>{grants.map((g,i)=><fieldset key={i}><label>Principal (agent:id, user:id or workflow:id)<input value={g.principal} onChange={e=>update(i,{principal:e.target.value})} /></label><label><input type="checkbox" checked={g.discover} onChange={e=>update(i,{discover:e.target.checked})} />Discover/read</label>{actions.map(a=><label key={a}><input type="checkbox" checked={g.actions.includes(a)} onChange={e=>update(i,{actions:e.target.checked?[...g.actions,a]:g.actions.filter(x=>x!==a)})} />{a}</label>)}<button onClick={()=>setGrants(grants.filter((_,j)=>j!==i))}>Remove grant</button></fieldset>)}<button onClick={()=>setGrants([...grants,{principal:'',discover:true,actions:[]}])}>Add principal</button> <button onClick={save}>Save explicit grants</button>{error&&<p role="status">{error}</p>}</details>;
}
