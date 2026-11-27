// Typed, governed observations use the same semantic selection and authority
// lifecycle as other registered platform capabilities. No utterance matching.
import {PARAM_SCHEMAS} from '../../../openclaw-extensions/agent-os-content-tools/tool-parameter-schemas.js';
const sectionNames=['summary','departments','people','agents','skills'];
const validKeys=(args,keys)=>args&&typeof args==='object'&&!Array.isArray(args)&&Object.keys(args).every(k=>keys.includes(k));
const pageValid=(a,max=50)=>(a.limit===undefined||Number.isInteger(a.limit)&&a.limit>=1&&a.limit<=max)&&(a.offset===undefined||Number.isInteger(a.offset)&&a.offset>=0);
const fresh=(v,claimed)=>{if(!v||!Number.isFinite(Date.parse(v.captured_at))||Date.parse(v.captured_at)<claimed-1000)throw Error('A fresh live observation is required.');return v;};
const page=(title,value)=>['*'+title+'*',...(value.items||[]).map(v=>'- '+(v.name||v.id)+(v.role?' — '+v.role:'')+(v.ready!==undefined?' · '+(v.ready?'ready':'not ready'):'')),...(!value.total?['No records returned.']:[]),...(value.has_more?['Showing '+value.items.length+' of '+value.total+'; more records remain.']:[])].join('\n');
export const NATIVE_OBSERVATION_CONTRACTS={
 organization_read:{
  observation:true,description:'Read current Flolah organisation records: company identity, departments, people, entitled agents or assigned skills. Use section departments/people/agents/skills for that list, summary for the organisation overview. This does not read ERP customers, contacts or company objectives. Only choose this when its returned fields fully answer the requested organisation enquiry.',
  parameters:PARAM_SCHEMAS.organization_read,
  validate:a=>validKeys(a,['section','agent_id','limit','offset'])&&(a.section===undefined||sectionNames.includes(a.section))&&(a.agent_id===undefined||typeof a.agent_id==='string')&&pageValid(a),
  evidence(v,_identity,claimed){fresh(v,claimed);if(v.source!=='flolah_live_organization')throw Error('Wrong organisation evidence source');return v;},
  render(v){if(v.section)return page(v.section[0].toUpperCase()+v.section.slice(1),v);return ['*Your organisation*',v.company?.name||'',...['departments','people','agents','skills'].map(k=>page(k[0].toUpperCase()+k.slice(1),v[k]))].filter(Boolean).join('\n\n');}
 },
 agent_work_history:{
  observation:true,description:'Read current recorded Kanban/delegation work for enabled company agents, including completed tasks in a specified recent number of days. Use scope company for the organisation, status completed for finished tasks. This is agent work history, not CRM customer tasks. Choose only for requests fully answered by this ledger.',
  parameters:{type:'object',properties:{...Object.fromEntries(['days','status','limit','offset'].map(k=>[k,PARAM_SCHEMAS.agent_work_history.properties[k]])),scope:{type:'string',enum:['company']}},required:['scope'],additionalProperties:false},
  validate:a=>validKeys(a,['scope','days','status','limit','offset'])&&a.scope==='company'&&(a.days===undefined||Number.isInteger(a.days)&&a.days>=1&&a.days<=365)&&(a.status===undefined||['completed','failed','in_progress','open','awaiting_confirmation','cancelled',''].includes(a.status))&&pageValid(a,100),
  evidence(v,_identity,claimed){fresh(v,claimed);if(v.scope!=='company'||v.evidence_source!=='owner_entitled_company_kanban_and_delegation_ledger')throw Error('Wrong company work evidence source');return v;},
  render(v){return ['*Agent work — past '+v.days+' days*','Source: enabled company agents’ Kanban/delegation records.',...(v.items||[]).map(t=>'- #'+t.task_id+' · '+t.title+' · '+t.status),...(!v.counts.total?['No matching recorded work in this window.']:[]),...(v.has_more?['Showing '+v.items.length+' of '+v.counts.total+'; more records remain.']:[])].join('\n');}
 }
};
