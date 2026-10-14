import {useState} from 'react';
import {api} from '../api';
import {requestCopilotEmbed} from '../utils/copilotEmbed.js';

export default function CopilotCoaching({catalog,path,onReplay,onError}){
 const [recipes,setRecipes]=useState([]),[examples,setExamples]=useState([]),[next,setNext]=useState(null);
 const [recipe,setRecipe]=useState(null),[title,setTitle]=useState(''),[instruction,setInstruction]=useState(''),[success,setSuccess]=useState(''),[action,setAction]=useState('navigate');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[reviewed,setReviewed]=useState(false);
 const [map,setMap]=useState(null);
 async function run(fn){setBusy(true);setMessage('');try{await fn();}catch(e){if(onError)onError(e.message);else setMessage(e.message);}finally{setBusy(false);}}
 async function load(offset=0){const r=await api.copilotCoaching(offset);setRecipes(old=>offset?[...old,...r.recipes]:r.recipes);setExamples(r.examples);setNext(r.next_offset);}
 async function capture(){
  const screen=catalog.screens.find(s=>s.route.split(/[?#]/)[0]===path);
  if(!screen)throw Error('This screen is not available for coaching.');
  const embedded=['crm','erp'].includes(screen.id)?await requestCopilotEmbed('inspect'):null;
  const observed=[...document.querySelectorAll('[data-copilot-control]')].filter(e=>!e.closest('.platform-help-copilot,.copilot-coaching')&&e.getClientRects().length&&!e.disabled&&!e.hidden).map(e=>e.getAttribute('data-copilot-control'));
  const step={screen:screen.id,path:embedded?.path||screen.route,fields:embedded?.fields||observed,action,instruction,success};
  const updated=await api.copilotCoachingUpdate(recipe.id,{version:recipe.version,step});
  setRecipe(updated);setReviewed(false);setInstruction('');setSuccess('');setMessage('Step captured. Continue your demonstration on the next screen; no form values were recorded.');await load();
 }
 return <details className="copilot-coaching" onToggle={e=>{if(e.currentTarget.open)run(()=>load());}}>
  <summary>Teach Copilot</summary>
  <p>Demonstrate a task, then capture each meaningful step. Only screen paths and field identifiers are captured—not entered values. Keep personal data and secrets out of your descriptions.</p>
  <p>Recipes stay private to your company login. Publishing supplies guidance, not execution permission or proof of a successful test.</p>
  <label>Lesson name<input value={title} maxLength={100} onChange={e=>setTitle(e.target.value)} placeholder="For example: prepare a customer"/></label>
  <button disabled={busy||!title.trim()} onClick={()=>run(async()=>{setRecipe(await api.copilotCoachingCreate(title));setReviewed(false);await load();})}>Start lesson</button>
  <details><summary>CRM and ERP starter lessons</summary>{examples.map(e=><article key={e.id}><strong>{e.title}</strong><small>Starter · not live-verified</small><ol>{e.steps.map((s,i)=><li key={i}>{s}</li>)}</ol><button disabled={busy} onClick={()=>{setTitle(e.title);setInstruction(e.steps[0]);setMessage('Start the lesson, demonstrate the step, then capture its observed screen.');}}>Use this lesson outline</button></article>)}</details>
  {recipe&&<section aria-label="Coaching lesson"><strong>{recipe.title} · version {recipe.version} · {recipe.status}</strong>
   {recipe.status==='published'&&onReplay&&<button disabled={busy} onClick={()=>run(()=>onReplay(recipe))}>Replay recording</button>}
   {recipe.status!=='archived'&&<>
    <label>What did you demonstrate?<select value={action} onChange={e=>setAction(e.target.value)}><option value="navigate">Navigate</option><option value="open_form">Open a form</option><option value="fill">Fill fields</option><option value="wait">Wait for readiness</option><option value="manual_save">Save manually</option><option value="verify">Verify the result</option></select></label>
    <label>Explain the step<textarea maxLength={240} value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder="Describe the control and its purpose, without example personal values"/></label>
    <label>How can Copilot recognize success?<textarea maxLength={240} value={success} onChange={e=>setSuccess(e.target.value)} placeholder="For example: the saved record title is visible after reopening"/></label>
    <button disabled={busy||!instruction.trim()||!success.trim()} onClick={()=>run(capture)}>Capture this screen step</button>
   </>}
   <ol>{recipe.steps.map((s,i)=><li key={i}><strong>{s.screen} · {s.action}</strong><p>{s.instruction}</p><small>{s.path} · {s.fields.length} fields</small><p>Check: {s.success}</p></li>)}</ol>
   {recipe.steps.length>0&&recipe.status!=='archived'&&<button disabled={busy} onClick={()=>run(async()=>{setRecipe(await api.copilotCoachingUpdate(recipe.id,{version:recipe.version,remove_last:true}));setReviewed(false);await load();})}>Undo last captured step</button>}
   {recipe.status==='draft'&&<><label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed these steps and removed sensitive details.</label><button disabled={busy||!reviewed||!recipe.steps.length} onClick={()=>run(async()=>{setRecipe(await api.copilotCoachingUpdate(recipe.id,{version:recipe.version,status:'published',reviewed:true}));await load();setMessage('Published as guidance. Live controls and approvals are still required.');})}>Publish private recipe</button></>}
   {recipe.status!=='archived'&&<button disabled={busy} onClick={()=>run(async()=>{setRecipe(await api.copilotCoachingUpdate(recipe.id,{version:recipe.version,status:'archived'}));await load();setMessage('Archived. This recipe will no longer guide new proposals.');})}>Archive recipe</button>}
  </section>}
  <details><summary>My recorded lessons</summary>{recipes.map(r=><button key={r.id} disabled={busy} onClick={()=>{setRecipe(r);setReviewed(false);}}>{r.title} · v{r.version} · {r.status}</button>)}{next!==null&&<button disabled={busy} onClick={()=>run(()=>load(next))}>Load more lessons</button>}</details>
  <details><summary>Learned screen map</summary><p>Built from your published lessons, not a claim of complete website coverage.</p><button disabled={busy} onClick={()=>run(async()=>setMap(await api.copilotCoachingMap()))}>Refresh screen map</button>{map&&<><p>{map.nodes.length} learned screens · {map.edges.length} recorded transitions{map.truncated?' · Limited to the latest 100 recipes':''}</p><ul>{map.nodes.map(n=><li key={n.id}>{n.screen}: {n.path} · {n.fields.length} field identifiers</li>)}</ul><details><summary>View screen contracts JSON</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(map,null,2)}</pre></details></>}</details>
  {message&&<p role="status">{message}</p>}
 </details>;
}
