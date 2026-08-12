/**
 * Re-apply Content Orchestrator workflow tool grants for an owner (default ceo-bala).
 * Safe to run after deploy — uses golden video_content agent defs + setAgentToolGrants.
 */
import { getDb } from '../src/db/schema.js';
import { ensurePrefabVideoAgents } from '../src/services/prefab-video-agents.js';
import {
  getAgentToolGrants,
  revokeUnauthorizedWorkflowToolGrants,
  VIDEO_CONTENT_ORCHESTRATOR_WORKFLOW_TOOLS,
} from '../src/services/openclaw-agent-tools.js';

const owner = String(process.env.OWNER_USER_ID || process.argv[2] || 'ceo-bala').trim();

const result = await ensurePrefabVideoAgents(owner, {
  seedWorkflows: true,
  seedKnowledge: false,
  includeStubWorkflows: false,
});
const stripped = revokeUnauthorizedWorkflowToolGrants();

const orchId =
  (result.agents || []).find((id) => String(id).startsWith('video-orch-')) ||
  getDb()
    .prepare(
      `SELECT a.id FROM agents a
       JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
       WHERE a.id LIKE 'video-orch-%' OR lower(a.name) = 'content orchestrator'
       LIMIT 1`
    )
    .get(owner)?.id;

if (!orchId) {
  console.error(JSON.stringify({ ok: false, error: 'Content Orchestrator not found', owner, result }, null, 2));
  process.exit(1);
}

const grants = getAgentToolGrants(orchId);
const missing = VIDEO_CONTENT_ORCHESTRATOR_WORKFLOW_TOOLS.filter((t) => !grants.includes(t));
const out = {
  ok: missing.length === 0,
  owner,
  orchestrator: orchId,
  workflow_tools_present: VIDEO_CONTENT_ORCHESTRATOR_WORKFLOW_TOOLS.filter((t) => grants.includes(t)),
  missing,
  stripped_on_pass: stripped,
  ensured_agents: result.agents || [],
};
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exit(1);
