export function toolAllowByAgentFromConfig(config) {
  const entries = config?.agents?.entries && typeof config.agents.entries === "object"
    ? Object.entries(config.agents.entries).map(([id, entry]) => ({ id, ...(entry || {}) }))
    : (config?.agents?.list || []);
  const byAgent = {};
  for (const entry of entries) {
    const id = String(entry?.id || "").trim().toLowerCase();
    if (!id) continue;
    byAgent[id] = Array.isArray(entry?.tools?.allow) ? entry.tools.allow : [];
  }
  return byAgent;
}

export function mergeRuntimeToolDescriptors(catalog, allowlists) {
  const byName = new Map();
  for (const descriptor of Array.isArray(catalog) ? catalog : []) {
    const name = String(descriptor?.name || "").trim();
    if (name) byName.set(name, descriptor);
  }
  for (const granted of Object.values(allowlists || {})) {
    if (!Array.isArray(granted)) continue;
    for (const rawName of granted) {
      const name = String(rawName || "").trim();
      if (!name || byName.has(name)) continue;
      byName.set(name, {
        name,
        display_name: name.replaceAll("_", " "),
        purpose: `Agent OS tool ${name}.`,
      });
    }
  }
  return [...byName.values()];
}

export function isToolGranted(agentId, toolName, allowlists, configAllowByAgent) {
  const key = String(agentId || "").trim().toLowerCase();
  if (!key) return false;
  if (Array.isArray(allowlists?.[key])) return allowlists[key].includes(toolName);
  if (Array.isArray(configAllowByAgent?.[key])) return configAllowByAgent[key].includes(toolName);
  return false;
}

export function isToolGrantedForSession(
  agentId,
  toolName,
  sessionKey,
  allowlists,
  configAllowByAgent,
  sessionScopes,
  at = Date.now()
) {
  if (!isToolGranted(agentId, toolName, allowlists, configAllowByAgent)) return false;
  const key = String(sessionKey || '').trim();
  const scope = key ? sessionScopes?.[key] : null;
  if (!scope || !Array.isArray(scope.tools)) return true;
  const expiresAt = Date.parse(scope.expires_at || '');
  if (!Number.isFinite(expiresAt) || expiresAt <= at) return true;
  return scope.tools.includes(toolName);
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

/**
 * A direct-tool route may select one exact bound MCP capability. Pin the
 * bridge target from that trusted backend-owned session scope so the model
 * cannot mistype or substitute the server/tool identifiers.
 */
export function pinSelectedMcpTarget(params, sessionKey, sessionScopes, at = Date.now()) {
  const input = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  const key = String(sessionKey || '').trim();
  const scope = key ? sessionScopes?.[key] : null;
  if (!scope) return input;
  const expiresAt = Date.parse(scope.expires_at || '');
  if (!Number.isFinite(expiresAt) || expiresAt <= at) return input;
  const selected = Array.isArray(scope.selected_mcp_capabilities)
    ? [...new Set(scope.selected_mcp_capabilities.map(String).filter(Boolean))]
    : [];
  if (selected.length !== 1) return input;
  const target = parseMcpCapability(selected[0]);
  return target ? { ...input, ...target } : input;
}

export function safeApiSessionKey(api) {
  try {
    return typeof api?.getSessionKey === "function" ? api.getSessionKey() : api?.sessionKey;
  } catch {
    return api?.sessionKey || null;
  }
}
