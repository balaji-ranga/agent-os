import { getDb } from '../db/schema.js';
import {
  callMcpServerTool,
  listMcpServersForWorkflow,
} from './mcp-servers.js';

export const MCP_AGENT_BRIDGE_TOOLS = Object.freeze([
  'mcp_bound_tools_list',
  'mcp_bound_tool_call',
]);

const VALID_FAMILIES = new Set(['read', 'write_internal', 'communicate_external', 'financial_destructive']);

function ownerAuth(ownerUserId) {
  return { id: String(ownerUserId || '').trim(), role: 'ceo' };
}

function requireScope(ownerUserId, agentId) {
  const owner = String(ownerUserId || '').trim();
  const agent = String(agentId || '').trim();
  if (!owner || !agent) throw Object.assign(new Error('CEO and agent context are required'), { status: 403 });
  const entitled = getDb().prepare(
    `SELECT 1 AS ok FROM user_agents WHERE user_id = ? AND agent_id = ? AND enabled = 1`
  ).get(owner, agent);
  if (!entitled) throw Object.assign(new Error('Agent is not enabled for this company'), { status: 403 });
  return { owner, agent };
}

/** Conservative, domain-neutral action classification. Unknown MCP actions are R2. */
export function classifyMcpTool(tool = {}) {
  const text = `${tool.name || tool.tool_name || ''} ${tool.description || ''}`.toLowerCase();
  if (/delete|destroy|purge|remove|revoke|cancel|refund|payment|transfer|trade|order_submit|execute_order/.test(text)) {
    return { risk_tier: 'R3', action_family: 'financial_destructive' };
  }
  if (/send|publish|post|message|email|sms|whatsapp|invite|comment|reply|share_external|external/.test(text)) {
    return { risk_tier: 'R2', action_family: 'communicate_external' };
  }
  if (/create|update|write|upsert|set|edit|append|assign|schedule|reschedule|move/.test(text)) {
    return { risk_tier: 'R1', action_family: 'write_internal' };
  }
  if (/read|list|get|fetch|find|search|query|inspect|status|history|summari[sz]e|lookup|download/.test(text)) {
    return { risk_tier: 'R0', action_family: 'read' };
  }
  return { risk_tier: 'R2', action_family: 'communicate_external' };
}

function normalizeGrant(input) {
  return {
    server_id: String(input?.server_id || input?.serverId || '').trim(),
    tool_name: String(input?.tool_name || input?.toolName || input?.name || '').trim(),
  };
}

export function listAgentMcpToolAccess(ownerUserId, agentId) {
  const { owner, agent } = requireScope(ownerUserId, agentId);
  const selected = new Map(
    getDb().prepare(
      `SELECT server_id, tool_name, risk_tier, action_family, created_at, updated_at
       FROM agent_mcp_tool_grants WHERE owner_user_id = ? AND agent_id = ?
       ORDER BY server_id, tool_name`
    ).all(owner, agent).map((row) => [`${row.server_id}\u0000${row.tool_name}`, row])
  );
  const servers = listMcpServersForWorkflow(ownerAuth(owner)).map((server) => ({
    id: server.id,
    name: server.name,
    description: server.description || '',
    status: server.status,
    is_platform: !!server.is_platform,
    tools: (server.tools || []).map((tool) => {
      const key = `${server.id}\u0000${tool.name}`;
      const existing = selected.get(key);
      const classification = existing || classifyMcpTool(tool);
      return {
        name: tool.name,
        description: tool.description || '',
        input_schema: tool.input_schema || {},
        granted: !!existing,
        risk_tier: classification.risk_tier,
        action_family: classification.action_family,
      };
    }),
  }));
  return { owner_user_id: owner, agent_id: agent, grants: [...selected.values()], servers };
}

export function setAgentMcpToolGrants(ownerUserId, agentId, requested = []) {
  const { owner, agent } = requireScope(ownerUserId, agentId);
  const unique = new Map();
  for (const raw of Array.isArray(requested) ? requested : []) {
    const grant = normalizeGrant(raw);
    if (!grant.server_id || !grant.tool_name) throw Object.assign(new Error('Each MCP grant requires server_id and tool_name'), { status: 400 });
    unique.set(`${grant.server_id}\u0000${grant.tool_name}`, grant);
  }
  const validated = [];
  const visibleServers = new Map(listMcpServersForWorkflow(ownerAuth(owner)).map((server) => [server.id, server]));
  for (const grant of unique.values()) {
    const server = visibleServers.get(grant.server_id);
    if (!server) throw Object.assign(new Error(`MCP server "${grant.server_id}" is not healthy or visible to this company`), { status: 400 });
    const tool = (server.tools || []).find((item) => item.name === grant.tool_name);
    if (!tool) throw Object.assign(new Error(`MCP tool "${grant.tool_name}" is not exposed by server "${grant.server_id}"`), { status: 400 });
    validated.push({ ...grant, ...classifyMcpTool(tool) });
  }
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM agent_mcp_tool_grants WHERE owner_user_id = ? AND agent_id = ?').run(owner, agent);
    const insert = db.prepare(
      `INSERT INTO agent_mcp_tool_grants
       (owner_user_id, agent_id, server_id, tool_name, risk_tier, action_family)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const grant of validated) {
      insert.run(owner, agent, grant.server_id, grant.tool_name, grant.risk_tier, grant.action_family);
    }
  })();
  return listAgentMcpToolAccess(owner, agent);
}

export function hasAgentMcpToolBindings(ownerUserId, agentId) {
  if (!ownerUserId || !agentId) return false;
  return !!getDb().prepare(
    `SELECT 1 AS ok FROM agent_mcp_tool_grants WHERE owner_user_id = ? AND agent_id = ? LIMIT 1`
  ).get(String(ownerUserId), String(agentId));
}

export function getAgentMcpBridgeGrants(ownerUserId, agentId) {
  return hasAgentMcpToolBindings(ownerUserId, agentId) ? [...MCP_AGENT_BRIDGE_TOOLS] : [];
}

export function listBoundMcpTools(ownerUserId, agentId) {
  const { owner, agent } = requireScope(ownerUserId, agentId);
  const visible = new Set(listMcpServersForWorkflow(ownerAuth(owner)).map((server) => server.id));
  return getDb().prepare(
    `SELECT g.server_id, s.name AS server_name, g.tool_name, c.description, c.input_schema_json,
            g.risk_tier, g.action_family
     FROM agent_mcp_tool_grants g
     JOIN mcp_servers s ON s.id = g.server_id
     JOIN mcp_tools_cache c ON c.server_id = g.server_id AND c.tool_name = g.tool_name
     WHERE g.owner_user_id = ? AND g.agent_id = ? AND s.status = 'healthy'
     ORDER BY s.name, g.tool_name`
  ).all(owner, agent).filter((row) => visible.has(row.server_id)).map((row) => ({
    server_id: row.server_id,
    server_name: row.server_name,
    tool_name: row.tool_name,
    description: row.description || '',
    input_schema: (() => { try { return JSON.parse(row.input_schema_json || '{}'); } catch { return {}; } })(),
    risk_tier: row.risk_tier,
    action_family: row.action_family,
  }));
}

export function getBoundMcpPolicy(ownerUserId, agentId, serverId, toolName) {
  if (!ownerUserId || !agentId || !serverId || !toolName) return null;
  const row = getDb().prepare(
    `SELECT risk_tier, action_family FROM agent_mcp_tool_grants
     WHERE owner_user_id = ? AND agent_id = ? AND server_id = ? AND tool_name = ?`
  ).get(String(ownerUserId), String(agentId), String(serverId), String(toolName));
  if (!row || !/^R[0-3]$/.test(row.risk_tier) || !VALID_FAMILIES.has(row.action_family)) return null;
  return row;
}

function receipt({ owner, agent, serverId, toolName, status, args, result, started }) {
  try {
    getDb().prepare(
      `INSERT INTO agent_mcp_action_receipts
       (owner_user_id, agent_id, server_id, tool_name, status, request_json, response_json, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      owner, agent, serverId, toolName, status,
      JSON.stringify({ arguments: args || {} }), JSON.stringify(result || {}), Date.now() - started
    );
  } catch (_) {}
}

export async function callBoundMcpTool(ownerUserId, agentId, { server_id, tool_name, arguments: args = {} } = {}) {
  const { owner, agent } = requireScope(ownerUserId, agentId);
  const serverId = String(server_id || '').trim();
  const toolName = String(tool_name || '').trim();
  if (!serverId || !toolName) throw Object.assign(new Error('server_id and tool_name are required'), { status: 400 });
  const binding = getBoundMcpPolicy(owner, agent, serverId, toolName);
  if (!binding) {
    receipt({ owner, agent, serverId, toolName, status: 'denied', args, result: { error: 'binding_not_granted' }, started: Date.now() });
    throw Object.assign(new Error('This MCP tool is not bound to the agent for this company'), { status: 403 });
  }
  const server = listMcpServersForWorkflow(ownerAuth(owner)).find((item) => item.id === serverId);
  if (!server || !(server.tools || []).some((item) => item.name === toolName)) {
    throw Object.assign(new Error('Bound MCP server/tool is no longer healthy or visible'), { status: 409 });
  }
  const started = Date.now();
  try {
    const result = await callMcpServerTool(serverId, toolName, args && typeof args === 'object' ? args : {}, ownerAuth(owner));
    receipt({ owner, agent, serverId, toolName, status: 'ok', args, result, started });
    return { ok: true, server_id: serverId, tool_name: toolName, result };
  } catch (error) {
    receipt({ owner, agent, serverId, toolName, status: 'error', args, result: { error: error.message }, started });
    throw error;
  }
}

export function listAgentMcpCapabilitySummaries(ownerUserId, agentId) {
  if (!ownerUserId || !agentId) return [];
  try {
    return listBoundMcpTools(ownerUserId, agentId).map((item) => ({
      name: `mcp:${item.server_id}:${item.tool_name}`,
      description: `${item.server_name}: ${item.description || item.tool_name}. Invoke through mcp_bound_tool_call.`,
    }));
  } catch {
    return [];
  }
}
