import { randomUUID } from 'node:crypto';
import { getDb } from '../db/schema.js';
import { listToolsMeta } from './content-tools-meta.js';
import { assertCallerMayUseTool } from './openclaw-agent-tools.js';
import { tenantOpenClawAgentId } from './openclaw-tenant.js';
import { registerOpenClawSessionOwner } from './tool-owner-scope.js';
import { issueToolCredentialLease } from './tool-scoped-token.js';
import { listSteeringTargets, listWorkSteering, queueWorkSteering } from './work-steering.js';
import { createAgentCommandRunner } from './agent-slash-commands.js';
import { createCommandReceiptStore } from './agent-command-receipts.js';
import { listAgentSkillAssignments } from './agent-skills.js';

export function commandToolCatalog(owner, agentId) {
  const agent = getDb().prepare('SELECT id,openclaw_agent_id FROM agents WHERE id=?').get(agentId);
  if (!agent) return [];
  const source = tenantOpenClawAgentId(owner, agent.openclaw_agent_id || agent.id);
  return listToolsMeta().filter(t => t.enabled && assertCallerMayUseTool(source, t.name).ok)
    .map(({ name, display_name, purpose }) => ({ name, display_name, purpose }));
}
export function commandSkillCatalog(owner, agentId) {
  const toolNames = new Set(commandToolCatalog(owner, agentId).map(t => t.name));
  return listAgentSkillAssignments(owner, agentId).filter(s => s.enabled && s.status === 'active')
    .map(s => {
      const missing = [...new Set([...s.missing_tools, ...s.missing_connector_actions, ...s.missing_mcp_tools, ...s.required_tools.filter(t => !toolNames.has(t)), ...(!s.version_id ? ['active skill version'] : [])])];
      return { skill_id: s.skill_id, slug: s.slug, name: s.name, description: s.description, version: s.version, version_id: s.version_id, ready: s.ready && !missing.length, missing };
    });
}
export function validateRequestedAgentSkills(owner, agent, refs) {
  if (refs == null) return [];
  if (!Array.isArray(refs) || refs.length > 5 || refs.some(r => typeof r !== 'string')) throw Object.assign(new Error('Select up to five assigned skill IDs'), { status: 400 });
  const catalog = commandSkillCatalog(owner, agent);
  return [...new Set(refs)].map(id => {
    const skill = catalog.find(s => s.skill_id === id);
    if (!skill) throw Object.assign(new Error('Selected skill is not assigned and enabled for this agent'), { status: 403 });
    if (!skill.ready) throw Object.assign(new Error(`Selected skill is not ready: ${skill.missing.join(', ')}`), { status: 409 });
    return { skill_id: skill.skill_id, version_id: skill.version_id, version: skill.version, slug: skill.slug, name: skill.name };
  });
}
export function validateRequestedAgentTools(owner, agent, refs) {
  if (refs == null) return [];
  if (!Array.isArray(refs) || refs.length > 5 || refs.some(r => typeof r !== 'string')) throw Object.assign(new Error('Select up to five granted tool names'), { status: 400 });
  const catalog = commandToolCatalog(owner, agent);
  return [...new Set(refs)].map(name => {
    const tool = catalog.find(t => t.name === name);
    if (!tool) throw Object.assign(new Error('Selected tool is not enabled and granted to this agent'), { status: 403 });
    return tool;
  });
}
export function requestedToolUseInstruction(tools) {
  if (!tools.length) return '';
  return '\n\n[User-selected tools for THIS task]\n' + tools.map(t => `${t.name}: ${t.purpose || t.display_name || ''}`).join('\n')
    + '\nUse these exact selected tools to perform this task and ground the answer in their results. Do not silently substitute memory, another tool, or delegation. Infer arguments only from the user request and verified context; ask for missing required inputs. Selection is NOT approval for external writes, trading or other consequential actions. Retain all existing governance and approvals. If a selected tool is unavailable, blocked or unsuitable, explain precisely why and ask before substituting. Do not claim a tool ran without an actual tool result.';
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:password|secret|authorization|access_token|refresh_token|api_key|approval_token)/i.test(key))
    .map(([key, child]) => [key, redact(child)]));
  return value;
}
export const runAgentCommand = createAgentCommandRunner({
  tools: commandToolCatalog,
  skills: commandSkillCatalog,
  targets: listSteeringTargets,
  history(owner, kind, id, agentId) {
    // History must remain exact-agent scoped even after the work ends.
    listSteeringTargets(owner, agentId); // initialize steering schema
    const mismatched = getDb().prepare('SELECT 1 FROM work_steering WHERE owner_user_id=? AND target_kind=? AND target_id=? AND agent_id!=? LIMIT 1').get(owner, kind, id, agentId);
    if (mismatched) throw Object.assign(new Error('Work is not owned by this agent'), { status: 404 });
    const own = getDb().prepare('SELECT 1 FROM work_steering WHERE owner_user_id=? AND target_kind=? AND target_id=? AND agent_id=? LIMIT 1').get(owner, kind, id, agentId);
    return own ? listWorkSteering(owner, kind, id) : [];
  },
  enqueue: queueWorkSteering,
  async invoke(context) {
    const { tool_name, params, ownerUserId, actor, agentId } = context;
    const receipts = createCommandReceiptStore(getDb());
    const prior = receipts.claim(context);
    if (prior) return { ...prior, replayed: true };
    const agent = getDb().prepare('SELECT id,openclaw_agent_id FROM agents WHERE id=?').get(agentId);
    const source = tenantOpenClawAgentId(ownerUserId, agent.openclaw_agent_id || agent.id);
    const sessionKey = `agent:${source}:slash-${randomUUID()}`;
    registerOpenClawSessionOwner(sessionKey, ownerUserId, actor.id, actor.channel || 'web');
    const lease = issueToolCredentialLease({ ownerUserId, agentId: source, sessionKey, toolName: tool_name });
    const base = String(process.env.TOOLS_BASE_URL || process.env.AGENT_OS_INTERNAL_URL || `http://127.0.0.1:${process.env.PORT || 3001}`).replace(/\/$/, '');
    const response = await fetch(`${base}/api/tools/invoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lease.token}`, 'x-openclaw-agent-id': source, 'x-openclaw-session-key': sessionKey },
      body: JSON.stringify({ ...params, tool_name }), signal: AbortSignal.timeout(120000),
    });
    const result = redact(await response.json().catch(() => ({ error: 'Tool returned a non-JSON response' })));
    // Never auto-approve, retry or ask an LLM to reinterpret a blocked command.
    const summary = JSON.stringify(result, null, 2);
    const out = { ok: response.ok, status: response.status, tool_name, result, reply: `${tool_name}: ${response.ok ? 'returned' : 'blocked or failed'}\n${summary.slice(0, 10000)}${summary.length > 10000 ? '\nResult truncated; consult tool execution logs.' : ''}`, media_uri: response.ok ? result.media_uri || result.audio?.media_uri || null : null };
    receipts.complete(context, out);
    return out;
  },
});
