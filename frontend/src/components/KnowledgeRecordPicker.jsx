import {useEffect,useId,useRef,useState} from 'react';
import {useKnowledgeRecords} from '../hooks/useKnowledgeRecords.js';
import {api} from '../api';

export default function KnowledgeRecordPicker({sourceId,value,onChange,disabled,label='Record'}) {
  const [query,setQuery]=useState(''),[active,setActive]=useState(0),[open,setOpen]=useState(false),[selected,setSelected]=useState(null);
  const {records,next,busy,error,loadMore}=useKnowledgeRecords(sourceId,query);
  const id=useId(),input=useRef(null),list=useRef(null);
  useEffect(()=>{
    let current=true;
    if(!value){setSelected(null);return;}
    if(selected?.object_id===value&&selected?.source===sourceId)return;
    setSelected(null);
    if(sourceId)api.knowledgeSourceRecords(sourceId,null,{query:value,compact:true,limit:25}).then(page=>{if(current)setSelected(page.records.find(r=>r.object_id===value)||null);}).catch(()=>{});
    return()=>{current=false;};
  },[sourceId,value,selected?.object_id,selected?.source]);
  useEffect(()=>{setActive(0);},[query,sourceId]);
  useEffect(()=>{if(open)list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({block:'nearest'});},[active,open]);
  const choose=record=>{setSelected(record);onChange(record.object_id);setOpen(false);};
  return <div className="knowledge-record-picker">
    <label htmlFor={id}>{label}</label>
    <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={open&&!!sourceId} aria-controls={`${id}-results`}
      aria-activedescendant={open&&records[active]?`${id}-option-${active}`:undefined}
      autoComplete="off" placeholder={sourceId?'Search by name, content or record ID…':'Choose a source first'} maxLength={200}
      disabled={disabled||!sourceId} value={query} onFocus={()=>setOpen(true)}
      onChange={e=>{setQuery(e.target.value);setOpen(true);}}
      onKeyDown={e=>{
        if(e.key==='Escape'){setOpen(false);return;}
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(n=>Math.max(0,Math.min(records.length-1,n+(e.key==='ArrowDown'?1:-1))));}
        if(e.key==='Enter'&&open){e.preventDefault();if(records[active])choose(records[active]);}
      }}/>
    {value&&<div className="knowledge-picked"><span><strong>{selected?.title||'Selected record'}</strong>{selected?.preview&&<span className="knowledge-record-preview">{selected.preview}</span>}<small>{value}</small></span><button type="button" disabled={disabled} onClick={()=>{onChange('');setSelected(null);setQuery('');setOpen(true);input.current?.focus();}}>Clear</button></div>}
    {sourceId&&open&&<div className="knowledge-picker-panel">
      <div id={`${id}-results`} ref={list} role="listbox" aria-label={`${label} results`} aria-busy={busy} className="knowledge-picker-results"
        onScroll={e=>{const el=e.currentTarget;if(el.scrollHeight-el.scrollTop-el.clientHeight<100&&!error)loadMore();}}>
        {records.map((record,index)=><div role="option" aria-selected={value===record.object_id} id={`${id}-option-${index}`} key={record.entity} data-index={index}
          className={`knowledge-picker-option ${active===index?'is-active':''}`} onMouseDown={e=>e.preventDefault()} onClick={()=>{if(!disabled)choose(record);}}>
          <strong>{record.title||'Untitled record'}</strong>{record.preview&&<span className="knowledge-record-preview">{record.preview}</span>}<small>{record.object_id}</small>
        </div>)}
      </div>
      <div className="knowledge-picker-footer" role="status">{busy?'Searching records…':error||(!records.length?(query?'No matches. Try other content keywords, a name or an ID.':'No indexed records yet. Check source sync status.'):`${records.length} records loaded`)}
        {next&&<button type="button" disabled={disabled||busy} onClick={loadMore}>{busy?'Loading…':'Load more'}</button>}
      </div>
    </div>}
  </div>;
}
