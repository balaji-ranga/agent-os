import {createActionAttempts} from './action-attempts.mjs';
import { randomUUID } from 'node:crypto';
import {pageStructure} from './page-context-contract.mjs';

const invalid = () => { throw new Error('Invalid or stale proposal'); };
export function validateSnapshot(snapshot) {
  if (!snapshot || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 ||
      !Array.isArray(snapshot.fields) || snapshot.fields.length > 60 || snapshot.ambiguousDialogs) invalid();
  const refs = new Set();
  const fields = snapshot.fields.map(field => {
    if (!field || !/^r\d+f\d+$/.test(field.ref) || refs.has(field.ref) || typeof field.label !== 'string' || field.label.length > 160 ||
        /password|secret|token|otp|cvv|credit.?card|api.?key|access.?key|private.?key/i.test(field.label) || !['text','number','email','date','textarea','url','tel','search','select-one','select-multiple','radio','checkbox','combobox'].includes(field.type)) invalid();
    refs.add(field.ref);
    if(field.key!==undefined&&(typeof field.key!=='string'||!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(field.key)||/password|secret|token|otp|cvv|credit.?card|api.?key|access.?key|private.?key/i.test(field.key)))invalid();
    if(field.form!==undefined&&(typeof field.form!=='string'||!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(field.form)))invalid();
    if(field.choices!==undefined&&(!Array.isArray(field.choices)||field.choices.length>20||field.choices.some(value=>typeof value!=='string'||!value.trim()||value.length>160)||!['select-one','select-multiple','radio'].includes(field.type)))invalid();
    if(field.defaultChoice!==undefined&&(!field.choices?.includes(field.defaultChoice)))invalid();
    if(field.constraints!==undefined&&(!field.constraints||Array.isArray(field.constraints)||typeof field.constraints!=='object'||Object.entries(field.constraints).some(([key,value])=>!['min','max','step','maxlength','minlength','pattern'].includes(key)||typeof value!=='string'||value.length>160)))invalid();
    return { ref:field.ref,label:field.label,type:field.type,required:field.required===true,...(field.constraints?{constraints:{...field.constraints}}:{}),...(field.key?{key:field.key}:{}),...(field.form?{form:field.form}:{}),...(field.choices?{choices:[...field.choices],...(field.choicesTruncated===true?{choicesTruncated:true}:{}),...(field.defaultChoice?{defaultChoice:field.defaultChoice}:{})}:{}) };
  });
  if(fields.reduce((total,f)=>total+(f.choices?.length||0),0)>60)invalid();
  if(snapshot.links!==undefined&&(!Array.isArray(snapshot.links)||snapshot.links.length>30))invalid();
  const links=(snapshot.links||[]).map(link=>{
    if(!/^r\d+n\d+$/.test(link.ref)||refs.has(link.ref)||typeof link.label!=='string'||link.label.length>160||typeof link.path!=='string'||!/^\/(?!\/)[^?#\\]*$/.test(link.path)||link.path.length>300)invalid();
    refs.add(link.ref);return {ref:link.ref,label:link.label,path:link.path};
  });
  if(snapshot.targets!==undefined&&(!Array.isArray(snapshot.targets)||snapshot.targets.length>24))invalid();
  const targets=(snapshot.targets||[]).map(target=>{if(!target||!/^r\d+t\d+$/.test(target.ref)||refs.has(target.ref)||target.kind!=='content'||typeof target.label!=='string'||!target.label.trim()||target.label.length>160||typeof target.text!=='string'||target.text.length>480||typeof target.role!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(target.role))invalid();if(target.state!==undefined&&(!target.state||Array.isArray(target.state)||Object.entries(target.state).some(([key,value])=>!['disabled','busy','expanded','selected'].includes(key)||typeof value!=='boolean')))invalid();refs.add(target.ref);return {ref:target.ref,kind:target.kind,role:target.role,label:target.label,text:target.text,...(target.state?{state:{...target.state}}:{})};});
  for(let i=0;i<fields.length;i++){const optionRefs=snapshot.fields[i].optionRefs;if(optionRefs!==undefined){if(fields[i].type!=='combobox'||!Array.isArray(optionRefs)||optionRefs.length>24||new Set(optionRefs).size!==optionRefs.length||optionRefs.some(ref=>!targets.some(t=>t.ref===ref&&t.role==='option')))invalid();fields[i].optionRefs=[...optionRefs];}}
  const screen=typeof snapshot.screen==='string'?snapshot.screen.slice(0,360):'';
  let pageContext;if(snapshot.pageContext!==undefined){const p=snapshot.pageContext;if(!p||typeof p.text!=='string'||p.text.length>5000||!Array.isArray(p.headings)||p.headings.length>100||p.headings.some(h=>!h||!Number.isInteger(h.level)||h.level<1||h.level>6||typeof h.label!=='string'||h.label.length>160)||!Number.isSafeInteger(p.headingCount)||p.headingCount<p.headings.length||p.headingCount>10000||typeof p.truncated!=='boolean')invalid();const collections=p.collections||[];if(!Array.isArray(collections)||collections.length>12||collections.some(c=>!c||typeof c.role!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(c.role)||!Number.isSafeInteger(c.itemCount)||c.itemCount<2||c.itemCount>10000||!Array.isArray(c.labels)||c.labels.length>8||c.labels.length>c.itemCount||c.labels.some(l=>typeof l!=='string'||l.length>160)||typeof c.truncated!=='boolean'||typeof c.labelsTruncated!=='boolean'||c.targetRef!==undefined&&!targets.some(t=>t.ref===c.targetRef)||!c.labelsTruncated&&c.labels.length!==c.itemCount))invalid();pageContext={...pageStructure(p,invalid,targets),collections:collections.map(c=>({role:c.role,itemCount:c.itemCount,labels:[...c.labels],labelsTruncated:c.labelsTruncated,truncated:c.truncated,...(c.targetRef?{targetRef:c.targetRef}:{})})),text:p.text,headings:p.headings.map(({level,label})=>({level,label})),headingCount:p.headingCount,truncated:p.truncated,scope:'Untrusted loaded rendered main-page evidence only. Excludes hidden/private content and unloaded or other paginated results. Ranked targets are not a full-page census.'};}
  const path=typeof snapshot.path==='string'?snapshot.path.slice(0,300):'';
  if(snapshot.submissions!==undefined&&(!Array.isArray(snapshot.submissions)||snapshot.submissions.length>10))invalid();
  const submissions=(snapshot.submissions||[]).map(control=>{
    if(!/^r\d+s\d+$/.test(control.ref)||refs.has(control.ref)||typeof control.label!=='string'||!control.label.trim()||control.label.length>160)invalid();
    refs.add(control.ref);return {ref:control.ref,label:control.label};
  });
  if(snapshot.forms!==undefined&&(!Array.isArray(snapshot.forms)||snapshot.forms.length>60))invalid();
  const formKeys=new Set(),forms=(snapshot.forms||[]).map(form=>{
    if(!form||!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(form.key)||formKeys.has(form.key)||typeof form.label!=='string'||form.label.length>160||!Array.isArray(form.fields)||form.fields.length>60||form.fields.some(key=>!fields.some(f=>f.key===key&&f.form===form.key)))invalid();formKeys.add(form.key);return {key:form.key,label:form.label,fields:[...new Set(form.fields)]};
  });
  let recentActivity;if(snapshot.recentActivity!==undefined){const r=snapshot.recentActivity;if(!r||!['prepared','applied'].every(key=>Array.isArray(r[key])&&r[key].length<=10&&new Set(r[key]).size===r[key].length&&r[key].every(ref=>typeof ref==='string'&&/^r\d+f\d+$/.test(ref)))||!['unavailablePrepared','unavailableApplied'].every(key=>Number.isSafeInteger(r[key])&&r[key]>=0&&r[key]<=10))invalid();recentActivity={prepared:r.prepared.filter(ref=>fields.some(f=>f.ref===ref)),applied:r.applied.filter(ref=>fields.some(f=>f.ref===ref)),unavailablePrepared:Math.min(10,r.unavailablePrepared+r.prepared.filter(ref=>!fields.some(f=>f.ref===ref)).length),unavailableApplied:Math.min(10,r.unavailableApplied+r.applied.filter(ref=>!fields.some(f=>f.ref===ref)).length),authority:'Browser-local advisory field identities only; never values, save proof or execution permission'};}
  let lastOutcome;if(snapshot.lastOutcome!==undefined){const value=snapshot.lastOutcome;if(!value||typeof value.path!=='string'||value.path.length>300||!['prepared','local_state_verified','host_reported_saved','business_verified','unknown','rejected'].includes(value.outcome)||value.lookupOnly!==undefined&&typeof value.lookupOnly!=='boolean'||!Number.isSafeInteger(value.applied)||value.applied<0||value.applied>10||!Array.isArray(value.actionTypes)||value.actionTypes.length>10||value.actionTypes.some(type=>!['fill','highlight','navigate','submit'].includes(type)))invalid();lastOutcome={path:value.path,outcome:value.outcome,applied:value.applied,actionTypes:[...value.actionTypes],...(value.lookupOnly===true?{lookupOnly:true}:{}),authority:'Untrusted browser observation; never permission to execute'};}
  return { revision:snapshot.revision,fields,forms,links,submissions,screen,path,...(pageContext?{pageContext}:{}),...(recentActivity?{recentActivity}:{}),...(lastOutcome?{lastOutcome}:{}),...(targets.length?{targets,domScope:'Task-relevant rendered content only; up to 24 targets from bounded loaded DOM traversal. Unloaded, hidden and private-marked content is excluded.'}:{}) };
}

// Authorization scope must come from SessionAuthority.context, never the model.
export function createProposalStore(repository, { clock = Date.now,checkBinding=()=>false,checkPrivateTask=()=>false,checkGoal=()=>false,attempts=repository.durableActions?createActionAttempts(repository,{clock}):null } = {}) {
  const proposals = repository.map('proposals');
  return {
    bindGoal(scope,id,goalId){const p=proposals.get(id);if(!p||p.embeddingId!==scope.embeddingId||p.sessionId!==scope.sessionId||p.conversationVersion!==(scope.conversationVersion||0))invalid();p.goalId=goalId;proposals.set(id,p);},
    bindPrivateTask(scope,id,binding){const p=proposals.get(id);if(!p||p.embeddingId!==scope.embeddingId||p.sessionId!==scope.sessionId||!checkPrivateTask(scope,binding))invalid();p.taskBinding=binding;proposals.set(id,p);},
    goalEvidence(scope,id){const p=proposals.get(id);if(!p||p.embeddingId!==scope.embeddingId||p.sessionId!==scope.sessionId||p.conversationVersion!==(scope.conversationVersion||0)||p.taskBinding&&!checkPrivateTask(scope,p.taskBinding)||p.goalId&&!checkGoal(scope,p.goalId,p.id,false))invalid();return {proposalId:id,status:p.status,path:p.path,responseMessage:p.message,actions:p.actions.map((a,index)=>({type:a.type,label:a.label,...(a.type==='fill'?{value:a.value,...(a.select===false?{queryOnly:true}:{})}:{}),...(a.type==='navigate'?{destination:a.path}:{}),outcome:p.status==='consumed'?(a.type==='highlight'?'read_only_guidance':attempts?.status(scope,`${id}:${index}`).outcome||'unknown'):'not_dispatched'}))};},
    attemptBinding(scope,id){return attempts.status(scope,id);},
    verifyAttempt(scope,input){return attempts.verify(scope,input);},
    ownsAttempt(scope,id){const row=attempts?.status(scope,id);return !!row&&!!proposals.get(row.proposalId);},
    dispatch(scope,input){const row=attempts?.status(scope,input.actionId),p=row&&proposals.get(row.proposalId);if(!p||p.status!=='consumed'||p.binding&&!checkBinding(scope,p.binding)||p.taskBinding&&!checkPrivateTask(scope,p.taskBinding)||p.goalId&&!checkGoal(scope,p.goalId,p.id,true))invalid();if(!attempts)throw new Error('Action fencing unavailable');return attempts.dispatch(scope,input);},
    observeAttempt(scope,input){if(!attempts)throw new Error('Action fencing unavailable');return attempts.observe(scope,input);},
    testEvidence(scope,id){const p=proposals.get(id);if(!attempts||!p||p.embeddingId!==scope.embeddingId||p.sessionId!==scope.sessionId||p.conversationVersion!==(scope.conversationVersion||0)||p.status!=='consumed'||p.actions.some((a,index)=>!['local_state_verified','host_reported_saved'].includes(attempts.status(scope,`${id}:${index}`).outcome)))invalid();return {binding:p.binding,outcome:'local_state_verified'};},
    revise(scope,{id,snapshot,edits}){return repository.transaction(()=>{
      const old=proposals.get(id),observed=validateSnapshot(snapshot);
      if(!old||old.embeddingId!==scope.embeddingId||old.sessionId!==scope.sessionId||old.conversationVersion!==(scope.conversationVersion||0)||old.status!=='pending'||old.expiresAt<=clock()||old.path!==observed.path||old.binding&&!checkBinding(scope,old.binding)||old.taskBinding&&!checkPrivateTask(scope,old.taskBinding)||old.goalId&&!checkGoal(scope,old.goalId,old.id,true)||!Array.isArray(edits)||edits.length!==old.actions.length||old.actions.some(a=>a.type!=='fill')||new Set(edits.map(e=>e.ref)).size!==edits.length)invalid();
      const actions=old.actions.map(action=>{const prior=old.fields?.find(f=>f.ref===action.ref),edit=edits.find(e=>e.ref===action.ref);const fields=observed.fields.filter(f=>prior&&f.key===prior.key&&f.label===prior.label&&f.type===prior.type&&f.form===prior.form);
        if(fields.length!==1||!edit||typeof edit.value!=='string'||Object.keys(edit).some(k=>!['ref','value'].includes(k)))invalid();const field=fields[0];
        if(field.choices&&field.type!=='select-multiple'&&!field.choices.includes(edit.value))invalid();
        if(field.type==='select-multiple'){let values;try{values=JSON.parse(edit.value);}catch{invalid();}if(!Array.isArray(values)||values.some(v=>!field.choices?.includes(v)))invalid();}
        return {type:'fill',ref:field.ref,value:edit.value,...(action.select===false?{select:false}:{})};});
      const replacement=this.prepare(scope,observed,{message:'Review your edited values. Nothing has been changed.',actions},old.binding);
      if(old.goalId)this.bindGoal(scope,replacement.id,old.goalId);if(old.taskBinding)this.bindPrivateTask(scope,replacement.id,old.taskBinding);old.status='replaced';proposals.set(id,old);return {...replacement,replaces:id};
    });},
    reject(scope,id){return repository.transaction(()=>{const p=proposals.get(id);if(!p||p.embeddingId!==scope.embeddingId||p.sessionId!==scope.sessionId||p.conversationVersion!==(scope.conversationVersion||0)||!['pending','rejected'].includes(p.status))invalid();p.status='rejected';proposals.set(id,p);return {rejected:true};});},
    prepareSave(scope,snapshot,ref){return this.prepare(scope,snapshot,{message:'Review this separate form submission. It may save data or trigger other host side effects.',actions:[{type:'submit',ref}]},null,{allowSubmit:true});},
    prepare(scope, snapshot, response, binding=null,{allowSubmit=false}={}) {
      const observed = validateSnapshot(snapshot);
      if (!scope?.sessionId || !scope.embeddingId || !response || typeof response.message !== 'string' || response.message.length > 4000 ||
          !Array.isArray(response.actions) || response.actions.length > 10 || Object.keys(response).some(k => !['intent','message','actions'].includes(k))) invalid();
      if(response.intent!==undefined&&(!['guide','explain','edit','navigate','clarify'].includes(response.intent)||response.actions.some(a=>!({guide:['highlight'],explain:[],edit:['fill'],navigate:['navigate'],clarify:[]}[response.intent]).includes(a.type))))invalid();
      const used = new Set();
      const actions = response.actions.map(action => {
        if(action.type==='submit'){
          const control=observed.submissions.find(s=>s.ref===action.ref);
          if(!allowSubmit||!control||response.actions.length!==1||Object.keys(action).some(k=>!['type','ref'].includes(k)))invalid();
          return {type:'submit',ref:control.ref,label:control.label};
        }
        if(action.type==='navigate'){
          const link=observed.links.find(l=>l.ref===action.ref);
          if(!link||response.actions.length!==1||Object.keys(action).some(k=>!['type','ref'].includes(k)))invalid();
          if(binding?.activation!==undefined&&!['click','mousedown','pointerdown'].includes(binding.activation))invalid();
          return {type:'navigate',ref:link.ref,label:link.label,path:link.path,...(binding?.activation?{activation:binding.activation}:{})};
        }
        const field = observed.fields.find(f=>f.ref===action.ref);
        if(action.type==='highlight'){
          const target=field||observed.targets?.find(t=>t.ref===action.ref)||observed.links.find(l=>l.ref===action.ref);if(!target||used.has(action.ref)||Object.keys(action).some(k=>!['type','ref'].includes(k)))invalid();used.add(action.ref);return {type:'highlight',ref:target.ref,label:target.label};
        }
        if(field?.type==='checkbox'&&!['true','false'].includes(action.value))invalid();
        if (!field || used.has(action.ref) || action.type !== 'fill' || typeof action.value !== 'string' || action.value.length > 8000 ||
            Object.keys(action).some(k=>!['type','ref','value','query','select'].includes(k))||action.select!==undefined&&(field.type!=='combobox'||typeof action.select!=='boolean'||action.select===false&&action.query!==undefined)||action.query!==undefined&&(field.type!=='combobox'||typeof action.query!=='string'||!action.query.trim()||action.query.length>160)) invalid();
        used.add(action.ref);
        return { type:'fill',ref:field.ref,label:field.label,value:action.value,...(action.query!==undefined?{query:action.query}:{}),...(action.select!==undefined?{select:action.select}:{}) };
      });
      if(!allowSubmit&&snapshot.partialEdit&&actions.length&&observed.fields.some(field=>!actions.some(action=>['fill','highlight'].includes(action.type)&&action.ref===field.ref))) {
        return {id:null,revision:observed.revision,message:'The proposal did not cover every requested field. Nothing was changed. Please clarify the requested values or prepare a new review.',actions:[],expiresAt:clock()};
      }
      const proposal = { id:randomUUID(),embeddingId:scope.embeddingId,sessionId:scope.sessionId,conversationVersion:scope.conversationVersion||0,revision:observed.revision,
        createdAt:clock(),path:observed.path,fields:observed.fields,teachingSteps:actions.filter(a=>a.type==='fill').map(action=>{const field=observed.fields.find(f=>f.ref===action.ref);return {action:'fill',path:observed.path,field:field.key||null,parameter:field.key||null};}),
        message:allowSubmit?`Confirm ${actions[0].label} separately. This submits the current host form and may save data.`:actions.length?(actions[0].type==='navigate'?`I can open ${actions[0].label}, then continue your request on that screen.`:actions.every(a=>a.type==='highlight')?`I can highlight ${actions.length} target${actions.length===1?'':'s'} for you. No values will be changed.`:`Review these ${actions.length} proposed field change${actions.length===1?'':'s'}. Nothing has been changed yet.`):response.message,actions,expiresAt:clock()+120_000,status:'pending',binding };
      if(!allowSubmit&&actions.length){const explanation=response.message.replace(/\bNothing (?:has(?: been)?|was|is) (?:changed|applied|saved|submitted)\b\.?/gi,'').trim();if(explanation&&!/\b(?:saved|submitted|completed|filled|created|updated|changed)\b/i.test(explanation))proposal.message=`${explanation}\n${proposal.message}`.slice(0,4000);}
      proposals.set(proposal.id,proposal);
      return { id:proposal.id,revision:proposal.revision,message:proposal.message,actions:actions.map(a=>a.type==='fill'&&observed.fields.find(f=>f.ref===a.ref)?.type==='checkbox'?{...a,displayValue:a.value==='true'?'Selected':'Cleared'}:a),expiresAt:proposal.expiresAt,fields:observed.fields };
    },
    verifiedLearningSteps(scope,{saveProposalId,path}){
      const save=proposals.get(saveProposalId);
      if(!save||save.embeddingId!==scope.embeddingId||save.sessionId!==scope.sessionId||save.conversationVersion!==(scope.conversationVersion||0)||save.status!=='consumed'||save.actions.length!==1||save.actions[0].type!=='submit'||save.path!==path||save.createdAt+600_000<=clock())invalid();
      const fill=proposals.values({embeddingId:scope.embeddingId,sessionId:scope.sessionId}).filter(p=>p.status==='consumed'&&p.conversationVersion===(scope.conversationVersion||0)&&p.path===path&&p.teachingSteps?.length&&p.createdAt<=save.createdAt&&p.createdAt+600_000>clock()).sort((a,b)=>b.createdAt-a.createdAt)[0];
      if(!fill||fill.teachingSteps.some(step=>!step.field))invalid();return structuredClone(fill.teachingSteps);
    },
    consume(scope,{ id,revision,approved }) {
      return repository.transaction(()=>{
        const proposal = proposals.get(id);
        if (!proposal || proposal.embeddingId !== scope.embeddingId || proposal.sessionId !== scope.sessionId ||
            (proposal.conversationVersion||0)!==(scope.conversationVersion||0)||proposal.status !== 'pending' || proposal.expiresAt <= clock() || proposal.revision !== revision || approved !== true || proposal.binding&&!checkBinding(scope,proposal.binding)||proposal.taskBinding&&!checkPrivateTask(scope,proposal.taskBinding)||proposal.goalId&&!checkGoal(scope,proposal.goalId,proposal.id,true)) invalid();
        proposal.status='consumed'; proposals.set(id,proposal);
        return { revision:proposal.revision,...(proposal.binding?{binding:proposal.binding}:{}),actions:proposal.actions.map((action,index)=>action.type==='highlight'||!attempts?action:{...action,...attempts.reserve(scope,{id:`${proposal.id}:${index}`,proposalId:proposal.id,index,path:proposal.path,grantExpiresAt:proposal.expiresAt})}) };
      });
    },
  };
}
