import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { getCopilotForm } from '../utils/copilotForms.js';
import AgentChatPanel from './AgentChatPanel';
import './PlatformHelpCopilot.css';

export default function PlatformHelpCopilot() {
  const { user } = useAuth(), location = useLocation(), navigate = useNavigate();
  const [open,setOpen]=useState(false),[catalog,setCatalog]=useState(null),[session,setSession]=useState(null);
  const [input,setInput]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [watch,setWatch]=useState(null),[helpChat,setHelpChat]=useState(false);
  const [review,setReview]=useState(null);
  const baselines=useRef({}),toggle=useRef(null);
  useEffect(()=>{
    const show=()=>setOpen(true);
    window.addEventListener('agent-os-open-platform-help',show);
    return()=>window.removeEventListener('agent-os-open-platform-help',show);
  },[]);
  useEffect(()=>{
    if(!open)return;
    let active=true;
    Promise.all([api.copilotCatalog(),api.copilotSession()]).then(([c,s])=>{if(active){setCatalog(c);setSession(s.session);setWatch(s.session?.watch?.status==='waiting'?s.session.watch.provider:null);}}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[open,user?.id]);
  useEffect(()=>{
    if(!watch || !open || session?.status!=='active')return;
    let disposed=false,timer,attempt=0;
    async function poll(){
      try {
        const result=await api.copilotCheckConnection(session.id);
        if(disposed)return;
        setSession(result);
        if(result.watch?.status==='connected'){setNotice(`${watch} is connected. Return to your saved draft to continue.`);setWatch(null);return;}
        if(result.watch?.status!=='waiting'){setNotice('Connection check stopped or timed out. Review Connectors and try again.');setWatch(null);return;}
        if(++attempt>=20){setNotice('Connection not confirmed. Complete authorization in Connectors, then start checking again.');setWatch(null);return;}
        timer=setTimeout(poll,Math.min(30000,5000+attempt*1500));
      }catch(e){if(!disposed){setError(e.message);setWatch(null);}}
    }
    poll();return()=>{disposed=true;clearTimeout(timer);};
  },[watch,open,session?.status]);
  async function run(fn){setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function ensureSession(){if(session&&session.status!=='cancelled')return session;const s=await api.copilotCreate({origin:location.pathname});setSession(s);return s;}
  async function update(body){const s=await ensureSession();const next=await api.copilotUpdate(s.id,{version:s.version,...body});setSession(next);return next;}
  async function propose(e){e.preventDefault();await run(async()=>{
    let s=await ensureSession();
    baselines.current=Object.fromEntries(Object.keys(catalog.forms).map(id=>[id,getCopilotForm(id)?.read()]));
    for(const [form,values] of Object.entries(baselines.current))if(values){s=await api.copilotUpdate(s.id,{version:s.version,draft:{form,values}});setSession(s);}
    setSession(await api.copilotPropose(s.id,{version:s.version,message:input}));setInput('');setNotice('Review the proposed actions. Fields are not saved automatically.');
  });}
  async function go(route,state={}){
    let s=await ensureSession();
    for(const id of Object.keys(catalog.forms)){
      const binding=getCopilotForm(id);
      if(binding){s=await api.copilotUpdate(s.id,{version:s.version,draft:{form:id,values:binding.read()}});setSession(s);}
    }
    navigate(route,{state});
  }
  async function apply(action){
    const fresh=await api.copilotCatalog();
    if(!fresh.forms[action.form])throw new Error('Your access to this form changed.');
    const binding=getCopilotForm(action.form);
    if(!binding){await go(fresh.forms[action.form].route);setNotice('Form opened. Review the proposal, then apply the fields.');return;}
    const expected=baselines.current[action.form] ?? binding.read();
    if(JSON.stringify(binding.read())!==JSON.stringify(expected))throw new Error('You edited this form after the proposal. Ask again to preserve your latest changes.');
    setReview({action,expected});
  }
  async function confirmFields(){
    const fresh=await api.copilotCatalog();
    if(!fresh.forms[review.action.form])throw new Error('Your form access changed.');
    const binding=getCopilotForm(review.action.form);
    if(!binding)throw new Error('Return to the form before applying changes.');
    await binding.apply(review.action.values,review.expected);baselines.current[review.action.form]=undefined;setReview(null);
    setNotice('Fields applied. Review the actual form and use its Save button. No configuration has been saved yet.');
  }
  async function openAction(action){
    const fresh=await api.copilotCatalog();
    if(action.type==='navigate'){
      const screen=fresh.screens.find(s=>s.id===action.screen);
      if(!screen)throw new Error('This screen is no longer available.');
      await go(screen.route);return;
    }
    if(!fresh.agents.some(a=>a.id===action.agent))throw new Error('This agent is no longer available.');
    await go(`/agents/${encodeURIComponent(action.agent)}/chat`,{prefill:action.message||'',autosend:false,copilotCall:action.type==='agent_call'});
    if(action.type==='agent_call')setOpen(false);
  }
  async function startWatch(provider){await update({watch:provider});setWatch(provider);setNotice(`Checking ${provider}. Complete authorization yourself in Connectors.`);}
  const help=catalog?.agents.find(a=>/platform.?help/i.test(`${a.id} ${a.name}`));
  return <aside className="platform-help-copilot">
    <button ref={toggle} type="button" className="btn-primary copilot-toggle" aria-label="Platform Help" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>✦ <span>Platform Help</span></button>
    {open&&<section className="copilot-panel" aria-label="Platform Help assistant" onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);toggle.current?.focus();}}}>
      <header><div><strong>Platform Help</strong><small>Configure, navigate and get guidance</small></div><button type="button" className="btn-ghost" aria-label="Close Platform Help" onClick={()=>{setOpen(false);toggle.current?.focus();}}>×</button></header>
      {error&&<p role="alert" className="page-banner page-banner-error">{error}</p>}
      {notice&&<p role="status">{notice}</p>}
      {review&&<article aria-label="Review field changes"><strong>Review before applying</strong><dl>{Object.entries(review.action.values).map(([k,v])=><div key={k}><dt>{k.replaceAll('_',' ')}</dt><dd>{JSON.stringify(review.expected[k]??'')} → {JSON.stringify(v)}</dd></div>)}</dl><button disabled={busy||session?.status!=='active'} onClick={()=>run(confirmFields)}>Confirm field changes</button><button onClick={()=>setReview(null)}>Keep current fields</button></article>}
      {!catalog?<p>Loading permitted screens…</p>:<>
        <label>Assistance mode <select disabled={busy} value={session?.mode||'hybrid'} onChange={e=>run(()=>update({mode:e.target.value}))}><option value="hybrid">Hybrid</option><option value="guided">Guided</option><option value="autofill">Autofill</option></select></label>
        <p className="page-muted">Internal forms: prepare and review. External authorization and secret entry: you remain in control.</p>
        {session&&<div className="copilot-controls"><span>{session.status}</span><button disabled={busy} onClick={()=>run(()=>update({status:session.status==='active'?'paused':'active'}))}>{session.status==='active'?'Pause':'Resume'}</button><button disabled={busy} onClick={()=>run(async()=>{await update({status:'cancelled'});setWatch(null);setNotice('Session cancelled; saved drafts cleared. Existing configuration is unchanged.');})}>Cancel</button><button disabled={busy} onClick={()=>run(()=>go(session.origin))}>Return to origin</button></div>}
        <form onSubmit={propose}><label>What would you like to set up?<textarea autoFocus value={input} maxLength={4000} onChange={e=>setInput(e.target.value)} placeholder="Set up a Knowledge source for my connected Gmail…"/></label><button className="btn-primary" disabled={busy||!input.trim()||session?.status==='paused'}>{busy?'Working…':'Suggest next steps'}</button></form>
        {session?.proposal&&<div className="copilot-proposal"><p>{session.proposal.message}</p>{session.proposal.actions.map((a,i)=><article key={i}>
          {a.type==='fill'?<><strong>{catalog.forms[a.form]?.label}</strong><dl>{Object.entries(a.values).map(([k,v])=><div key={k}><dt>{k.replaceAll('_',' ')}</dt><dd>{Array.isArray(v)?v.join(', '):String(v)}</dd></div>)}</dl><button disabled={busy||session.status!=='active'} onClick={()=>run(()=>apply(a))}>Open / apply fields</button></>:a.type==='watch_connector'?<button disabled={busy||session.status!=='active'} onClick={()=>run(()=>startWatch(a.provider))}>Check {a.provider} connection</button>:<><p>{a.message||''}</p><button disabled={busy||session.status!=='active'} onClick={()=>run(()=>openAction(a))}>{a.type==='agent_call'?'Start call with':'Open'} {a.screen||catalog.agents.find(x=>x.id===a.agent)?.name||'agent chat'}</button></>}
        </article>)}</div>}
        {watch&&<p role="status">Waiting for {watch} authorization… <button disabled={busy} onClick={()=>run(async()=>{await update({watch:null});setWatch(null);})}>Stop checking</button></p>}
        <details><summary>Saved drafts and supported forms</summary>{Object.entries(catalog.forms).map(([id,f])=><article key={id}><strong>{f.label}</strong><p>{f.purpose}</p><button disabled={busy} onClick={()=>run(()=>go(f.route))}>Open form</button>{getCopilotForm(id)&&<button disabled={busy} onClick={()=>run(async()=>{await update({draft:{form:id,values:getCopilotForm(id).read()}});setNotice('Non-secret draft saved; no production configuration created.');})}>Save draft</button>}{session?.drafts[id]&&<button disabled={busy} onClick={()=>run(()=>apply({form:id,values:session.drafts[id]}))}>Review / restore draft</button>}</article>)}</details>
        {help&&<><button type="button" onClick={()=>setHelpChat(v=>!v)}>{helpChat?'Hide':'Open'} product-help chat</button>{helpChat&&<AgentChatPanel agentId={help.id} minHeight={240} placeholder="Ask about Flolah…"/>}</>}
      </>}
    </section>}
  </aside>;
}
