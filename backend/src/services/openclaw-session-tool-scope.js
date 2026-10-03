import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { getOpenClawDir } from '../config/openclaw-paths.js';
import { enquireContentTools } from './content-tools-meta.js';
import { getAgentToolGrants } from './openclaw-agent-tools.js';
import { getAgentMcpBridgeGrants } from './agent-mcp-tool-grants.js';
import { OPENCLAW_TOOL_PRIORITY } from './openclaw-runtime-tools.js';

export const SESSION_TOOL_SCOPES_PATH = join(
  getOpenClawDir(),
  'agent-tool-session-allowlists.json'
);
export const MAX_SESSION_CONTENT_TOOLS = 96;

const BASELINE_CONTENT_TOOLS = Object.freeze([
  'learnings_summary',
  'content_tools_enquire',
  'ceo_profile',
  'productivity_capabilities',
  'agent_goal_status',
  'agent_workflow_enquire',
  'agent_workflow_runs',
  'kanban_get_task',
]);

function readScopes() {
  try {
    if (!existsSync(SESSION_TOOL_SCOPES_PATH)) return {};
    const parsed = JSON.parse(readFileSync(SESSION_TOOL_SCOPES_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function pruneExpired(scopes, at = Date.now()) {
  return Object.fromEntries(
    Object.entries(scopes || {}).filter(([, scope]) => {
      const expiry = Date.parse(scope?.expires_at || '');
      return Number.isFinite(expiry) && expiry > at && Array.isArray(scope?.tools);
    })
  );
}

function writeScopes(scopes) {
  mkdirSync(dirname(SESSION_TOOL_SCOPES_PATH), { recursive: true });
  const temp = `${SESSION_TOOL_SCOPES_PATH}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(scopes, null, 2)}\n`, 'utf8');
  renameSync(temp, SESSION_TOOL_SCOPES_PATH);
}

function routeCapabilityNames(route) {
  const names = route?.executor_evidence?.capability_names;
  return Array.isArray(names) ? names.map((name) => String(name || '').trim()).filter(Boolean) : [];
}

function parseMcpCapability(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('mcp:')) return null;
  const separator = raw.indexOf(':', 4);
  if (separator <= 4 || separator >= raw.length - 1) return null;
  return {
    server_id: raw.slice(4, separator),
    mcp_tool_name: raw.slice(separator + 1),
  };
}

/** Resolve one exact MCP target selected by the trusted turn router. */
export function resolveSessionMcpTarget(sessionKey, at = Date.now()) {
  const key = String(sessionKey || '').trim();
  const scope = key ? readScopes()?.[key] : null;
  if (!scope) return null;
  const expiresAt = Date.parse(scope.expires_at || '');
  if (!Number.isFinite(expiresAt) || expiresAt <= at) return null;
  const selected = Array.isArray(scope.selected_mcp_capabilities)
    ? [...new Set(scope.selected_mcp_capabilities.map(String).filter(Boolean))]
    : [];
  return selected.length === 1 ? parseMcpCapability(selected[0]) : null;
}

export function selectSessionContentTools({ agentId, ownerUserId = null, message = '', route = null, maxTools = MAX_SESSION_CONTENT_TOOLS }) {
  const limit = Math.max(8, Math.min(112, Number(maxTools) || MAX_SESSION_CONTENT_TOOLS));
  const bridgeGrants = getAgentMcpBridgeGrants(ownerUserId, agentId);
  const grants = [...new Set([...getAgentToolGrants(agentId), ...bridgeGrants])];
  const routeNames = routeCapabilityNames(route);
  const selectedMcpCapabilities = routeNames.filter((name) => name.startsWith('mcp:'));
  if (selectedMcpCapabilities.length && bridgeGrants.length) {
    return {
      scoped: true,
      tools: [...bridgeGrants],
      grants_count: grants.length,
      selected_count: bridgeGrants.length,
      selected_mcp_capabilities: selectedMcpCapabilities,
    };
  }
  if (grants.length <= limit) return { scoped: false, tools: grants, grants_count: grants.length };

  const granted = new Set(grants);
  const selected = [];
  const add = (name) => {
    const value = String(name || '').trim();
    if (value && granted.has(value) && !selected.includes(value) && selected.length < limit) selected.push(value);
  };

  for (const name of routeNames) add(name);
  const ranked = enquireContentTools(
    [message, ...routeCapabilityNames(route)].filter(Boolean).join(' '),
    { limit }
  );
  for (const tool of ranked.tools || []) add(tool.name);
  for (const name of BASELINE_CONTENT_TOOLS) add(name);
  for (const name of OPENCLAW_TOOL_PRIORITY) add(name);
  for (const name of grants) add(name);

  return {
    scoped: true,
    tools: selected,
    grants_count: grants.length,
    selected_count: selected.length,
  };
}

export function installSessionToolScope(sessionKey, selection, ttlMs = 15 * 60 * 1000) {
  const key = String(sessionKey || '').trim();
  if (!key || !selection?.scoped) return selection || { scoped: false, tools: [] };
  const scopes = pruneExpired(readScopes());
  scopes[key] = {
    tools: [...new Set((selection.tools || []).map(String).filter(Boolean))],
    selected_mcp_capabilities: [...new Set(
      (selection.selected_mcp_capabilities || []).map(String).filter((name) => name.startsWith('mcp:'))
    )],
    expires_at: new Date(Date.now() + Math.max(60_000, Number(ttlMs) || 0)).toISOString(),
  };
  writeScopes(scopes);
  return selection;
}

export function removeSessionToolScope(sessionKey) {
  const key = String(sessionKey || '').trim();
  if (!key) return false;
  const scopes = pruneExpired(readScopes());
  if (!Object.prototype.hasOwnProperty.call(scopes, key)) return false;
  delete scopes[key];
  writeScopes(scopes);
  return true;
}
