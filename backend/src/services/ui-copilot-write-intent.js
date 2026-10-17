import {copilotError} from './ui-copilot-contract.js';
import {copilotScreenSpec} from './ui-copilot-screen-specs.js';
const words=value=>String(value||'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
const path=route=>String(route||'').split(/[?#]/)[0];
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

// Deliberately conservative: only a complete save/submit instruction with no
// new field values bypasses generation. Mixed edit+save requests still prepare
// a reviewed PATCH, never a submission. Screen names come from the actor catalog.
export function copilotSaveOnly(message,catalog){
 const text=String(message||'').trim().replace(/\s*,?\s+(?:and\s+)?(?:(?:do not|don't)\s+(?:change|modify|update)|without\s+changing)\s+(?:anything(?:\s+else)?|any(?:\s+other)?\s+fields?|other\s+fields?|existing\s+values)[.!?]*$/i,'').replace(/\s*,?\s+(?:and\s+)?leave\s+(?:all\s+)?other\s+fields\s+unchanged[.!?]*$/i,'');
 const match=/^(?:(?:please|now|then|just|kindly)\s+)*(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:(?:click|press)\s+(?:the\s+)?)?(?:save|submit|persist)\b([\s\S]*)$/i.exec(text);
 if(!match)return false;
 const nouns=new Set(words('the my our this that it all current updated edited existing pending new changes change form forms settings setup details configuration data draft record entry item user button in on for of now please only'));
 for(const s of catalog.screens||[])for(const w of words(s.label||s.id))nouns.add(w);
 for(const f of Object.values(catalog.forms||{}))for(const w of words(f.label))nouns.add(w);
 return words(match[1]).every(w=>nouns.has(w));
}
export function copilotManualSaveProposal(screen){
 return {message:['crm','erp'].includes(screen?.id)
  ?'I have not submitted anything for this request. This embedded application may auto-save edits. Verify the current record and use its own Save or Submit control if one is present. I will not prepare additional field changes.'
  :'I have not saved or submitted the form. Review the current values, then click the form’s own Save or Submit button. No additional field changes have been prepared.',actions:[]};
}
function mentions(message,label){
 const caption=String(label||'').replace(/\([^)]*\)/g,' ').trim();
 const tokens=words(caption);if(!tokens.length)return [];
 const phrase=(tokens.length>8?tokens.slice(0,2):tokens).join(' ');
 if(['field','value','optional','required'].includes(phrase))return [];
 const text=String(message).replace(/"[^"\n]*"|'[^'\n]*'/g,' '),normalized=words(text).join(' ');
 const found=[];
 for(const m of normalized.matchAll(new RegExp('(?:^| )'+escape(phrase)+'(?= |$)','g'))){
  const before=normalized.slice(0,m.index).trim(),after=normalized.slice(m.index+m[0].length).trim();
  if(/\b(?:to|as|with|not|never|except|leave|keep)(?: the| my)?$/.test(before)||/^(?:unchanged|untouched|alone|as is)\b/.test(after))continue;
  if(tokens.length===1&&before&&!/\b(?:set|change|edit|update|clear|fill|prepare|make|the|my|our|only|just|visible|and|also|field)$/.test(before))continue;
  found.push({start:m.index,end:m.index+m[0].length});
 }
 return found;
}
export function assertCopilotWriteIntent(proposal,catalog,message,{embeddedLabels={}}={}){
 if(!proposal||!Array.isArray(proposal.actions))throw copilotError('No current reviewed proposal is available',409);
 const writes=proposal.actions.filter(a=>['fill','screen_fill','embed_fill','embed_open_form'].includes(a.type));
 if(!writes.length)return;
 if(copilotSaveOnly(message,catalog))throw Object.assign(copilotError('A save-only request must not prepare field changes'),{code:'copilot_write_intent'});
 // Creation may legitimately derive a title/prompt from purpose. Existing-form
 // edits have no permission to populate unrelated required/default fields.
 if(/^(?:please\s+)?(?:(?:create|configure|set up|draft)\b|prepare\s+(?:a\s+)?(?:new|draft)\b)/i.test(message.trim()))return;
 if(/^(?:please\s+)?prepare\b/i.test(message)&&writes.some(a=>{
  const form=a.type==='fill'?catalog.forms[a.form]:null;
  const label=words(form?.label).filter(w=>!['new','draft'].includes(w)).join(' ');
  return form&&/\bnew\b/i.test(form.purpose||'')&&label&&words(message).join(' ').includes(label);
 }))return;
 const descriptors=[];
 const routes=new Set(writes.map(a=>path(a.type==='fill'?catalog.forms[a.form]?.route:catalog.screens.find(s=>s.id===a.screen)?.route)).filter(Boolean));
 for(const [form,f] of Object.entries(catalog.forms))if(routes.has(path(f.route)))for(const key of Object.keys(f.fields))descriptors.push({type:'fill',form,key,labels:[key.replaceAll('_',' ')]});
 for(const s of catalog.screens){
  if(!routes.has(path(s.route)))continue;
  for(const field of copilotScreenSpec(s.route).modules?.flatMap(m=>m.fields)||[])descriptors.push({type:'screen_fill',screen:s.id,key:field.id,labels:[field.label]});
 }
 for(const [key,label] of Object.entries(embeddedLabels))descriptors.push({type:'embed_fill',key,labels:[label]});
 const matches=descriptors.map(d=>({...d,spans:d.labels.flatMap(label=>mentions(message,label))}));
 // "Name" inside "Default connection name" is not a second requested field.
 // A separate "name ... and default connection name ..." mention still counts.
 const spans=matches.flatMap(d=>d.spans);
 const requested=matches.filter(d=>d.spans.some(a=>!spans.some(b=>b.start<=a.start&&b.end>=a.end&&(b.start<a.start||b.end>a.end))));
 if(!requested.length)return; // Ambiguous/referring follow-ups retain existing review semantics.
 for(const a of writes)for(const key of Object.keys(a.values||{})){
  if(!requested.some(d=>d.type===a.type&&d.key===key&&(a.type!=='fill'||d.form===a.form)&&(a.type!=='screen_fill'||d.screen===a.screen)))throw Object.assign(copilotError('Prepare only fields explicitly requested; leave other fields unchanged'),{code:'copilot_write_intent'});
 }
}
export function copilotProposalView(session,catalog){
 if(!session?.proposal)return session;
 const latest=session.conversation?.filter(t=>t.role==='user').at(-1)?.text;
 if(!latest)return session;
 if(copilotSaveOnly(latest,catalog))return {...session,proposal:copilotManualSaveProposal(catalog.screens.find(s=>session.proposal.actions?.some(a=>a.screen===s.id)))};
 try{assertCopilotWriteIntent(session.proposal,catalog,latest);return session;}
 catch(error){if(error.code!=='copilot_write_intent')throw error;return {...session,proposal:{message:'This earlier proposal included fields outside the requested edit. It cannot be applied. Ask again with the fields you want changed; existing values are unchanged by this check.',actions:[]}};}
}
export function clearCopilotFormEdits(state,form,catalog){
 const route=path(catalog.forms[form]?.route);const related=a=>a.form===form||(route&&path(catalog.screens.find(s=>s.id===a.screen)?.route)===route);
 const drafts={...state.drafts};delete drafts[form];
 const actions=state.proposal?.actions.filter(a=>!related(a));
 return {...state,drafts,fill_receipts:(state.fill_receipts||[]).filter(r=>!related(r)),proposal:state.proposal?{...state.proposal,actions,message:actions.length?state.proposal.message:'Related pending edits were cleared after the form reported a successful save. Inspect the form to verify its result.'}:null};
}
