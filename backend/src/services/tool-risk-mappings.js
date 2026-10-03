import { getDb } from '../db/schema.js';

export const TOOL_RISK_TIERS = Object.freeze([
  { id: 'R0', label: 'Read only', family: 'read', effect: 'May inspect or retrieve data without changing external state.' },
  { id: 'R1', label: 'Internal change', family: 'write_internal', effect: 'May create or update reversible company-internal state.' },
  { id: 'R2', label: 'External action', family: 'communicate_external', effect: 'May communicate, publish, invite, or otherwise affect an external party.' },
  { id: 'R3', label: 'Destructive / financial', family: 'financial_destructive', effect: 'May delete data, move money, trade, submit, cancel, or perform another destructive action.' },
  { id: 'R4', label: 'Critical privileged', family: 'financial_destructive', effect: 'Security, identity, credential, deployment, or irreversible platform action. Always prohibited until remapped by the company owner.' },
]);

export const TOOL_RISK_TYPES = Object.freeze(['content_tool', 'mcp_tool', 'connector_action']);

const TIER_BY_ID = new Map(TOOL_RISK_TIERS.map((row) => [row.id, row]));
let ready = false;

export function ensureToolRiskMappingTable() {
  if (ready) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS tool_risk_mappings (
      owner_user_id TEXT NOT NULL,
      capability_type TEXT NOT NULL CHECK (capability_type IN ('content_tool', 'mcp_tool', 'connector_action')),
      capability_key TEXT NOT NULL,
      source_id TEXT DEFAULT '',
      capability_id TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      description TEXT DEFAULT '',
      inferred_risk_tier TEXT NOT NULL CHECK (inferred_risk_tier IN ('R0', 'R1', 'R2', 'R3', 'R4')),
      override_risk_tier TEXT CHECK (override_risk_tier IS NULL OR override_risk_tier IN ('R0', 'R1', 'R2', 'R3', 'R4')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (owner_user_id, capability_type, capability_key)
    );
    CREATE INDEX IF NOT EXISTS idx_tool_risk_mappings_owner_type
      ON tool_risk_mappings(owner_user_id, capability_type, capability_id);
  `);
  ready = true;
}

export function actionFamilyForRiskTier(riskTier) {
  return TIER_BY_ID.get(String(riskTier || '').toUpperCase())?.family || 'communicate_external';
}

function validTier(value, fallback = 'R2') {
  const tier = String(value || '').trim().toUpperCase();
  return TIER_BY_ID.has(tier) ? tier : fallback;
}

function criticalPrivilegedRisk(text) {
  const normalized = String(text || '').toLowerCase().replace(/[_-]+/g, ' ');
  const privilegedObject = /\b(account|identity|credential|secret|api key|access token|permission|role|administrator|admin|deployment|production|system|tenant)\b/;
  const privilegedEffect = /\b(delete|destroy|purge|revoke|rotate|reset|replace|grant|assign|elevate|deploy|uninstall|execute)\b/;
  return privilegedObject.test(normalized) && privilegedEffect.test(normalized);
}

/** Conservative default used only when the authoritative source has no valid tier. */
export function inferToolRiskMapping(candidate = {}) {
  const text = `${candidate.capability_id || candidate.id || candidate.name || ''} ${candidate.display_name || ''} ${candidate.description || ''}`;
  if (criticalPrivilegedRisk(text)) return { risk_tier: 'R4', action_family: 'financial_destructive' };
  const declared = validTier(candidate.risk_tier || candidate.inferred_risk_tier, '');
  if (declared) return { risk_tier: declared, action_family: actionFamilyForRiskTier(declared) };
  const normalized = text.toLowerCase().replace(/[_-]+/g, ' ');
  if (/\b(delete|destroy|purge|trash|refund|payment|transfer|trade|submit|cancel)\b/.test(normalized)) {
    return { risk_tier: 'R3', action_family: 'financial_destructive' };
  }
  if (/\b(send|publish|post|message|email|invite|notify|comment|reply|share)\b/.test(normalized)) {
    return { risk_tier: 'R2', action_family: 'communicate_external' };
  }
  if (/\b(create|update|upsert|write|set|edit|append|assign|schedule|move|archive|draft)\b/.test(normalized)) {
    return { risk_tier: 'R1', action_family: 'write_internal' };
  }
  if (/\b(read|list|get|fetch|find|search|query|inspect|status|history|summarize|lookup|download)\b/.test(normalized)) {
    return { risk_tier: 'R0', action_family: 'read' };
  }
  return { risk_tier: 'R2', action_family: 'communicate_external' };
}

function normalizeCandidate(candidate = {}) {
  const capabilityType = String(candidate.capability_type || candidate.type || '').trim();
  const sourceId = String(candidate.source_id || candidate.sourceId || '').trim();
  const capabilityId = String(candidate.capability_id || candidate.capabilityId || candidate.id || candidate.name || '').trim();
  const capabilityKey = String(
    candidate.capability_key || candidate.capabilityKey ||
    (capabilityType === 'mcp_tool' ? `${sourceId}::${capabilityId}` : capabilityId)
  ).trim();
  if (!TOOL_RISK_TYPES.includes(capabilityType) || !capabilityId || !capabilityKey) return null;
  const inferred = inferToolRiskMapping(candidate);
  return {
    capability_type: capabilityType,
    capability_key: capabilityKey,
    source_id: sourceId,
    capability_id: capabilityId,
    display_name: String(candidate.display_name || candidate.displayName || capabilityId).trim(),
    description: String(candidate.description || candidate.purpose || '').trim(),
    inferred_risk_tier: inferred.risk_tier,
  };
}

export function syncToolRiskMappingCandidates(ownerUserId, candidates = []) {
  ensureToolRiskMappingTable();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('CEO context required'), { status: 403 });
  const rows = (Array.isArray(candidates) ? candidates : []).map(normalizeCandidate).filter(Boolean);
  const put = getDb().prepare(`
    INSERT INTO tool_risk_mappings
      (owner_user_id, capability_type, capability_key, source_id, capability_id, display_name, description, inferred_risk_tier)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_user_id, capability_type, capability_key) DO UPDATE SET
      source_id = excluded.source_id,
      capability_id = excluded.capability_id,
      display_name = excluded.display_name,
      description = excluded.description,
      inferred_risk_tier = excluded.inferred_risk_tier,
      updated_at = datetime('now')
  `);
  getDb().transaction(() => {
    for (const row of rows) {
      put.run(owner, row.capability_type, row.capability_key, row.source_id, row.capability_id,
        row.display_name, row.description, row.inferred_risk_tier);
    }
  })();
  return rows.length;
}

function knownCandidates(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const content = getDb().prepare(`
    SELECT name AS capability_id, display_name, purpose AS description, risk_tier
    FROM content_tools_meta WHERE enabled = 1 ORDER BY name
  `).all().map((row) => ({ ...row, capability_type: 'content_tool' }));
  const mcp = getDb().prepare(`
    SELECT c.server_id AS source_id, c.tool_name AS capability_id, c.description,
           s.name AS server_name
    FROM mcp_tools_cache c
    JOIN mcp_servers s ON s.id = c.server_id
    WHERE s.status = 'healthy'
      AND ((s.is_platform = 1 AND s.owner_role = 'admin') OR (s.owner_role = 'ceo' AND s.owner_user_id = ?))
    ORDER BY s.name, c.tool_name
  `).all(owner).map((row) => ({
    ...row,
    capability_type: 'mcp_tool',
    capability_key: `${row.source_id}::${row.capability_id}`,
    display_name: row.capability_id,
  }));
  const connectors = getDb().prepare(`
    SELECT action_id AS capability_id, description, risk_tier
    FROM connector_action_registry ORDER BY action_id
  `).all().map((row) => ({ ...row, capability_type: 'connector_action' }));
  return [...content, ...mcp, ...connectors];
}

export function syncKnownToolRiskMappings(ownerUserId) {
  return syncToolRiskMappingCandidates(ownerUserId, knownCandidates(ownerUserId));
}

function publicRow(row) {
  const inferredTier = validTier(row.inferred_risk_tier);
  const overrideTier = row.override_risk_tier ? validTier(row.override_risk_tier) : null;
  const riskTier = overrideTier || inferredTier;
  return {
    capability_type: row.capability_type,
    capability_key: row.capability_key,
    source_id: row.source_id || '',
    capability_id: row.capability_id,
    display_name: row.display_name || row.capability_id,
    description: row.description || '',
    inferred_risk_tier: inferredTier,
    override_risk_tier: overrideTier,
    risk_tier: riskTier,
    action_family: actionFamilyForRiskTier(riskTier),
    mapping_source: overrideTier ? 'user_override' : 'interpreted_default',
    updated_at: row.updated_at || null,
  };
}

export function listToolRiskMappings(ownerUserId, { type = '', query = '' } = {}) {
  const owner = String(ownerUserId || '').trim();
  syncKnownToolRiskMappings(owner);
  const clauses = ['owner_user_id = ?'];
  const params = [owner];
  if (TOOL_RISK_TYPES.includes(String(type || '').trim())) {
    clauses.push('capability_type = ?');
    params.push(String(type).trim());
  }
  if (String(query || '').trim()) {
    const q = `%${String(query).trim().toLowerCase()}%`;
    clauses.push(`(lower(capability_id) LIKE ? OR lower(display_name) LIKE ? OR lower(description) LIKE ? OR lower(source_id) LIKE ?)`);
    params.push(q, q, q, q);
  }
  return getDb().prepare(`
    SELECT * FROM tool_risk_mappings WHERE ${clauses.join(' AND ')}
    ORDER BY capability_type, source_id, capability_id
  `).all(...params).map(publicRow);
}

export function resolveToolRiskMapping(ownerUserId, capabilityType, capabilityKey, fallback = {}) {
  const owner = String(ownerUserId || '').trim();
  const type = String(capabilityType || '').trim();
  const key = String(capabilityKey || '').trim();
  const fallbackTier = validTier(fallback.risk_tier, 'R2');
  if (!owner || !TOOL_RISK_TYPES.includes(type) || !key) {
    return { risk_tier: fallbackTier, action_family: actionFamilyForRiskTier(fallbackTier), mapping_source: 'runtime_fallback' };
  }
  const parts = type === 'mcp_tool' ? key.split('::') : ['', key];
  syncToolRiskMappingCandidates(owner, [{
    capability_type: type,
    capability_key: key,
    source_id: fallback.source_id || parts[0] || '',
    capability_id: fallback.capability_id || (type === 'mcp_tool' ? parts.slice(1).join('::') : key),
    display_name: fallback.display_name,
    description: fallback.description,
    risk_tier: fallbackTier,
  }]);
  const row = getDb().prepare(`
    SELECT * FROM tool_risk_mappings
    WHERE owner_user_id = ? AND capability_type = ? AND capability_key = ?
  `).get(owner, type, key);
  return row ? publicRow(row) : { risk_tier: fallbackTier, action_family: actionFamilyForRiskTier(fallbackTier), mapping_source: 'runtime_fallback' };
}

export function resolvePolicyToolRiskMapping(ownerUserId, toolName, fallback = {}) {
  const tool = String(toolName || '').trim();
  if (tool.startsWith('connector_action:')) {
    const actionId = tool.slice('connector_action:'.length);
    return resolveToolRiskMapping(ownerUserId, 'connector_action', actionId, { ...fallback, capability_id: actionId });
  }
  if (tool.startsWith('mcp_bound_action|')) {
    const parts = tool.split('|');
    const sourceId = parts[3] || '';
    const capabilityId = parts.slice(4).join('|');
    return resolveToolRiskMapping(ownerUserId, 'mcp_tool', `${sourceId}::${capabilityId}`, {
      ...fallback, source_id: sourceId, capability_id: capabilityId,
    });
  }
  return resolveToolRiskMapping(ownerUserId, 'content_tool', tool, { ...fallback, capability_id: tool });
}

export function setToolRiskMappingOverride(ownerUserId, input = {}) {
  const owner = String(ownerUserId || '').trim();
  const type = String(input.capability_type || input.type || '').trim();
  const key = String(input.capability_key || input.key || '').trim();
  const tier = validTier(input.risk_tier, '');
  if (!owner) throw Object.assign(new Error('CEO context required'), { status: 403 });
  if (!TOOL_RISK_TYPES.includes(type)) throw Object.assign(new Error('Valid capability_type required'), { status: 400 });
  if (!key) throw Object.assign(new Error('capability_key required'), { status: 400 });
  if (!tier) throw Object.assign(new Error('risk_tier must be R0, R1, R2, R3, or R4'), { status: 400 });
  syncKnownToolRiskMappings(owner);
  const changed = getDb().prepare(`
    UPDATE tool_risk_mappings SET override_risk_tier = ?, updated_at = datetime('now')
    WHERE owner_user_id = ? AND capability_type = ? AND capability_key = ?
  `).run(tier, owner, type, key).changes;
  if (!changed) throw Object.assign(new Error('Capability mapping not found'), { status: 404 });
  return publicRow(getDb().prepare(`
    SELECT * FROM tool_risk_mappings
    WHERE owner_user_id = ? AND capability_type = ? AND capability_key = ?
  `).get(owner, type, key));
}

export function clearToolRiskMappingOverride(ownerUserId, input = {}) {
  const owner = String(ownerUserId || '').trim();
  const type = String(input.capability_type || input.type || '').trim();
  const key = String(input.capability_key || input.key || '').trim();
  if (!owner) throw Object.assign(new Error('CEO context required'), { status: 403 });
  const changed = getDb().prepare(`
    UPDATE tool_risk_mappings SET override_risk_tier = NULL, updated_at = datetime('now')
    WHERE owner_user_id = ? AND capability_type = ? AND capability_key = ?
  `).run(owner, type, key).changes;
  if (!changed) throw Object.assign(new Error('Capability mapping not found'), { status: 404 });
  return publicRow(getDb().prepare(`
    SELECT * FROM tool_risk_mappings
    WHERE owner_user_id = ? AND capability_type = ? AND capability_key = ?
  `).get(owner, type, key));
}
