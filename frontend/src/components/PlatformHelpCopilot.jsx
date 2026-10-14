import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { getCopilotForm } from '../utils/copilotForms.js';
import { copilotAgentHandoff } from '../utils/copilotHandoff.js';
import { findGuideField, findSourceGuideField, highlightGuideField, revealRegisteredForm } from '../utils/copilotGuide.js';
import { requestCopilotEmbed } from '../utils/copilotEmbed.js';
import { continueCopilotNavigation, waitForCopilotReady, hasCopilotEmbedControls, matchesCopilotDestination } from '../utils/copilotNavigation.js';
import { captureDomFields, applyDomFields, visibleCopilotControls, visibleCopilotOptions } from '../utils/copilotDomFill.js';
import AgentChatPanel from './AgentChatPanel';
import CopilotCoaching from './CopilotCoaching';
import {replayStep,replayMatches,replayPrompt,openReplayDestination} from '../utils/copilotReplay.js';
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

const reviewKey=action=>JSON.stringify(action);
export default function PlatformHelpCopilot() {
  const { user } = useAuth(), location = useLocation(), navigate = useNavigate();
  const [open,setOpen]=useState(false),[catalog,setCatalog]=useState(null),[session,setSession]=useState(null);
  const [input,setInput]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [watch,setWatch]=useState(null),[helpChat,setHelpChat]=useState(false);
  const [review,setReview]=useState(null);
  const [settings,setSettings]=useState(false);
  const [replay,setReplay]=useState(null);
  const settingsToggle=useRef(null);
  useEffect(()=>{if(!error)return;const timer=setTimeout(()=>setError(''),5000);return()=>clearTimeout(timer);},[error]);
  useEffect(()=>{setSettings(false);setReplay(null);},[user?.id]);
  useEffect(()=>{if(!open)setReplay(r=>r?{...r,paused:true}:r);},[open]);
  const [guide,setGuide]=useState(null);
  const [completedActions,setCompletedActions]=useState([]);
  const [replyTo,setReplyTo]=useState(null),[pendingForm,setPendingForm]=useState(null);
  const composer=useRef(null);
  const liveContext=useRef({userId:user?.id,path:location.pathname});
  liveContext.current={userId:user?.id,path:location.pathname};
  useEffect(()=>{
    if(!pendingForm||!catalog)return;
    const route=catalog.forms[pendingForm.form]?.route;
    if(!route||route.split(/[?#]/)[0]!==location.pathname)return;
    let attempts=0;
    const timer=setInterval(()=>{
      const binding=getCopilotForm(pendingForm.form);
      if(binding){clearInterval(timer);try{const expected=binding.read();showForm(pendingForm.form);setReview({action:pendingForm,anchor:reviewKey(pendingForm),expected});}catch(e){setError(e.message);}setPendingForm(null);}
      else if(++attempts>=40){clearInterval(timer);setPendingForm(null);setNotice('The form has not loaded yet. Select Review setup to retry; no fields were changed.');}
    },100);
    return()=>clearInterval(timer);
  },[pendingForm,location.pathname,catalog]);
  useEffect(()=>{
    if(!guide||!open||session?.status!=='active')return;
    const form=guide.action.type==='screen_guide'?catalog?.screens.find(s=>s.id===guide.action.screen):catalog?.forms[guide.action.form];
    if(!form||form.route.split(/[?#]/)[0]!==location.pathname)return;
    const step=guide.action.steps[guide.index];
    let cleanup=()=>{};
    const locate=()=>{cleanup();const target=step.control?findSourceGuideField(document,step.control):findGuideField(document,step.field,fieldLabels[step.field]);cleanup=highlightGuideField(target);};
    locate();
    // React may render a form after route transition. Observe child changes only;
    // never read field values, click controls or act on model-provided selectors.
    const observer=new MutationObserver(locate);observer.observe(document.getElementById('main-content')||document.body,{childList:true,subtree:true});
    return()=>{observer.disconnect();cleanup();};
  },[guide,open,session?.status,location.pathname,catalog]);
  const baselines=useRef({}),toggle=useRef(null),reviewPanel=useRef(null),conversationPanel=useRef(null);
  useEffect(()=>{const el=conversationPanel.current;if(el)el.scrollTop=el.scrollHeight;},[session?.conversation?.length,busy]);
  useEffect(()=>{setSession(null);setReview(null);setGuide(null);setWatch(null);setReplyTo(null);setPendingForm(null);baselines.current={};},[user?.id]);
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
    Promise.all([api.copilotCatalog(location.pathname),api.copilotSession()]).then(([c,s])=>{if(active){setCatalog(c);setSession(s.session);setWatch(s.session?.watch?.status==='waiting'?s.session.watch.provider:null);}}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[open,user?.id,location.pathname]);
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
  async function recordFill(action,values){
    try{await update({screen_path:location.pathname,fill_receipt:{type:action.type,...(action.form?{form:action.form}:{}),...(action.screen?{screen:action.screen}:{}),values}});}
    catch{setNotice('Fields were entered, but assistance progress could not be recorded. Verify the form before continuing; nothing was submitted by Copilot.');}
  }
  async function propose(e,request=input){e?.preventDefault();await run(async()=>{
    setReview(null);
    let s=await ensureSession();
    baselines.current=Object.fromEntries(Object.keys(catalog.forms).map(id=>[id,getCopilotForm(id)?.read()]));
    for(const [form,values] of Object.entries(baselines.current))if(values&&hasDraftContent(form,values)){s=await api.copilotUpdate(s.id,{version:s.version,draft:{form,values}});setSession(s);}
    const screen=catalog.screens?.find(x=>x.route.split('#')[0]===location.pathname)?.id;
    let embeddedFields=[],embeddedFieldLabels={},embeddedNavigation=[],embeddedForms=[],embeddedPath='';
    if(['crm','erp'].includes(screen)){
      // Do not turn a missing/expired bridge into an invented model refusal.
      // Preserve the user's message and expose the actual connection failure.
      setNotice('Waiting for the workspace to finish loading…');
      const actor=user?.id,path=location.pathname;
      const metadata=await waitForCopilotReady({stableSamples:2,inspect:()=>requestCopilotEmbed('inspect'),accept:hasCopilotEmbedControls,isCurrent:()=>liveContext.current.userId===actor&&liveContext.current.path===path});
      embeddedFields=metadata.fields||[];embeddedFieldLabels=metadata.field_labels||{};embeddedNavigation=metadata.navigation||[];embeddedForms=metadata.forms||[];embeddedPath=metadata.path||'';
    }
    const originalRequest=request,actor=user?.id;
    let next=await api.copilotPropose(s.id,{version:s.version,message:request,...(replyTo?{reply_to:replyTo.id}:{}),screen_path:location.pathname,visible_control_ids:visibleCopilotControls(document),visible_control_options:visibleCopilotOptions(document),embedded_fields:embeddedFields,embedded_field_labels:embeddedFieldLabels,embedded_navigation:embeddedNavigation,embedded_forms:embeddedForms,embedded_path:embeddedPath,...(screen?{screen}:{})});
    setSession(next);setInput('');setReplyTo(null);setNotice('');setCompletedActions([]);
    const journey=await continueCopilotNavigation({session:next,catalog,isCurrent:()=>liveContext.current.userId===actor,onProgress:setNotice,
      navigate:async(action,target)=>{
        if(action.type==='navigate')navigate(target.route);
        else await requestCopilotEmbed('navigate',null,{path:action.path});
      },
      inspect:async(action,target)=>{
        // Wait for the actual route/iframe to be ready, not an arbitrary delay
        // followed by an assumption that navigation succeeded.
        const embedded=['crm','erp'].includes(target.id);
        const metadata=await waitForCopilotReady({
          stableSamples:2,
          isCurrent:()=>liveContext.current.userId===actor,
          inspect:async()=>liveContext.current.path===target.route.split(/[?#]/)[0]?(embedded?await requestCopilotEmbed('inspect'):{}):null,
          accept:value=>!!value&&(!embedded||hasCopilotEmbedControls(value))&&(action.type!=='embed_navigate'||matchesCopilotDestination(value.path,action.path)),
        });
        const fresh=await api.copilotCatalog(liveContext.current.path);
        return {catalog:fresh,screen:target.id,screen_path:liveContext.current.path,visible_control_ids:visibleCopilotControls(document),visible_control_options:visibleCopilotOptions(document),embedded_fields:metadata.fields||[],embedded_field_labels:metadata.field_labels||{},embedded_navigation:metadata.navigation||[],embedded_forms:metadata.forms||[],embedded_path:metadata.path||''};
      },
      propose:async(current,observed)=>{
        const {catalog:fresh,...context}=observed;
        const updated=await api.copilotPropose(current.id,{version:current.version,message:originalRequest,navigation_continuation:true,...context});
        setCatalog(fresh);setSession(updated);return updated;
      },
    });
    next=journey.session;setCatalog(journey.catalog);setSession(next);
    setNotice(journey.stopped?'Navigation paused to avoid repeating steps. Review the current screen before continuing.':'');
    const creation=next.proposal?.actions.length===1&&next.proposal.actions[0].type==='embed_open_form'?next.proposal.actions[0]:null;
    if(creation){
      const prepared=await requestCopilotEmbed('prepare_open_form',null,{label:creation.label});
      setReview({action:creation,anchor:reviewKey(creation),embedSnapshot:prepared.snapshot});
    }
    const fills=next.proposal?.actions.filter(a=>a.type==='fill')||[];
    const prepared=fills.length===1?fills[0]:null;
    if(prepared){
      const route=journey.catalog.forms[prepared.form]?.route;
      if(route&&route.split(/[?#]/)[0]!==liveContext.current.path){setPendingForm(prepared);navigate(route);}
      else if(getCopilotForm(prepared.form)){showForm(prepared.form);setReview({action:prepared,anchor:reviewKey(prepared),expected:baselines.current[prepared.form]??getCopilotForm(prepared.form).read()});}
    }
  });}
  function showForm(form){
    const route=catalog.forms[form]?.route;
    if(revealRegisteredForm(document,route)&&route.split(/[?#]/)[0]===liveContext.current.path)navigate(route,{replace:true});
  }
  async function go(route,state={}){
    let s=await ensureSession();
    for(const id of Object.keys(catalog.forms)){
      const binding=getCopilotForm(id);
      if(binding){const values=binding.read();if(hasDraftContent(id,values)){s=await api.copilotUpdate(s.id,{version:s.version,draft:{form:id,values}});setSession(s);}}
    }
    navigate(route,{state});
  }
  async function apply(action){
    if(completedActions.includes(reviewKey(action)))throw new Error('This New action was already requested. Inspect its result before asking to create another record.');
    const fresh=await api.copilotCatalog(location.pathname);
    if(action.type==='embed_open_form'){
      if(!fresh.screens.some(s=>s.id===action.screen&&s.route===location.pathname))throw new Error('Open the requested workspace first.');
      const prepared=await requestCopilotEmbed('prepare_open_form',null,{label:action.label});
      setReview({action,anchor:reviewKey(action),embedSnapshot:prepared.snapshot});return;
    }
    if(action.type==='embed_fill'){
      if(!fresh.screens.some(s=>s.id===action.screen&&s.route===location.pathname))throw new Error('Open the requested embedded screen first.');
      const prepared=await requestCopilotEmbed('prepare',null,{fields:Object.keys(action.values)});
      const unavailable=Object.keys(action.values).filter(key=>!prepared.fields.includes(key));
      if(unavailable.length)throw new Error(`Could not open ${unavailable.join(', ')} for review. No values were entered. Keep this record open and select Review setup again.`);
      setReview({action:{...action,labels:prepared.field_labels||{}},anchor:reviewKey(action),embedSnapshot:prepared.snapshot,expected:{}});return;
    }
    if(action.type==='screen_fill'){
      const screen=fresh.screens.find(s=>s.id===action.screen);
      if(!screen||screen.route.split(/[?#]/)[0]!==location.pathname)throw new Error('Return to the proposed screen and ask again.');
      const snapshot=captureDomFields(document,Object.keys(action.values));
      setReview({action,anchor:reviewKey(action),snapshot,expected:Object.fromEntries(Object.entries(snapshot).map(([id,s])=>[id,s.value]))});return;
    }
    if(!fresh.forms[action.form])throw new Error('Your access to this form changed.');
    const binding=getCopilotForm(action.form);
    if(!binding){await go(fresh.forms[action.form].route);setNotice('Form opened. Review the proposal, then apply the fields.');return;}
    const expected=baselines.current[action.form] ?? binding.read();
    if(JSON.stringify(binding.read())!==JSON.stringify(expected))throw new Error('You edited this form after the proposal. Ask again to preserve your latest changes.');
    showForm(action.form);setReview({action,anchor:reviewKey(action),expected});
  }
  async function confirmFields(){
    const fresh=await api.copilotCatalog(location.pathname);
    if(review.action.type==='embed_open_form'){
      if(!fresh.screens.some(s=>s.id===review.action.screen&&s.route===location.pathname))throw new Error('The workspace or your access changed.');
      const action=review.action,snapshot=review.embedSnapshot;setReview(null);
      setCompletedActions(items=>[...items,reviewKey(action)]);
      // Mark consumed before dispatch: an unconfirmed response may still have saved.
      await requestCopilotEmbed('open_form',null,{label:action.label,snapshot});
      setNotice('The New action was requested. Inspecting the resulting record before preparing your values…');
      const actor=user?.id,path=location.pathname;
      const metadata=await waitForCopilotReady({stableSamples:2,inspect:()=>requestCopilotEmbed('inspect'),accept:observed=>hasCopilotEmbedControls(observed)&&(/^\/object\//.test(observed.path)||observed.created_form_ready===true)&&observed.fields?.length>0,isCurrent:()=>liveContext.current.userId===actor&&liveContext.current.path===path,timeoutMessage:'Creation was requested, but the resulting form has not finished loading. Inspect it before continuing; do not create another record.'});
      const message=(session.conversation||[]).filter(t=>t.role==='user').at(-1)?.text;
      const next=await api.copilotPropose(session.id,{version:session.version,message,creation_continuation:true,created_form_ready:metadata.created_form_ready===true,screen:action.screen,screen_path:liveContext.current.path,embedded_path:metadata.path,embedded_fields:metadata.fields,embedded_field_labels:metadata.field_labels,embedded_navigation:metadata.navigation,embedded_forms:metadata.forms});
      setSession(next);setNotice('The form is open. Review the proposed values before entering them; saving remains separate.');
      if(next.proposal?.actions.length===1&&next.proposal.actions[0].type==='embed_fill')await apply(next.proposal.actions[0]);
      return;
    }
    if(review.action.type==='embed_fill'){
      if(!fresh.screens.some(s=>s.id===review.action.screen&&s.route===location.pathname))throw new Error('The embedded screen or permissions changed.');
      const entries=Object.entries(review.action.values),values=session.mode==='guided'?Object.fromEntries(entries.slice(0,1)):review.action.values;
      const result=await requestCopilotEmbed('fill',null,{snapshot:review.embedSnapshot,values});
      const rest=Object.fromEntries(entries.slice(1));
      if(session.mode==='guided'&&Object.keys(rest).length&&result.next_snapshot)setReview({...review,embedSnapshot:result.next_snapshot,action:{...review.action,values:rest}});
      else setReview(null);
      setNotice('Reviewed values entered into the embedded form. This application may save immediately—verify its result before continuing.');await recordFill(review.action,values);return;
    }
    if(review.action.type==='screen_fill'){
      const screen=fresh.screens.find(s=>s.id===review.action.screen);
      if(!screen||screen.route.split(/[?#]/)[0]!==location.pathname)throw new Error('Your screen or access changed. Ask again.');
      const entries=Object.entries(review.action.values);
      const values=session.mode==='guided'?Object.fromEntries(entries.slice(0,1)):review.action.values;
      applyDomFields(review.snapshot,values);
      const rest=Object.fromEntries(entries.slice(1));
      if(session.mode==='guided'&&Object.keys(rest).length){setReview({...review,action:{...review.action,values:rest}});}
      else setReview(null);
      setNotice('Reviewed fields entered. Check the screen’s validation and save status; some controls save immediately. Tell me what you need next.');await recordFill(review.action,values);return;
    }
    if(!fresh.forms[review.action.form])throw new Error('Your form access changed.');
    const binding=getCopilotForm(review.action.form);
    if(!binding)throw new Error('Return to the form before applying changes.');
    const entries=Object.entries(review.action.values);
    const values=session.mode==='guided'?Object.fromEntries(entries.slice(0,1)):review.action.values;
    await binding.apply(values,review.expected);
    const expected={...review.expected,...values};
    await update({draft:{form:review.action.form,values:expected},fill_receipt:{type:'fill',form:review.action.form,values}});
    const rest=Object.fromEntries(entries.slice(1));
    baselines.current[review.action.form]=undefined;
    if(session.mode==='guided'&&Object.keys(rest).length)setReview({...review,expected,action:{...review.action,values:rest}});
    else setReview(null);
    setNotice('Fields applied. Review the actual form and use its Save button. No configuration has been saved yet.');
  }
  async function openAction(action){
    const fresh=await api.copilotCatalog(location.pathname);
    if(action.type==='embed_navigate'){
      if(!fresh.screens.some(s=>s.id===action.screen&&s.route===location.pathname))throw new Error('Open the requested embedded workspace first.');
      await requestCopilotEmbed('navigate',null,{path:action.path});setReview(null);setNotice('Opening the requested section…');
      const actor=user?.id,path=location.pathname;
      await waitForCopilotReady({stableSamples:2,inspect:()=>requestCopilotEmbed('inspect'),accept:observed=>hasCopilotEmbedControls(observed)&&matchesCopilotDestination(observed.path,action.path),isCurrent:()=>liveContext.current.userId===actor&&liveContext.current.path===path});
      setNotice('The requested section is now open. Tell me to continue and I’ll inspect its fields. No record was created or submitted.');return;
    }
    if(action.type==='embed_guide'){
      const screen=fresh.screens.find(s=>s.id===action.screen);
      if(!screen)throw new Error('This screen is no longer available.');
      if(location.pathname!==screen.route){await go(screen.route);setNotice('Open the field in the embedded screen, then select the guidance action again. CRM creation and edits can save immediately.');return;}
      await requestCopilotEmbed('focus',action.field);
      setNotice('The field is highlighted. Enter its value yourself; embedded CRM edits may save immediately.');return;
    }
    if(action.type==='guide'||action.type==='screen_guide'){
      const form=action.type==='guide'?fresh.forms[action.form]:fresh.screens.find(s=>s.id===action.screen);
      if(!form)throw new Error('This form is no longer available.');
      await go(form.route);setGuide({action,index:0});return;
    }
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
  const renderReview=()=>review?.action.type==='embed_open_form'?<section className="copilot-inline-review" ref={reviewPanel} tabIndex={-1} aria-label="Review new record">
    <strong>{review.action.label}</strong><p>This action may create and save a new record immediately. It is not just navigation. Approve only if you want a new record.</p>
    <button className="btn-primary" disabled={busy||session?.status!=='active'} onClick={()=>run(confirmFields)}>Approve new record</button><button disabled={busy} onClick={()=>setReview(null)}>Cancel creation</button>
  </section>:review&&<section className="copilot-inline-review" ref={reviewPanel} tabIndex={-1} aria-label="Review field changes">
    <strong>Review these details</strong>
    <p>{['screen_fill','embed_fill'].includes(review.action.type)?'These values will be entered on this screen. Some fields save immediately.':'Review the remaining values before filling. Filling this form does not save or activate it.'}</p>
    {session?.mode==='guided'&&<p>Next: {review.action.labels?.[Object.keys(review.action.values)[0]]||fieldLabels[Object.keys(review.action.values)[0]]||Object.keys(review.action.values)[0]} · {Object.keys(review.action.values).length} field(s) remaining</p>}
    <dl>{Object.entries(review.action.values).map(([k,v])=><div key={k}><dt>{review.action.labels?.[k]||fieldLabels[k]||k.replaceAll('_',' ')}</dt><dd>{review.action.type==='embed_fill'?'Current value stays private':displayValue(k,review.expected[k])} → {displayValue(k,v)}</dd></div>)}</dl>
    <button className="btn-primary" disabled={busy||session?.status!=='active'} onClick={()=>run(confirmFields)}>{session?.mode==='guided'?'Approve and fill next field':'Approve and apply fields'}</button>
    <button disabled={busy} onClick={()=>setReview(null)}>Keep current fields</button>
  </section>;
  async function startReplay(recording){
    const actor=user?.id,latest=await api.copilotCoachingGet(recording.id);
    replayStep(latest,recording.version,0);
    if(liveContext.current.userId!==actor)return;
    setReplay({recipe:latest,index:0,paused:false});setSettings(false);setNotice('Guided replay started. Each step is re-inspected; no stored values or saves are replayed.');
    if(latest.steps[0].action==='navigate')await replayNavigate(latest.steps[0]);
  }
  async function replayCurrent(){
    if(!replay||replay.paused)throw Error('Resume the replay first.');
    const actor=user?.id,latest=await api.copilotCoachingGet(replay.recipe.id);
    const step=replayStep(latest,replay.recipe.version,replay.index);
    if(liveContext.current.userId!==actor)throw Error('The assistance context changed.');
    return {step,latest};
  }
  async function replayOpen(){
    const {step}=await replayCurrent();
    await replayNavigate(step);
  }
  async function replayNavigate(step){
    const screen=catalog.screens.find(s=>s.id===step.screen);
    const actor=user?.id;
    setNotice('Replaying navigation and waiting for the recorded screen…');
    await openReplayDestination({step,screen,currentPath:()=>liveContext.current.path,navigate,inspect:()=>requestCopilotEmbed('inspect'),navigateEmbedded:path=>requestCopilotEmbed('navigate',null,{path}),isCurrent:()=>liveContext.current.userId===actor});
    setNotice('Recorded screen opened and inspected. Verify the expected result before advancing.');
  }
  async function replayVerify(){
    const {step}=await replayCurrent();
    const screen=catalog.screens.find(s=>s.id===step.screen);
    if(!screen||location.pathname!==screen.route.split(/[?#]/)[0])throw Error('Open the recorded screen before confirming this step.');
    const path=['crm','erp'].includes(step.screen)?(await requestCopilotEmbed('inspect')).path:screen.route;
    if(!replayMatches(step,path))throw Error('The current screen does not match the recording.');
    if(replay.index+1===replay.recipe.steps.length){setNotice('Replay completed with your step confirmations. This is not automatic verification of saved business data.');setReplay(null);}
    else {const index=replay.index+1;setReplay({...replay,index});if(replay.recipe.steps[index].action==='navigate')await replayNavigate(replay.recipe.steps[index]);}
  }
  return <aside className="platform-help-copilot">
    <button ref={toggle} type="button" className="btn-primary copilot-toggle" title="Platform Help" aria-label="Platform Help" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><span aria-hidden="true">✦</span></button>
    {open&&<section className="copilot-panel" aria-label="Platform Help assistant" onKeyDown={e=>{if(e.key==='Escape'){if(settings){setSettings(false);settingsToggle.current?.focus();}else{setOpen(false);toggle.current?.focus();}}}}>
      <header><div><strong>Platform Help</strong><small>Your Flolah copilot</small></div><div className="copilot-header-actions"><button ref={settingsToggle} type="button" aria-label="Copilot options" title="Mode and coaching" aria-expanded={settings} aria-controls="copilot-settings" onClick={()=>setSettings(v=>!v)}>⋯</button><button type="button" className="btn-ghost" aria-label="Close Platform Help" onClick={()=>{setOpen(false);toggle.current?.focus();}}>×</button></div></header>
      {notice&&<p role="status">{notice}</p>}
      {guide&&<article aria-label="Guided setup"><strong>Step {guide.index+1} of {guide.action.steps.length}</strong><p>{guide.action.steps[guide.index].instruction}</p><p>Complete this field on the screen. Nothing is saved automatically.</p><button disabled={busy||session?.status!=='active'||guide.index===0} onClick={()=>setGuide(g=>({...g,index:g.index-1}))}>Back</button><button disabled={busy||session?.status!=='active'} onClick={()=>setGuide(g=>g.index+1<g.action.steps.length?{...g,index:g.index+1}:null)}>{guide.index+1===guide.action.steps.length?'Finish guidance':'Next field'}</button><button onClick={()=>setGuide(null)}>Stop guidance</button></article>}
      {!catalog?<p>Loading permitted screens…</p>:<>
        {['/crm','/erp'].includes(location.pathname)&&<button disabled={busy} onClick={()=>run(async()=>{const result=await requestCopilotEmbed('inspect');setNotice(result.fields?.length?`I can help fill these open fields: ${result.fields.join(', ')}. Tell me the values in chat; I’ll ask you to review before applying.`:'Open the form or editable field you want help with, then check this screen again.');})}>Check this screen</button>}
        <div id="copilot-settings" className="copilot-settings-drawer" hidden={!settings} role="region" aria-label="Copilot options">
        <div className="copilot-settings-heading"><strong>Mode and coaching</strong><button type="button" aria-label="Back to conversation" onClick={()=>{setSettings(false);settingsToggle.current?.focus();}}>×</button></div>
        <section className="copilot-preferences"><label>Assistance style <select disabled={busy} value={session?.mode||'hybrid'} onChange={e=>run(()=>update({mode:e.target.value}))}><option value="hybrid">Prepare setup and guide me</option><option value="guided">Guide me step by step</option><option value="autofill">Prepare fields for my review</option></select></label><p>I can prepare supported forms. You review before saving and handle any sign-in yourself.</p>
        {session&&<div className="copilot-controls"><span>{session.status}</span><button disabled={busy} onClick={()=>run(()=>update({status:session.status==='active'?'paused':'active'}))}>{session.status==='active'?'Pause':'Resume'}</button><button disabled={busy} onClick={()=>run(async()=>{await update({status:'cancelled'});setWatch(null);setNotice('Session cancelled; saved drafts cleared. Existing configuration is unchanged.');})}>Cancel</button><button disabled={busy} onClick={()=>run(()=>go(session.origin))}>Return to origin</button></div>}
        </section>
        <CopilotCoaching key={user?.id} catalog={catalog} path={location.pathname} onReplay={recording=>run(()=>startReplay(recording))} onError={message=>{setError('');setError(message);}}/>
        </div>
        {replay&&<article aria-label="Recording replay"><strong>{replay.recipe.title} · step {replay.index+1} of {replay.recipe.steps.length}</strong><p>{replay.recipe.steps[replay.index].instruction}</p><p>Check: {replay.recipe.steps[replay.index].success}</p><small>Confirm the result yourself before advancing. Saves remain separate.</small><div><button disabled={busy||replay.paused} onClick={()=>run(replayOpen)}>Open recorded screen</button><button disabled={busy||replay.paused} onClick={()=>run(async()=>{const {latest}=await replayCurrent();setInput(replayPrompt(latest,replay.index));composer.current?.focus();setNotice('Step added to chat. Add current values if needed, then send to prepare a reviewed action.');})}>Prepare step in chat</button><button disabled={busy||replay.paused} onClick={()=>run(replayVerify)}>I verified this step</button><button disabled={busy} onClick={()=>setReplay({...replay,paused:!replay.paused})}>{replay.paused?'Resume replay':'Pause replay'}</button><button disabled={busy} onClick={()=>setReplay(null)}>Stop replay</button></div></article>}
        <div ref={conversationPanel} className="copilot-conversation" role="log" aria-label="Conversation">
          {!session?.proposal&&<p className="copilot-bubble">What would you like to do? Tell me in your own words—I’ll help you find the right screen or prepare your setup.</p>}
          {(session?.conversation||[]).map((m,i)=><div key={m.id||i} className={`copilot-bubble copilot-${m.role}`}><small>{m.role==='user'?'You':'Platform Help'}</small><p>{m.text}</p>{m.id&&<button type="button" className="btn-ghost" title="Reply to this message" aria-label={`Reply to ${m.role==='user'?'your':'Platform Help'} message ${i+1}`} onClick={()=>{setReplyTo(m);composer.current?.focus();}}>↩</button>}</div>)}
          {session?.proposal&&!session?.conversation?.length&&<p className="copilot-bubble">{session.proposal.message}</p>}
        </div>
        {session?.proposal&&<div className="copilot-proposal">{session.proposal.actions.map((a,i)=><article key={i}>
          {['fill','screen_fill','embed_fill','embed_open_form'].includes(a.type)?<><strong>{a.label||catalog.forms[a.form]?.label||catalog.screens?.find(s=>s.id===a.screen)?.label}</strong><p>Review before applying anything to the screen.</p><button className="btn-primary" disabled={busy||session.status!=='active'} onClick={()=>run(()=>apply(a))}>{a.type==='embed_open_form'?'Review creation':'Review setup'}</button></>:a.type==='watch_connector'?<button disabled={busy||session.status!=='active'} onClick={()=>run(()=>startWatch(a.provider))}>Check {a.provider} connection</button>:<><p>{a.message||''}</p><button disabled={busy||session.status!=='active'} onClick={()=>run(()=>openAction(a))}>{['guide','screen_guide','embed_guide'].includes(a.type)?'Guide me through':a.type==='agent_call'?'Start call with':'Open'} {a.type==='guide'?catalog.forms[a.form]?.label:catalog.screens?.find(s=>s.id===a.screen)?.label||catalog.agents.find(x=>x.id===a.agent)?.name||'agent chat'}</button></>}
          {review?.anchor===reviewKey(a)&&renderReview()}
        </article>)}</div>}
        {review&&!session?.proposal?.actions.some(a=>review.anchor===reviewKey(a))&&renderReview()}
        {watch&&<p role="status">Waiting for {watch} authorization… <button disabled={busy} onClick={()=>run(async()=>{await update({watch:null});setWatch(null);})}>Stop checking</button></p>}
        <details><summary>Continue unfinished setup</summary><p>Drafts are private to your login and expire after seven days. Saving a form clears its draft.</p>{Object.entries(session?.drafts||{}).filter(([id])=>catalog.forms[id]).map(([id,values])=><article key={id}><strong>{catalog.forms[id].label}</strong><button disabled={busy} onClick={()=>run(()=>apply({form:id,values}))}>Continue setup</button><button disabled={busy} onClick={()=>run(()=>update({clearDraft:id}))}>Discard draft</button></article>)}{!Object.keys(session?.drafts||{}).length&&<p>No unfinished drafts.</p>}</details>
        {help&&<><button type="button" onClick={()=>setHelpChat(v=>!v)}>{helpChat?'Hide':'Open'} product-help chat</button>{helpChat&&<AgentChatPanel agentId={help.id} minHeight={240} placeholder="Ask about Flolah…"/>}</>}
        {replyTo&&<div aria-label="Reply context"><small>Replying to {replyTo.role==='user'?'you':'Platform Help'}</small><p>{replyTo.text.slice(0,180)}</p><button type="button" onClick={()=>setReplyTo(null)}>Cancel reply</button></div>}
        <div className="copilot-composer-area">
        {error&&<div role="alert" className="copilot-error-toast"><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={()=>setError('')}>×</button></div>}
        <form className="copilot-composer" onSubmit={propose}><label className="sr-only" htmlFor="copilot-message">Message Platform Help</label><textarea ref={composer} id="copilot-message" autoFocus value={input} maxLength={4000} onChange={e=>setInput(e.target.value)} placeholder="Ask me to help with anything in Flolah…"/><button className="btn-primary" disabled={busy||!input.trim()||session?.status==='paused'}>{busy?'Thinking…':'Send'}</button></form>
        </div>
      </>}
      {!catalog&&error&&<div role="alert" className="copilot-error-toast"><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={()=>setError('')}>×</button></div>}
    </section>}
  </aside>;
}
