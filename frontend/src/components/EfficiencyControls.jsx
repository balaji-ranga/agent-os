import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatLocalDateTime } from '../utils/formatDateTime.js';

function useControls(admin) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=async()=>{const result=await (admin?api.adminEfficiencyGet():api.efficiencyLocalModels());setData(current=>current&&JSON.stringify(current.policy)===JSON.stringify(result.policy)?{...result,policy:current.policy}:result);return result;};
  useEffect(()=>{let alive=true; (admin?api.adminEfficiencyGet():api.efficiencyLocalModels()).then(value=>{if(alive)setData(value);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[admin]);
  const act=async(fn)=>{setBusy(true);setError('');try{await fn();await load();}catch(e){setError(e.message);}finally{setBusy(false);}};
  return {data,error,busy,load,act};
}

function RoutingEvidence({report}) {
  return <><p>{report?.totals?.calls||0} calls · {report?.totals?.local_successes||0} local successes · {report?.totals?.hosted_successes||0} hosted successes · {report?.totals?.failures||0} failures</p>
    <p className="ai-snip-note">{report?.cost_note}</p>
    <div style={{overflowX:'auto'}}><table><thead><tr><th>Time</th><th>Workload</th><th>Status</th><th>Actual model</th><th>Fallback</th><th>Queue / total latency</th></tr></thead><tbody>
      {(report?.events||[]).map(e=><tr key={e.id}><td>{formatLocalDateTime(e.created_at)}</td><td>{e.tool_name}</td><td>{e.status}</td><td>{e.actual_model||'Not yet reported'} {e.local===1?'(local)':e.local===0?'(hosted)':''}</td><td>{e.fallback_reason||'None'}</td><td>{e.queue_ms} / {e.latency_ms} ms</td></tr>)}
    </tbody></table></div></>;
}

export function AdminEfficiencyControls() {
  const {data,error,busy,load,act}=useControls(true);
  const [draft,setDraft]=useState(null),[model,setModel]=useState('ollama-efficiency');
  const [compareHosted,setCompareHosted]=useState(false);
  useEffect(()=>{if(data)setDraft(data.policy);},[data?.policy]);
  useEffect(()=>{if(!data?.evaluations?.some(e=>e.status==='running'))return;const timer=setInterval(()=>load().catch(()=>{}),2000);return()=>clearInterval(timer);},[data?.evaluations]);
  if(!draft)return <section className="panel"><h2>Efficiency policy</h2><p role={error?'alert':'status'}>{error||'Loading efficiency controls…'}</p></section>;
  const set=(key,value)=>setDraft(old=>({...old,[key]:value}));
  return <section className="panel"><h2>Efficiency policy, validation & fallback</h2>
    <p>Only the existing ten utility workloads. Goal planning/checking, steering verification, trading and authorization remain unchanged. JSON validation is mandatory.</p>
    {error&&<p role="alert" className="error-message">{error}</p>}
    <label><input type="checkbox" checked={draft.enabled} onChange={e=>set('enabled',e.target.checked)}/> Allow efficiency routing for opted-in companies</label><br/>
    <label><input type="checkbox" checked={draft.allow_cloud_fallback} onChange={e=>set('allow_cloud_fallback',e.target.checked)}/> Permit hosted fallback (companies may opt out)</label>
    <label style={{display:'block'}}>Default local model <select value={draft.default_model} onChange={e=>set('default_model',e.target.value)}>{(data.models||[]).filter(m=>draft.allowed_models.includes(m.id)).map(m=><option key={m.id} value={m.id}>{m.id} · {m.model}</option>)}</select></label>
    <fieldset><legend>Allowed local models</legend>{(data.models||[]).map(m=><label key={m.id} style={{display:'block'}}><input type="checkbox" checked={draft.allowed_models.includes(m.id)} onChange={e=>set('allowed_models',e.target.checked?[...draft.allowed_models,m.id]:draft.allowed_models.filter(id=>id!==m.id))}/>{m.id} · {m.model}</label>)}</fieldset>
    <fieldset><legend>Eligible utility workloads</legend>{['learnings_summary','chat_archive_title','brain_history','ibkr_order_learnings','broadcast_notify_intent','coo_tool_ownership','goal_plan_tool_args','ceo_guardrails_enrich','summarize_url','master_data_rag'].map(name=><label key={name} style={{display:'block'}}><input type="checkbox" checked={draft.workloads.includes(name)} onChange={e=>set('workloads',e.target.checked?[...draft.workloads,name]:draft.workloads.filter(x=>x!==name))}/>{name}</label>)}</fieldset>
    <h3>Local capacity</h3><p>{data.capacity.active} active · {data.capacity.queued} queued efficiency calls. Limits apply to this backend process, not separate OpenClaw inference; multiple replicas require distributed leases.</p>
    <div className="model-timeout-grid">{[['max_concurrency','Concurrent local calls',1,16],['max_queue','Queue capacity',0,256],['queue_timeout_ms','Queue deadline (ms)',10,60000],['local_timeout_ms','Local inference deadline (ms)',100,120000],['observer_timeout_ms','Observer inference deadline (ms)',100,120000]].map(([key,label,min,max])=><label key={key}>{label}<input type="number" min={min} max={max} value={draft[key]} onChange={e=>set(key,Number(e.target.value))}/></label>)}</div>
    <button type="button" className="wf-btn" disabled={busy} onClick={()=>act(()=>api.adminEfficiencyPolicySave(draft))}>Save efficiency policy</button>
    <h3>Workload evaluations</h3><p>Synthetic read-only smoke tests, not full quality certification. Runs local inference only; changing the default model requires a passing, approved evaluation for that exact model.</p>
    <select aria-label="Evaluation local model" value={model} onChange={e=>setModel(e.target.value)}>{(data.models||[]).map(m=><option key={m.id} value={m.id}>{m.model}</option>)}</select>{' '}
    <label style={{display:'block'}}><input type="checkbox" checked={compareHosted} onChange={e=>setCompareHosted(e.target.checked)}/> Also run the same synthetic prompts on the configured hosted primary (uses paid API tokens)</label>
    <button type="button" className="wf-btn" disabled={busy||data.evaluations.some(e=>e.status==='running')} onClick={()=>act(()=>api.adminEfficiencyEvaluate(model,compareHosted))}>Run evaluation</button>{' '}<button type="button" className="wf-btn" disabled={busy} onClick={()=>act(load)}>Refresh evidence</button>
    <ul>{data.evaluations.map(e=><li key={e.id}>{e.model} · {e.status} · {e.passed_count??e.cases?.filter(c=>c.passed).length??0}/{e.total_count??10} passed · {e.average_latency_ms!=null?`${Math.round(e.average_latency_ms)} ms average`:'in progress'} · {e.approved?'Approved':'Not approved'}{' '}{e.passed&&!e.approved&&<button type="button" disabled={busy} onClick={()=>act(()=>api.adminEfficiencyApprove(e.id))}>Approve utility smoke evaluation</button>}{e.baseline?.length>0&&<p>Hosted comparison: {e.baseline_passed_count??e.baseline.filter(c=>c.passed).length}/{e.baseline.length} passed · {e.baseline_average_latency_ms!=null?`${Math.round(e.baseline_average_latency_ms)} ms average`:'running'}. {e.cost_note}</p>}<details><summary>Case results</summary><ul>{(e.cases||[]).map(c=><li key={c.tool}>{c.tool}: {c.passed?'pass':'fail'} · {c.actual_model||'unavailable'} · {c.latency_ms} ms · {c.input_tokens}/{c.output_tokens} input/output tokens</li>)}</ul>{e.baseline?.length>0&&<ul>{e.baseline.map(c=><li key={c.tool}>Hosted {c.tool}: {c.passed?'pass':'fail'} · {c.actual_model||'unavailable'} · {c.latency_ms} ms · {c.input_tokens}/{c.output_tokens} input/output tokens</li>)}</ul>}</details></li>)}</ul>
    <h3>Actual routing evidence</h3><RoutingEvidence report={data.report}/>
  </section>;
}

export function CompanyEfficiencyPreferences() {
  const {data,error,busy,act}=useControls(false);
  const [draft,setDraft]=useState({fallback_mode:'inherit',model_id:'inherit'});
  useEffect(()=>{if(data)setDraft({fallback_mode:data.preferences.fallback_mode,model_id:data.preferences.model_id});},[data]);
  return <section><h3>Company efficiency preferences</h3>{error&&<p role="alert">{error}</p>}
    <p>These preferences apply only when Efficiency mode is enabled. Admin restrictions always take precedence.</p>
    <label style={{display:'block'}}>Fallback preference <select value={draft.fallback_mode} onChange={e=>setDraft({...draft,fallback_mode:e.target.value})}><option value="inherit">Use Admin policy</option><option value="local_only">Local only — never send this workload to hosted fallback</option><option value="allow_cloud">Allow hosted fallback when Admin permits</option></select></label>
    <label style={{display:'block'}}>Local model <select value={draft.model_id} onChange={e=>setDraft({...draft,model_id:e.target.value})}><option value="inherit">Use Admin default</option>{(data?.preferences.allowed_models||[]).map(id=><option key={id} value={id}>{id}</option>)}</select></label>
    <p>Effective model: {data?.preferences.effective_model||'Loading…'} · hosted fallback: {data?.preferences.effective_cloud_fallback?'permitted':'not permitted'}. Other agent/chat calls retain their own provider; local-only is not a company-wide data-residency setting.</p>
    <button type="button" disabled={busy||!data} onClick={()=>act(()=>api.efficiencyPreferencesSave(draft))}>Save efficiency preferences</button>
  </section>;
}

export function CompanyEfficiencyEvidence() {
  const {data,error,busy,act,load}=useControls(false);
  return <section className="ai-snip-card"><h2>Efficiency routing · quality & usage</h2><p>Your company’s efficiency calls only. Goal and safety checks keep their configured routes.</p>{error&&<p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={()=>act(load)}>Refresh local-model evidence</button>
    {data&&<><p>{data.capacity.active} active · {data.capacity.queued} queued in this company.</p><RoutingEvidence report={data.report}/>
      <h3>Approved synthetic evaluations</h3><ul>{data.evaluations.map(e=><li key={e.id}>{e.model}: {e.passed_count}/{e.total_count} · {Math.round(e.average_latency_ms)} ms average. {e.scope}</li>)}</ul></>}
  </section>;
}
