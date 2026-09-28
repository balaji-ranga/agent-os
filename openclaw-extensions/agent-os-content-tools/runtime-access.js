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

export function safeApiSessionKey(api) {
  try {
    return typeof api?.getSessionKey === "function" ? api.getSessionKey() : api?.sessionKey;
  } catch {
    return api?.sessionKey || null;
  }
}
