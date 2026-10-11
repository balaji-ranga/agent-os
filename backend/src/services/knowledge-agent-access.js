import { listAgentsForUser } from './users.js';
import { parseTenantOpenClawAgentId, baseOpenClawAgentIdForAgent } from './openclaw-tenant.js';
import { knowledgeStore } from './knowledge-store.js';

export function resolveKnowledgeAgent(owner,identifier,{agents=null}={}) {
  if(!owner||!identifier)throw Object.assign(new Error('Authenticated agent identity required for connected knowledge'),{status:403});
  const parsed=parseTenantOpenClawAgentId(identifier);
  if(parsed&&parsed.ceoUserId!==owner)throw Object.assign(new Error('Agent owner mismatch'),{status:403});
  const id=parsed?.baseOpenClawId||identifier;
  const matches=(agents||listAgentsForUser(owner)).filter(a=>a.id===id||baseOpenClawAgentIdForAgent(a)===id);
  if(matches.length!==1)throw Object.assign(new Error('Agent not found for this company'),{status:403});
  return matches[0].id;
}

export function permittedKnowledgeSources(owner,identifier,requested=null) {
  const id=resolveKnowledgeAgent(owner,identifier);
  const granted=knowledgeStore().agentSources(owner,id);
  if(requested!==null&&(!Array.isArray(requested)||requested.some(source=>!granted.includes(source))))throw Object.assign(new Error('Knowledge source access not granted to this agent'),{status:403});
  return requested||granted;
}
