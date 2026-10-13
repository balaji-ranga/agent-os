import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { getCopilotForm } from '../utils/copilotForms.js';
import { copilotAgentHandoff } from '../utils/copilotHandoff.js';
import AgentChatPanel from './AgentChatPanel';
import './PlatformHelpCopilot.css';
const fieldLabels={kind:'Connection',collections:'Content to include',interval_seconds:'Sync frequency',graph_enabled:'Connect related information',intelligent_mapping:'Intelligent relationship mapping',enabled:'Synchronization',retrieval_enabled:'Visible in search',folder_id:'Folder',query:'Content filter',selection:'Content selection'};
function displayValue(key,value){
  if(value===undefined||value==='')return 'Not set';
  if(typeof value==='boolean')return value?'On':'Off';
  if(key==='interval_seconds')return value%60===0?`Every ${value/60} minutes`:`Every ${value} seconds`;
  if(Array.isArray(value))return value.join(', ')||'None';
  if(value&&typeof value==='object')return Object.entries(value).map(([k,v])=>`${fieldLabels[k]||k}: ${displayValue(k,v)}`).join('; ');
  return String(value);
}
function hasDraftContent(id,values){
  if(id==='knowledge_source')return !!(values.name||values.query||values.folder_id);
  if(id==='knowledge_table')return !!(values.name||values.purpose||values.columns?.replaceAll(' ','')!=='name,value');
  if(id==='knowledge_document')return !!(values.title||values.tags);
  if(id==='hire_employee')return !!(values.name||values.role);
  if(id==='broadcast_draft')return !!values.message;
  if(id==='scheduled_goal')return !!(values.title||values.prompt);
  return true;
}

export default function PlatformHelpCopilot() {
  const { user } = useAuth(), location = useLocation(), navigate = useNavigate();
  const [open,setOpen]=useState(false),[catalog,setCatalog]=useState(null),[session,setSession]=useState(null);
  const [input,setInput]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [watch,setWatch]=useState(null),[helpChat,setHelpChat]=useState(false);
  const [review,setReview]=useState(null);
  const baselines=useRef({}),toggle=useRef(null),reviewPanel=useRef(null);
  useEffect(()=>{if(review&&reviewPanel.current){reviewPanel.current.scrollIntoView({block:'nearest',behavior:'smooth'});reviewPanel.current.focus({preventScroll:true});}},[review]);
  useEffect(()=>{
    const saved=e=>{const form=e.detail?.form;if(!session?.drafts?.[form])return;
      api.copilotUpdate(session.id,{version:session.version,clearDraft:form}).then(next=>{setSession(next);setReview(null);setNotice('Saved successfully. I’ve removed that unfinished draft.');}).catch(()=>setNotice('Your form was saved. The assistance session changed, so I kept its draft—refresh and discard it if no longer needed.'));
    };
    window.addEventListener('flolah-copilot-form-saved',saved);return()=>window.removeEventListener('flolah-copilot-form-saved',saved);
  },[session]);
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
    setReview(null);
    let s=await ensureSession();
    baselines.current=Object.fromEntries(Object.keys(catalog.forms).map(id=>[id,getCopilotForm(id)?.read()]));
    for(const [form,values] of Object.entries(baselines.current))if(values&&hasDraftContent(form,values)){s=await api.copilotUpdate(s.id,{version:s.version,draft:{form,values}});setSession(s);}
    const screen=catalog.screens?.find(x=>x.route.split('#')[0]===location.pathname)?.id;
    const next=await api.copilotPropose(s.id,{version:s.version,message:input,...(screen?{screen}:{})});
    setSession(next);setInput('');setNotice('');
    const prepared=next.proposal?.actions.find(a=>a.type==='fill'&&getCopilotForm(a.form));
    if(prepared)setReview({action:prepared,expected:baselines.current[prepared.form]??getCopilotForm(prepared.form).read()});
  });}
  async function go(route,state={}){
    let s=await ensureSession();
    for(const id of Object.keys(catalog.forms)){
      const binding=getCopilotForm(id);
      if(binding){const values=binding.read();if(hasDraftContent(id,values)){s=await api.copilotUpdate(s.id,{version:s.version,draft:{form:id,values}});setSession(s);}}
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
    await binding.apply(review.action.values,review.expected);
    await update({draft:{form:review.action.form,values:{...review.expected,...review.action.values}}});
    baselines.current[review.action.form]=undefined;setReview(null);
    setNotice('Fields applied. Review the actual form and use its Save button. No configuration has been saved yet.');
  }
  async function openAction(action){
    const fresh=await api.copilotCatalog();
    if(action.type==='navigate'){
      const screen=fresh.screens.find(s=>s.id===action.screen);
      if(!screen)throw new Error('This screen is no longer available.');
      await go(screen.route);return;
    }
    const handoff=copilotAgentHandoff(action,fresh.agents);
    await go(handoff.route,handoff.state);
    if(action.type==='agent_call')setOpen(false);
  }
  async function startWatch(provider){await update({watch:provider});setWatch(provider);setNotice(`Checking ${provider}. Complete authorization yourself in Connectors.`);}
  const help=catalog?.agents.find(a=>/platform.?help/i.test(`${a.id} ${a.name}`));
  return <aside className="platform-help-copilot">
    <button ref={toggle} type="button" className="btn-primary copilot-toggle" aria-label="Platform Help" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>✦ <span>Platform Help</span></button>
    {open&&<section className="copilot-panel" aria-label="Platform Help assistant" onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);toggle.current?.focus();}}}>
      <header><div><strong>Platform Help</strong><small>Your Flolah copilot</small></div><button type="button" className="btn-ghost" aria-label="Close Platform Help" onClick={()=>{setOpen(false);toggle.current?.focus();}}>×</button></header>
      {error&&<p role="alert" className="page-banner page-banner-error">{error}</p>}
      {notice&&<p role="status">{notice}</p>}
      {review&&<article ref={reviewPanel} tabIndex={-1} aria-label="Review field changes"><strong>Here’s what I’ll prepare</strong><p>These changes are ready for your review. Nothing has been filled or saved yet.</p><dl>{Object.entries(review.action.values).map(([k,v])=><div key={k}><dt>{fieldLabels[k]||k.replaceAll('_',' ')}</dt><dd>{displayValue(k,review.expected[k])} → {displayValue(k,v)}</dd></div>)}</dl><button className="btn-primary" disabled={busy||session?.status!=='active'} onClick={()=>run(confirmFields)}>Use these details</button><button onClick={()=>setReview(null)}>Keep current fields</button></article>}
      {!catalog?<p>Loading permitted screens…</p>:<>
        <details className="copilot-preferences"><summary>How I help</summary><label>Assistance style <select disabled={busy} value={session?.mode||'hybrid'} onChange={e=>run(()=>update({mode:e.target.value}))}><option value="hybrid">Prepare setup and guide me</option><option value="guided">Guide me step by step</option><option value="autofill">Prepare fields for my review</option></select></label><p>I can prepare supported forms. You review before saving and handle any sign-in yourself.</p>
        {session&&<div className="copilot-controls"><span>{session.status}</span><button disabled={busy} onClick={()=>run(()=>update({status:session.status==='active'?'paused':'active'}))}>{session.status==='active'?'Pause':'Resume'}</button><button disabled={busy} onClick={()=>run(async()=>{await update({status:'cancelled'});setWatch(null);setNotice('Session cancelled; saved drafts cleared. Existing configuration is unchanged.');})}>Cancel</button><button disabled={busy} onClick={()=>run(()=>go(session.origin))}>Return to origin</button></div>}
        </details>
        <div className="copilot-conversation" role="log" aria-label="Conversation">
          {!session?.proposal&&<p className="copilot-bubble">What would you like to do? Tell me in your own words—I’ll help you find the right screen or prepare your setup.</p>}
          {(session?.conversation||[]).map((m,i)=><p key={i} className={`copilot-bubble copilot-${m.role}`}><small>{m.role==='user'?'You':'Platform Help'}</small>{m.text}</p>)}
          {session?.proposal&&!session?.conversation?.length&&<p className="copilot-bubble">{session.proposal.message}</p>}
        </div>
        {session?.proposal&&<div className="copilot-proposal">{session.proposal.actions.map((a,i)=><article key={i}>
          {a.type==='fill'?<><strong>{catalog.forms[a.form]?.label}</strong><p>I can prepare this for you. You’ll review the details before anything is saved.</p><button className="btn-primary" disabled={busy||session.status!=='active'} onClick={()=>run(()=>apply(a))}>Review setup</button></>:a.type==='watch_connector'?<button disabled={busy||session.status!=='active'} onClick={()=>run(()=>startWatch(a.provider))}>Check {a.provider} connection</button>:<><p>{a.message||''}</p><button disabled={busy||session.status!=='active'} onClick={()=>run(()=>openAction(a))}>{a.type==='agent_call'?'Start call with':'Open'} {catalog.screens?.find(s=>s.id===a.screen)?.label||catalog.agents.find(x=>x.id===a.agent)?.name||'agent chat'}</button></>}
        </article>)}</div>}
        {watch&&<p role="status">Waiting for {watch} authorization… <button disabled={busy} onClick={()=>run(async()=>{await update({watch:null});setWatch(null);})}>Stop checking</button></p>}
        <details><summary>Continue unfinished setup</summary><p>Drafts are private to your login and expire after seven days. Saving a form clears its draft.</p>{Object.entries(session?.drafts||{}).filter(([id])=>catalog.forms[id]).map(([id,values])=><article key={id}><strong>{catalog.forms[id].label}</strong><button disabled={busy} onClick={()=>run(()=>apply({form:id,values}))}>Continue setup</button><button disabled={busy} onClick={()=>run(()=>update({clearDraft:id}))}>Discard draft</button></article>)}{!Object.keys(session?.drafts||{}).length&&<p>No unfinished drafts.</p>}</details>
        {help&&<><button type="button" onClick={()=>setHelpChat(v=>!v)}>{helpChat?'Hide':'Open'} product-help chat</button>{helpChat&&<AgentChatPanel agentId={help.id} minHeight={240} placeholder="Ask about Flolah…"/>}</>}
        <form className="copilot-composer" onSubmit={propose}><label className="sr-only" htmlFor="copilot-message">Message Platform Help</label><textarea id="copilot-message" autoFocus value={input} maxLength={4000} onChange={e=>setInput(e.target.value)} placeholder="Ask me to help with anything in Flolah…"/><button className="btn-primary" disabled={busy||!input.trim()||session?.status==='paused'}>{busy?'Thinking…':'Send'}</button></form>
      </>}
    </section>}
  </aside>;
}
