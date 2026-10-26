import {readFileSync} from 'node:fs';
import {getDb} from '../src/db/schema.js';
import {listAgentSkillAssignments,addCompanySkillVersion} from '../src/services/agent-skills.js';
import {resolveFloAssistCoo} from '../src/services/floassist/platform.js';
import {ensureTenantOpenClawAgent} from '../src/services/openclaw-tenant.js';
import {syncOrgContextToWorkspace} from '../src/services/org-context.js';
const owner=process.argv[2];
if(!owner)throw new Error('Explicit owner ID required');
const db=getDb(),profile=db.prepare('SELECT agent_id FROM floassist_profiles WHERE owner_id=?').get(owner);
if(!profile)throw new Error('FloAssist profile not found');
const skill=listAgentSkillAssignments(owner,profile.agent_id,{includeMarkdown:true}).find(s=>s.slug==='floassist-personal-assistant');
if(!skill)throw new Error('Assigned FloAssist skill not found');
if(skill.pinned)throw new Error('FloAssist skill version is pinned; preserve the pin and review before migrating');
const markdown=readFileSync(new URL('../src/services/floassist/assistant.md',import.meta.url),'utf8');
let changed=false;
if(skill.skill_md.trim()!==markdown.trim()){
  addCompanySkillVersion(owner,skill.skill_id,{...skill,skill_md:markdown},owner);changed=true;
}
const agent=resolveFloAssistCoo(owner),runtime=ensureTenantOpenClawAgent(agent,owner);
await syncOrgContextToWorkspace(agent,owner,runtime.workspacePath);
console.log(JSON.stringify({skillUpdated:changed,runtimeGuidanceSynced:true}));
process.exit(0);
