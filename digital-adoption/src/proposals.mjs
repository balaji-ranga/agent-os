import { randomUUID } from 'node:crypto';

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
    return { ref:field.ref,label:field.label,type:field.type,required:field.required===true,...(field.key?{key:field.key}:{}),...(field.form?{form:field.form}:{}) };
  });
  if(snapshot.links!==undefined&&(!Array.isArray(snapshot.links)||snapshot.links.length>30))invalid();
  const links=(snapshot.links||[]).map(link=>{
    if(!/^r\d+n\d+$/.test(link.ref)||refs.has(link.ref)||typeof link.label!=='string'||link.label.length>160||typeof link.path!=='string'||!/^\/(?!\/)[^?#\\]*$/.test(link.path)||link.path.length>300)invalid();
    refs.add(link.ref);return {ref:link.ref,label:link.label,path:link.path};
  });
  const screen=typeof snapshot.screen==='string'?snapshot.screen.slice(0,360):'';
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
  return { revision:snapshot.revision,fields,forms,links,submissions,screen,path };
}

// Authorization scope must come from SessionAuthority.context, never the model.
export function createProposalStore(repository, { clock = Date.now,checkBinding=()=>false } = {}) {
  const proposals = repository.map('proposals');
  return {
    reject(scope,id){return repository.transaction(()=>{const p=proposals.get(id);if(!p||p.embeddingId!==scope.embeddingId||p.sessionId!==scope.sessionId||p.conversationVersion!==(scope.conversationVersion||0)||!['pending','rejected'].includes(p.status))invalid();p.status='rejected';proposals.set(id,p);return {rejected:true};});},
    prepareSave(scope,snapshot,ref){return this.prepare(scope,snapshot,{message:'Review this separate form submission. It may save data or trigger other host side effects.',actions:[{type:'submit',ref}]},null,{allowSubmit:true});},
    prepare(scope, snapshot, response, binding=null,{allowSubmit=false}={}) {
      const observed = validateSnapshot(snapshot);
      if (!scope?.sessionId || !scope.embeddingId || !response || typeof response.message !== 'string' || response.message.length > 4000 ||
          !Array.isArray(response.actions) || response.actions.length > 10 || Object.keys(response).some(k => !['message','actions'].includes(k))) invalid();
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
          if(!field||used.has(action.ref)||Object.keys(action).some(k=>!['type','ref'].includes(k)))invalid();used.add(action.ref);return {type:'highlight',ref:field.ref,label:field.label};
        }
        if(field?.type==='checkbox'&&!['true','false'].includes(action.value))invalid();
        if (!field || used.has(action.ref) || action.type !== 'fill' || typeof action.value !== 'string' || action.value.length > 8000 ||
            Object.keys(action).some(k=>!['type','ref','value'].includes(k))) invalid();
        used.add(action.ref);
        return { type:'fill',ref:field.ref,label:field.label,value:action.value };
      });
      if(!allowSubmit&&snapshot.partialEdit&&actions.length&&observed.fields.some(field=>!actions.some(action=>['fill','highlight'].includes(action.type)&&action.ref===field.ref))) {
        return {id:null,revision:observed.revision,message:'The proposal did not cover every requested field. Nothing was changed. Please clarify the requested values or prepare a new review.',actions:[],expiresAt:clock()};
      }
      const proposal = { id:randomUUID(),embeddingId:scope.embeddingId,sessionId:scope.sessionId,conversationVersion:scope.conversationVersion||0,revision:observed.revision,
        createdAt:clock(),path:observed.path,teachingSteps:actions.filter(a=>a.type==='fill').map(action=>{const field=observed.fields.find(f=>f.ref===action.ref);return {action:'fill',path:observed.path,field:field.key||null,parameter:field.key||null};}),
        message:allowSubmit?`Confirm ${actions[0].label} separately. This submits the current host form and may save data.`:actions.length?(actions[0].type==='navigate'?`I can open ${actions[0].label}, then continue your request on that screen.`:actions.every(a=>a.type==='highlight')?`I can highlight ${actions.length} field${actions.length===1?'':'s'} for you. No values will be changed.`:`Review these ${actions.length} proposed field change${actions.length===1?'':'s'}. Nothing has been changed yet.`):response.message,actions,expiresAt:clock()+120_000,status:'pending',binding };
      proposals.set(proposal.id,proposal);
      return { id:proposal.id,revision:proposal.revision,message:proposal.message,actions:actions.map(a=>a.type==='fill'&&observed.fields.find(f=>f.ref===a.ref)?.type==='checkbox'?{...a,displayValue:a.value==='true'?'Selected':'Cleared'}:a),expiresAt:proposal.expiresAt };
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
            (proposal.conversationVersion||0)!==(scope.conversationVersion||0)||proposal.status !== 'pending' || proposal.expiresAt <= clock() || proposal.revision !== revision || approved !== true || proposal.binding&&!checkBinding(scope,proposal.binding)) invalid();
        proposal.status='consumed'; proposals.set(id,proposal);
        return { revision:proposal.revision,actions:proposal.actions };
      });
    },
  };
}
