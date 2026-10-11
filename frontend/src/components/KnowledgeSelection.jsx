import {useEffect,useId,useState} from 'react';
import {api} from '../api';

export default function KnowledgeSelection({form,onChange}){
  const id=useId(),[schema,setSchema]=useState({fields:[],operators:[]}),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const selection=form.selection||{mode:'all',rules:[],include:[]};
  const [includeText,setIncludeText]=useState((selection.include||[]).join(', '));
  useEffect(()=>setIncludeText((form.selection?.include||[]).join(', ')),[form.selection?.include]);
  useEffect(()=>{let active=true;api.knowledgeSelectionSchema(form.kind).then(s=>{if(active)setSchema(s);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[form.kind]);
  useEffect(()=>setPreview(null),[form]);
  const change=patch=>onChange({...form,selection:{...selection,...patch}});
  async function run(){setBusy(true);setError('');try{setPreview(await api.knowledgeSelectionPreview(form));}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <fieldset className="knowledge-selection"><legend>Content selection</legend>
    <p>Choose which records and fields enter Knowledge. Rules run after authorized fetching; Gmail search and Outlook folder scope also apply. Removing records from scope removes indexed copies, never originals.</p>
    <datalist id={id}>{[...new Set([...schema.fields,...(preview?.fields||[])])].map(f=><option key={f} value={f}/>)}</datalist>
    <label>Match <select value={selection.mode} onChange={e=>change({mode:e.target.value})}><option value="all">All conditions (AND)</option><option value="any">Any condition (OR)</option></select></label>
    {selection.rules.map((rule,i)=><div className="knowledge-filter-row" key={i}>
      <label>Field<input list={id} value={rule.field} placeholder="fields.status" onChange={e=>change({rules:selection.rules.map((r,n)=>n===i?{...r,field:e.target.value}:r)})}/></label>
      <label>Condition<select value={rule.operator} onChange={e=>change({rules:selection.rules.map((r,n)=>n===i?{...r,operator:e.target.value,value:e.target.value==='in'?[]:''}:r)})}>{schema.operators.map(o=><option key={o} value={o}>{o.replaceAll('_',' ')}</option>)}</select></label>
      <label>{rule.operator==='within_days'?'Days':rule.operator==='in'?'Values (comma separated)':'Value'}<input disabled={rule.operator==='exists'} value={Array.isArray(rule.value)?rule.value.join(','):rule.value??''} onChange={e=>change({rules:selection.rules.map((r,n)=>n===i?{...r,value:r.operator==='in'?e.target.value.split(',').map(v=>v.trim()):e.target.value}:r)})}/></label>
      <button type="button" onClick={()=>change({rules:selection.rules.filter((_,n)=>n!==i)})} aria-label={`Remove condition ${i+1}`}>Remove</button>
    </div>)}
    <button type="button" disabled={selection.rules.length>=20} onClick={()=>change({rules:[...selection.rules,{field:'title',operator:'contains',value:''}]})}>Add condition</button>
    <label>Fields to index (comma separated; empty means existing safe adapter fields)<input list={id} value={includeText} placeholder="title, fields.customer, fields.status" onChange={e=>setIncludeText(e.target.value)} onBlur={()=>change({include:includeText.split(',').map(v=>v.trim()).filter(Boolean)})}/></label>
    <small>Selecting fields replaces the full text with selected values. Include “text” only when the entire document/message body is intended. IDs and freshness metadata are retained.</small>
    <button type="button" disabled={busy||!form.name||!form.collections.length} onClick={run}>{busy?'Previewing…':'Preview matching records'}</button>
    {error&&<p role="alert">{error}</p>}{preview&&<div role="status"><p>{preview.matched} matched of {preview.checked} checked{preview.truncated?' (sample limit reached)':''}. {preview.note}</p>{preview.samples.map(r=><p key={r.object_id}><strong>{r.title}</strong> — {r.preview}</p>)}</div>}
  </fieldset>;
}
