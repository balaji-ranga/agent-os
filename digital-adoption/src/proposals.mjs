import { randomUUID } from 'node:crypto';

const invalid = () => { throw new Error('Invalid or stale proposal'); };
export function validateSnapshot(snapshot) {
  if (!snapshot || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 ||
      !Array.isArray(snapshot.fields) || snapshot.fields.length > 60 || snapshot.ambiguousDialogs) invalid();
  const refs = new Set();
  const fields = snapshot.fields.map(field => {
    if (!field || !/^r\d+f\d+$/.test(field.ref) || refs.has(field.ref) || typeof field.label !== 'string' || field.label.length > 160 ||
        /password|secret|token|otp|cvv|credit.?card|api.?key|access.?key|private.?key/i.test(field.label) || !['text','number','email','date','textarea','url','tel','search','select-one','checkbox'].includes(field.type)) invalid();
    refs.add(field.ref);
    if(field.key!==undefined&&(typeof field.key!=='string'||!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(field.key)||/password|secret|token|otp|cvv|credit.?card|api.?key|access.?key|private.?key/i.test(field.key)))invalid();
    return { ref:field.ref,label:field.label,type:field.type,required:field.required===true,...(field.key?{key:field.key}:{}) };
  });
  if(snapshot.links!==undefined&&(!Array.isArray(snapshot.links)||snapshot.links.length>30))invalid();
  const links=(snapshot.links||[]).map(link=>{
    if(!/^r\d+n\d+$/.test(link.ref)||refs.has(link.ref)||typeof link.label!=='string'||link.label.length>160||typeof link.path!=='string'||!/^\/(?!\/)[^?#\\]*$/.test(link.path)||link.path.length>300)invalid();
    refs.add(link.ref);return {ref:link.ref,label:link.label,path:link.path};
  });
  const screen=typeof snapshot.screen==='string'?snapshot.screen.slice(0,360):'';
  const path=typeof snapshot.path==='string'?snapshot.path.slice(0,300):'';
  return { revision:snapshot.revision,fields,links,screen,path };
}

// Authorization scope must come from SessionAuthority.context, never the model.
export function createProposalStore(repository, { clock = Date.now,checkBinding=()=>false } = {}) {
  const proposals = repository.map('proposals');
  return {
    prepare(scope, snapshot, response, binding=null) {
      const observed = validateSnapshot(snapshot);
      if (!scope?.sessionId || !scope.embeddingId || !response || typeof response.message !== 'string' || response.message.length > 4000 ||
          !Array.isArray(response.actions) || response.actions.length > 10 || Object.keys(response).some(k => !['message','actions'].includes(k))) invalid();
      const used = new Set();
      const actions = response.actions.map(action => {
        if(action.type==='navigate'){
          const link=observed.links.find(l=>l.ref===action.ref);
          if(!link||response.actions.length!==1||Object.keys(action).some(k=>!['type','ref'].includes(k)))invalid();
          return {type:'navigate',ref:link.ref,label:link.label,path:link.path};
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
      if(snapshot.partialEdit&&actions.length&&observed.fields.some(field=>!actions.some(action=>['fill','highlight'].includes(action.type)&&action.ref===field.ref))) {
        return {id:null,revision:observed.revision,message:'The proposal did not cover every requested field. Nothing was changed. Please clarify the requested values or prepare a new review.',actions:[],expiresAt:clock()};
      }
      const proposal = { id:randomUUID(),embeddingId:scope.embeddingId,sessionId:scope.sessionId,conversationVersion:scope.conversationVersion||0,revision:observed.revision,
        message:actions.length?(actions[0].type==='navigate'?`I can open ${actions[0].label}, then continue your request on that screen.`:actions.every(a=>a.type==='highlight')?`I can highlight ${actions.length} field${actions.length===1?'':'s'} for you. No values will be changed.`:`Review these ${actions.length} proposed field change${actions.length===1?'':'s'}. Nothing has been changed yet.`):response.message,actions,expiresAt:clock()+120_000,status:'pending',binding };
      proposals.set(proposal.id,proposal);
      return { id:proposal.id,revision:proposal.revision,message:proposal.message,actions,expiresAt:proposal.expiresAt };
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
