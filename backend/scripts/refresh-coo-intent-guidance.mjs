/** Refresh only the intent section of an existing owner's COO skill/SOUL. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {getDb} from '../src/db/schema.js';
import {listAgentSkillAssignments,addCompanySkillVersion,syncAgentSkillsToWorkspace} from '../src/services/agent-skills.js';
import {tenantWorkspacePath,baseOpenClawAgentIdForAgent} from '../src/services/openclaw-tenant.js';
const owner=process.argv[2];if(!owner)throw Error('Owner ID is required');
const db=getDb(),profile=db.prepare('SELECT agent_id FROM floassist_profiles WHERE owner_id=?').get(owner);if(!profile)throw Error('FloAssist profile not found');
const agent=db.prepare('SELECT * FROM agents WHERE id=?').get(profile.agent_id);if(!agent)throw Error('Assigned agent not found');
const workspace=tenantWorkspacePath(owner,baseOpenClawAgentIdForAgent(agent)),soulPath=join(workspace,'SOUL.md');if(!existsSync(soulPath))throw Error('Existing COO SOUL not found');
const template=readFileSync(new URL('../../openclaw-workspace-templates/balserve/SOUL.md',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const section=template.split('## Current request and execution evidence\n')[1]?.split('\n## Relevant memory')[0];if(!section)throw Error('Intent section missing');
let soul=readFileSync(soulPath,'utf8').replace(/\r\n/g,'\n');
const heading='## Current request and execution evidence';
if(soul.includes(heading))soul=soul.replace(/## Current request and execution evidence\n[\s\S]*?(?=\n## |$)/,heading+'\n'+section+'\n');else soul+='\n'+heading+'\n'+section+'\n';
soul=soul.replace(/^- \*\*Before responding:\*\* Get your session history[^\n]*/m,template.match(/^- \*\*Before responding:\*\*[^\n]*/m)[0]);
soul=soul.replace(/^- \*\*Tool choice:\*\*[^\n]*/m,template.match(/^- \*\*Tool choice:\*\*[^\n]*/m)[0]);
soul=soul.replace(/^- \*\*Before starting a task:\*\*[^\n]*/m,template.match(/^- \*\*Before starting a task:\*\*[^\n]*/m)[0]);
const assignments=listAgentSkillAssignments(owner,agent.id,{includeMarkdown:true});const skill=assignments.find(x=>x.slug==='floassist-personal-assistant');if(!skill||!skill.ready)throw Error('Existing assistant skill is not ready');
const source=readFileSync(new URL('../src/services/floassist/assistant.md',import.meta.url),'utf8').replace(/\r\n/g,'\n');const paragraph=source.split('\n').find(x=>x.startsWith('Anchor tool use to the latest user request.'));if(!paragraph)throw Error('Skill intent paragraph missing');
const next=skill.skill_md.includes('Anchor tool use to the latest user request.')?skill.skill_md.replace(/^Anchor tool use to the latest user request\.[^\n]*/m,paragraph):skill.skill_md.replace(/(For direct requests,[^\n]*)/,'$1\n\n'+paragraph);
let version=skill;
if(next!==skill.skill_md){version=addCompanySkillVersion(owner,skill.skill_id,{skill_md:next,trigger_hints:skill.trigger_hints,required_tools:skill.required_tools,required_connector_actions:skill.required_connector_actions,required_mcp_tools:skill.required_mcp_tools},owner);if(skill.pinned)db.prepare('UPDATE agent_skill_assignments SET version_id=? WHERE owner_user_id=? AND agent_id=? AND skill_id=?').run(version.version_id||version.id+':v'+version.version,owner,agent.id,skill.skill_id);}
writeFileSync(soulPath,soul);syncAgentSkillsToWorkspace(owner,agent.id,workspace);
const updated=listAgentSkillAssignments(owner,agent.id,{includeMarkdown:true}).find(x=>x.skill_id===skill.skill_id);if(!updated?.skill_md.includes(paragraph))throw Error('Active assignment did not update');
console.log(JSON.stringify({agent:agent.id,skill_id:skill.skill_id,version:updated.version,ready:updated.ready,soul_intent:true,other_assignments_preserved:true}));process.exit(0);


