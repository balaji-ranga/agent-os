/** Tenant-scoped live capability registry and deterministic intent scoring. */
import { getDb } from '../db/schema.js';
import { getRecipe, recipeRequiredInputs } from './browser-recipes.js';
import { isEligiblePlanningAgent } from './intent-classifier.js';

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'into', 'your', 'please', 'want', 'need', 'use', 'run']);

function safeRows(sql, args = []) {
  try { return getDb().prepare(sql).all(...args); } catch { return []; }
}
function words(value) {
  return [...new Set(String(value || '').toLowerCase().replace(/https?:\/\//g, ' ').replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP.has(word)))];
}
function parseJson(raw, fallback = {}) {
  try { return JSON.parse(raw || '') ?? fallback; } catch { return fallback; }
}
function candidate({ id, kind, name, description = '', status = '', execution = null, metadata = {} }) {
  return { id: String(id), kind, name: String(name || id), description: String(description || ''), status, execution, metadata };
}

export function buildRuntimeCapabilityRegistry(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('CEO context required'), { status: 403 });
  const entries = [];
  for (const row of safeRows(
    `SELECT id, name, description, status, chat_trigger_phrase FROM agent_workflow_definitions
     WHERE owner_user_id = ? AND status = 'published' AND COALESCE(paused, 0) = 0`, [owner]
  )) entries.push(candidate({
    id: row.id, kind: 'workflow', name: row.name, description: `${row.description || ''} ${row.chat_trigger_phrase || ''}`,
    status: row.status, execution: { type: 'workflow_trigger', phrase: row.chat_trigger_phrase || row.name, workflow_id: row.id },
  }));
  for (const row of safeRows(
    `SELECT id, name, description, status, start_url FROM browser_recipes WHERE ceo_user_id = ? AND status = 'published'`, [owner]
  )) {
    const recipe = getRecipe(owner, row.id);
    entries.push(candidate({
      id: row.id, kind: 'recipe', name: row.name, description: `${row.description || ''} ${row.start_url || ''}`,
      status: row.status,
      execution: { type: 'agent_tool', tool_name: 'browse_recipe_run', args: { recipe_name: row.name } },
      metadata: { required_inputs: recipeRequiredInputs(recipe), start_url: row.start_url || null },
    }));
  }
  for (const row of safeRows(
    `SELECT s.id, s.name, s.description, s.status,
            GROUP_CONCAT(t.tool_name || ' ' || COALESCE(t.description, ''), ' ') AS tools
     FROM mcp_servers s LEFT JOIN mcp_tools_cache t ON t.server_id = s.id
     WHERE s.status = 'healthy' AND ((s.owner_user_id = ? AND s.owner_role = 'ceo') OR (s.is_platform = 1 AND s.owner_role = 'admin'))
     GROUP BY s.id`, [owner]
  )) entries.push(candidate({
    id: row.id, kind: 'connector', name: row.name, description: `${row.description || ''} ${row.tools || ''}`,
    status: row.status, metadata: { available: true },
  }));
  for (const row of safeRows(
    `SELECT a.id, a.name, a.role, a.department, COALESCE(a.planning_status, 'production') AS planning_status
     FROM agents a
     INNER JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
     WHERE COALESCE(a.is_coo, 0) = 0 AND COALESCE(a.planning_status, 'production') = 'production'`, [owner]
  )) {
    if (!isEligiblePlanningAgent(row)) continue;
    entries.push(candidate({
      id: row.id, kind: 'employee', name: row.name, description: `${row.role || ''} ${row.department || ''}`,
      status: 'available', execution: { type: 'specialty_task', agent_id: row.id },
      metadata: { planning_status: row.planning_status },
    }));
  }
  for (const row of safeRows(
    `SELECT id, device_name, driver_mode, capabilities_json, online, last_heartbeat_at
     FROM browser_executor_nodes WHERE owner_user_id = ? AND online = 1`, [owner]
  )) entries.push(candidate({
    id: row.id, kind: 'executor', name: row.device_name || row.driver_mode, description: `${row.driver_mode} ${JSON.stringify(parseJson(row.capabilities_json))}`,
    status: 'online', metadata: { driver_mode: row.driver_mode, capabilities: parseJson(row.capabilities_json), last_heartbeat_at: row.last_heartbeat_at },
  }));
  return entries;
}

export function scoreRuntimeCapability(query, entry) {
  const q = words(query);
  const nameWords = words(entry.name);
  const allWords = words(`${entry.name} ${entry.description}`);
  const matched = q.filter((word) => allWords.includes(word));
  const nameMatched = q.filter((word) => nameWords.includes(word));
  const phrase = String(entry.name || '').trim().toLowerCase();
  const queryText = String(query || '').toLowerCase();
  let score = matched.length * 8 + nameMatched.length * 5;
  if (q.length) score += Math.round((matched.length / q.length) * 40);
  if (phrase.length >= 4 && queryText.includes(phrase)) score += 50;
  if (['published', 'healthy', 'available', 'online'].includes(entry.status)) score += 5;
  return { score, matched_terms: matched, query_terms: q, name_match: nameMatched };
}

export function resolveRuntimeCapability(ownerUserId, query, { limit = 8, threshold = 30 } = {}) {
  const registry = buildRuntimeCapabilityRegistry(ownerUserId);
  const candidates = registry.map((entry) => {
    const evidence = scoreRuntimeCapability(query, entry);
    return { ...entry, score: evidence.score, decision_evidence: evidence };
  }).filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const actionable = candidates.filter((entry) => entry.execution);
  const selected = actionable[0]?.score >= Number(threshold) ? actionable[0] : null;
  return {
    query: String(query || ''), selected,
    candidates: candidates.slice(0, Math.min(20, Math.max(1, Number(limit) || 8))),
    decision: selected ? 'matched' : 'no_confident_match', threshold: Number(threshold),
    registry_counts: registry.reduce((out, entry) => ({ ...out, [entry.kind]: (out[entry.kind] || 0) + 1 }), {}),
  };
}

export function mergeRuntimeCapabilityStep(existing, ownerUserId, prompt) {
  let out = Array.isArray(existing) ? [...existing] : [];
  if (!ownerUserId) return out;
  const resolution = resolveRuntimeCapability(ownerUserId, prompt);
  const selected = resolution.selected;
  if (!selected) return out;
  const selectedName = String(selected.name || '').trim().toLowerCase();
  const promptText = String(prompt || '').toLowerCase();
  const explicitlyNamed = selectedName.length >= 4 && promptText.includes(selectedName);
  const authoritativeTypes = new Set(['workflow_trigger', 'agent_tool', 'specialty_task', 'human_task']);
  const hasAuthoritativeExecutor = out.some((step) =>
    authoritativeTypes.has(String(step.type || step.step_type || ''))
  );
  // Word-overlap registry scoring is an emergency resolver, not a second plan
  // author. Once semantic/catalog routing has selected an executable step, a
  // fuzzy match may not append an unrelated employee or workflow. An exact
  // catalog name in the CEO's request remains an explicit requirement.
  if (hasAuthoritativeExecutor && selected.kind !== 'recipe' && !explicitlyNamed) return out;
  // A typed human step is already the policy decision for this work. Do not
  // append a semantically similar AI employee behind it through the independent
  // runtime registry path.
  if (selected.kind === 'employee' && out.some((step) => String(step.type || step.step_type || '') === 'human_task')) {
    return out;
  }
  const decisiveSingleIntent = selected.kind === 'recipe' &&
    selected.decision_evidence.matched_terms.length >= 2 &&
    !/\b(and then|then|after that|also)\b/i.test(String(prompt || ''));
  if (decisiveSingleIntent && selected.kind === 'recipe') {
    out = out.filter((step) => !['agent_continue', 'specialty_task'].includes(String(step.type || step.step_type || '')));
  } else if (out.length === 1 && String(out[0]?.type || out[0]?.step_type || '') === 'agent_continue') {
    out = [];
  }
  const duplicate = out.some((step) => {
    const spec = step.spec || step;
    if (selected.kind === 'workflow') return String(spec.phrase || '').toLowerCase() === String(selected.execution.phrase || '').toLowerCase();
    if (selected.kind === 'recipe') return String(spec.tool_name || '') === 'browse_recipe_run';
    if (selected.kind === 'employee') return String(spec.agent_id || '') === String(selected.execution.agent_id || '');
    return false;
  });
  if (duplicate) return out;
  const evidence = {
    resolver: 'runtime_registry_v1', candidate_id: selected.id, candidate_kind: selected.kind,
    score: selected.score, matched_terms: selected.decision_evidence.matched_terms,
    explicitly_named: explicitlyNamed,
  };
  if (selected.kind === 'workflow') out.push({
    type: 'workflow_trigger', label: selected.name, phrase: selected.execution.phrase,
    workflow_id: selected.execution.workflow_id, resolution_evidence: evidence,
  });
  else if (selected.kind === 'recipe') out.push({
    type: 'agent_tool', label: `Browser recipe: ${selected.name}`, tool_name: 'browse_recipe_run',
    args: selected.execution.args, required_inputs: selected.metadata.required_inputs, resolution_evidence: evidence,
  });
  else if (selected.kind === 'employee') out.push({
    type: 'specialty_task', label: selected.name, agent_id: selected.execution.agent_id,
    message: String(prompt || ''), resolution_evidence: evidence,
  });
  return out;
}
