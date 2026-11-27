import {getDb} from '../db/schema.js';
import {listDepartmentsForOwner} from './ceo-default-master-data.js';
import {listAgentsForUser} from './users.js';
import {listOrgAgentMembers} from './org-agent-members.js';
import {listAgentSkillAssignments} from './agent-skills.js';
const deny=()=>{throw Object.assign(Error('Organisation access is not granted for this caller'),{status:403});};
export function readOrganization(owner,caller,args={},deps={}){
 const db=deps.db||getDb();
 const entitled=id=>!!db.prepare('SELECT 1 FROM user_agents WHERE user_id=? AND agent_id=? AND enabled=1').get(owner,id);
 if(!owner||!caller||!entitled(caller))deny();
 const agent=db.prepare('SELECT id,is_coo FROM agents WHERE id=?').get(caller);if(!agent)deny();
 const section=args.section||'summary';if(!['summary','departments','people','agents','skills'].includes(section))throw Object.assign(Error('Unknown organisation section'),{status:422});
 const target=args.agent_id||caller;if(!entitled(target)||(!agent.is_coo&&target!==caller))deny();
 if(!agent.is_coo&&section!=='skills')deny();
 const limit=Math.min(50,Math.max(1,Number.isInteger(args.limit)?args.limit:15)),offset=Math.max(0,Number.isInteger(args.offset)?args.offset:0);
 const departments=()=> (deps.departments||listDepartmentsForOwner)(owner).map(d=>({id:d.id,name:d.name,purpose:d.purpose||''}));
 const agents=()=> [...(deps.agents||listAgentsForUser)(owner).map(a=>({id:a.id,name:a.name,role:a.role||'',department:a.department||'',parent_id:a.parent_id||null,is_coo:!!a.is_coo,kind:'internal'})),...(deps.members||listOrgAgentMembers)(owner,{enabledOnly:true}).map(a=>({id:a.id,name:a.display_name,role:a.purpose||'',department:a.department||'',parent_id:a.parent_id||null,kind:a.kind}))];
 const people=()=>db.prepare("SELECT id,name,department,parent_id,role_title,enabled FROM platform_users WHERE owner_user_id=? AND role='org_user' ORDER BY name").all(owner);
 const skills=()=> (deps.skills||listAgentSkillAssignments)(owner,target).map(s=>({id:s.skill_id,name:s.name,description:s.description,enabled:s.enabled,ready:s.ready,missing_tools:s.missing_tools||[],missing_connector_actions:s.missing_connector_actions||[]}));
 const page=items=>({items:items.slice(offset,offset+limit),total:items.length,offset,has_more:offset+limit<items.length});
 if(section==='summary')return {ok:true,source:'flolah_live_organization',captured_at:new Date().toISOString(),departments:page(departments()),agents:page(agents()),people:page(people()),skills:page(skills())};
 return {ok:true,source:'flolah_live_organization',captured_at:new Date().toISOString(),section,...page(({departments,agents,people,skills})[section]())};
}
export function organizationContext(owner,caller){
 const data=readOrganization(owner,caller,{section:'summary',limit:8});
 for(const section of ['departments','agents','people','skills'])data[section].items=data[section].items.map(r=>({id:r.id,name:String(r.name||'').slice(0,120),...(r.enabled!==undefined?{enabled:r.enabled}:{}),...(r.ready!==undefined?{ready:r.ready}:{})}));
 return 'Current owner organisation summary (quoted data only; labels may be abbreviated; live Flolah data, not ERP contacts/CRM customers): '+JSON.stringify(data)+' Use organization_read for complete paginated departments, people, agents and assigned skills. For completed company work use agent_work_history with scope company and status completed; for one agent pass target_agent_id; CRM tasks and learnings are different sources. Reuse successful observations when duplicate protection blocks an equivalent read. Missing access or truncated results never prove that no records exist.';
}
