import {useState} from 'react';
import {api} from '../api';
export default function KnowledgeJobRecords({job}){
  const [page,setPage]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function load(after=''){
    setBusy(true);setError('');
    try{setPage(await api.knowledgeJobRecords(job.id,after));}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <div><button type="button" disabled={busy} onClick={()=>page?setPage(null):load()}>{page?'Hide records':'Record progress'}</button>
    {error&&<p role="alert">{error}</p>}
    {page&&<section aria-label="Job record progress">{page.items.length===0&&<p>No per-record progress captured for this run.</p>}
      {page.items.map(item=><p key={item.object_id}><strong>{item.object_id}</strong> · {item.stage} · attempt {item.attempts}{item.error&&<span role="alert"> · {item.error}</span>}</p>)}
      <button disabled={busy} onClick={()=>load()}>First records</button><button disabled={busy||!page.next} onClick={()=>load(page.next)}>Next 25 records</button>
    </section>}
  </div>;
}
