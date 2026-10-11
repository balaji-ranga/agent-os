// Synthetic local-only UI fixture: never calls a backend or LLM.
import React from 'react';
import {createRoot} from 'react-dom/client';
import KnowledgeEfficiency from '../src/components/KnowledgeEfficiency.jsx';
import {api} from '../src/api.js';
import '../src/index.css';
const scenario=new URLSearchParams(location.search).get('scenario');
api.knowledgeEfficiency=async({page=0,section,source,agent})=>{
  if(scenario==='error')throw new Error('Synthetic metrics failure; refresh to retry.');
  const empty=scenario==='empty',count=empty?0:source?1:25;
  return {health:{total:count,paused:2,failed:1,worker:'online'},sync:{checked:100,changed:12,reused:88,deleted:2,failed:1,seconds:3.4},pending:{count:0},index:{available:!empty,records:100,chunks:400,relationships:8},usage:{rag_calls:7,graph_calls:3,retrieved:23,empty:1,denied:2,errors:0,latency_ms:180,p95_ms:300,relationships:8},
  items:empty?[]:Array.from({length:Math.min(20,Math.max(0,count-page*20))},(_,i)=>section==='sources'?{id:`source-${i+page*20}`,name:`Demo CRM ${i+page*20}`,kind:'crm',enabled:true,status:'ready',last_success:'2026-10-11T00:00:00Z',next_sync:'2026-10-11T00:05:00Z',excluded:2}:section==='runs'?{id:`run-${i}`,source_id:source||'source-0',source_name:'Demo CRM',status:'completed',trigger:'scheduled',checked:100,changed:12,reused:88,deleted:2,seconds:3.4,started_at:'2026-10-11T00:00:00Z'}:{agent:agent||`Demo Agent ${i}`,rag_calls:7,graph_calls:3,retrieved:23,empty:1,denied:2,errors:0,latency_ms:180}),
  total:count,next:page*20+20<count?page+1:null,as_of:'2026-10-11T00:00:00Z',notes:['Synthetic local fixture — not production metrics.']};
};
createRoot(document.getElementById('root')).render(<div className="ai-snip-page eff-page"><header className="ai-snip-page-head"><h1>Efficiency View · Knowledge</h1></header><KnowledgeEfficiency range="14"/></div>);
