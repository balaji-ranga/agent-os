/**
 * Snapshot a CEO company into a blueprint payload for admin publish.
 * Captures Day 0 (org, agents+tools+workspace MD, knowledge, policies, operate model)
 * and Day 1 artefacts (workflows graph JSON, scheduled goals, connectors metadata without secrets).
 */
import { getDb } from '../db/schema.js';
import {
  ensureStrategyRow,
  parseJson,
  defaultJourney,
} from './onboarding-helper.js';
import { listAgentsForUser } from './users.js';
import { getBlueprint } from './company-blueprints/index.js';
import { listTables, findTableByName } from './master-data.js';
import { getOperatingModelTemplate, sanitizeOperatingModel } from './company-operate-models/index.js';
import { listDefinitions, createDefinition, getDefinition, updateDraft, publishDefinition } from './agent-workflow-store.js';
import { listScheduledGoals, createScheduledGoal } from './scheduled-goals.js';
import { getCeoGuardrails, upsertCeoGuardrails, mergeUniversalSafetyPolicy } from './ceo-guardrails.js';
import { listDepartmentsForOwner } from './ceo-default-master-data.js';
import { getAgentToolGrants } from './openclaw-agent-tools.js';
import { listOauthConnectorsForUser } from './mcp-oauth.js';
import { getOpenConnectorLink } from './openconnector.js';
import { TEMPLATE_FILE_KEYS } from './platform-agent-workspace-templates.js';
import * as workspace from '../workspace/adapter.js';

/** Workspace MD keys exported into agents_md.files (ops is AGENT-OS-OPS.md). */
const AGENT_MD_KEYS = [
  ...new Set([
    ...TEMPLATE_FILE_KEYS, // soul, agents, memory, identity, tools, ops
    'user',
  ]),
];

const API_PUBLISH_TOOLS = [
  'agent_workflow_trigger',
  'agent_workflow_status',
  'agent_workflow_list',
  'agent_workflow_inspect',
];
const BROWSER_FALLBACK_TOOLS = [
  'browse_task_start',
  'browse_task_status',
  'browse_recipe_list',
  'browse_recipe_run',
];
const CONTENT_MD_TOOLS = [
  'learnings_summary',
  'master_data_rag',
  'master_data_list_rows',
  'master_data_insert_row',
  'notify_ceo',
  'kanban_create_task',
];

function getStrategic(row) {
  return parseJson(row?.strategic_profile_json, {});
}

function agentToolsFromDb(agentId) {
  try {
    const grants = getAgentToolGrants(agentId);
    if (grants?.length) return grants;
  } catch {
    /* fall through */
  }
  const db = getDb();
  try {
    const rows = db
      .prepare(`SELECT tool_name FROM agent_tool_grants WHERE agent_id = ? ORDER BY tool_name`)
      .all(agentId);
    if (rows?.length) return rows.map((r) => r.tool_name);
  } catch {
    /* schema may differ */
  }
  return null;
}

function ensureTools(tools, extra) {
  const out = Array.isArray(tools) ? [...tools] : [];
  for (const t of extra) {
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

function mergeAgents(liveAgents, baseAgents) {
  const byName = new Map();
  for (const a of baseAgents || []) {
    byName.set(String(a.name || '').toLowerCase(), {
      name: a.name,
      role: a.role || a.name,
      department: a.department || 'Operations',
      tools: Array.isArray(a.tools) ? [...a.tools] : [...CONTENT_MD_TOOLS],
    });
  }
  for (const a of liveAgents || []) {
    const key = String(a.name || '').toLowerCase();
    if (!key) continue;
    let tools = agentToolsFromDb(a.id) || byName.get(key)?.tools || [...CONTENT_MD_TOOLS];
    tools = ensureTools(tools, CONTENT_MD_TOOLS.filter((t) => !t.startsWith('master_data_insert')));
    if (/channel publisher|publisher/i.test(a.name || a.role || '')) {
      tools = ensureTools(tools, [...API_PUBLISH_TOOLS, ...BROWSER_FALLBACK_TOOLS, 'master_data_list_rows', 'master_data_insert_row']);
    }
    if (/community manager/i.test(a.name || a.role || '')) {
      tools = ensureTools(tools, [
        'summarize_url',
        'master_data_list_rows',
        'master_data_update_row',
        'master_data_insert_row',
        'agent_workflow_trigger',
      ]);
    }
    if (/media generator|content strategist|content reviewer/i.test(a.name || a.role || '')) {
      tools = ensureTools(tools, ['master_data_list_rows', 'master_data_insert_row']);
    }
    byName.set(key, {
      name: a.name,
      role: a.role || byName.get(key)?.role || a.name,
      department: a.department || byName.get(key)?.department || 'Operations',
      agent_id_source: a.id || null,
      openclaw_agent_id: a.openclaw_agent_id || null,
      is_coo: !!a.is_coo,
      tools,
    });
  }
  return [...byName.values()];
}

function knowledgeTablesFromOwner(ownerUserId, baseTables) {
  const out = [];
  const seen = new Set();
  try {
    for (const t of listTables(ownerUserId) || []) {
      const name = String(t.name || '').trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      let columns = Array.isArray(t.columns) ? t.columns : [];
      if (!columns.length) {
        try {
          columns = parseJson(t.columns_json || t.schema_json, null) || [];
          if (!Array.isArray(columns) && columns?.columns) columns = columns.columns;
          if (Array.isArray(columns) && columns.length && typeof columns[0] === 'object') {
            columns = columns.map((c) => c.name || c.key).filter(Boolean);
          }
        } catch {
          columns = [];
        }
      }
      // Lightweight sample rows (schema only is primary; up to 3 non-secret seeds)
      let seed_rows = [];
      try {
        const full = findTableByName(ownerUserId, name);
        if (full?.id) {
          const db = getDb();
          const rows = db
            .prepare(
              `SELECT row_json FROM master_data_rows WHERE table_id = ? AND owner_user_id = ? ORDER BY id ASC LIMIT 3`
            )
            .all(full.id, ownerUserId);
          seed_rows = (rows || [])
            .map((r) => {
              try {
                return JSON.parse(r.row_json || '{}');
              } catch {
                return null;
              }
            })
            .filter(Boolean)
            .filter((row) => !JSON.stringify(row).match(/password|secret|token|api[_-]?key/i));
        }
      } catch {
        seed_rows = [];
      }
      out.push({
        name,
        description: t.description || t.purpose || 'Live table from publishing company',
        columns: Array.isArray(columns) ? columns : [],
        seed_rows,
      });
    }
  } catch (e) {
    console.warn('[blueprint-publish] listTables', e?.message || e);
  }
  for (const t of baseTables || []) {
    const name = String(t.name || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(t);
  }
  // Ensure content creator ledger tables exist in payload even if empty at source
  for (const required of [
    {
      name: 'content_topics_history',
      description: '20-day topic / post fingerprint ledger for dedupe',
      columns: ['when', 'platform', 'title', 'topic', 'fingerprint', 'status', 'expires_after'],
      seed_rows: [],
    },
    {
      name: 'publish_log',
      description: 'Outbound publish attempts (API / browser)',
      columns: ['when', 'platform', 'title', 'status', 'workflow_run_id', 'notes'],
      seed_rows: [],
    },
    {
      name: 'company_memory',
      description: 'Shared company memory',
      columns: ['item', 'detail'],
      seed_rows: [],
    },
  ]) {
    if (!seen.has(required.name.toLowerCase())) {
      seen.add(required.name.toLowerCase());
      out.push(required);
    }
  }
  return out;
}

function agentIdToNameMap(agents) {
  const m = new Map();
  for (const a of agents || []) {
    if (a?.id) m.set(a.id, a.name || a.id);
  }
  return m;
}

/**
 * Strip absolute agent IDs so graphs can be rematerialized on a new CEO.
 */
export function portableWorkflowGraph(graph, agents) {
  const idToName = agentIdToNameMap(agents);
  const nodes = (graph?.nodes || []).map((n) => {
    if (!n || typeof n !== 'object') return n;
    const data = n.data && typeof n.data === 'object' ? { ...n.data } : {};
    const agentId = data.agentId || data.agent_id;
    const nameRef = data.agentNameRef || data.agentName || data.agent_name || (agentId ? idToName.get(agentId) : null);
    if (nameRef || agentId) {
      data.agentNameRef = nameRef || null;
      data.agentName = nameRef || data.agentName || null;
      data.agentId = null;
      data.agent_id = null;
    }
    return { ...n, data };
  });
  return {
    nodes,
    edges: Array.isArray(graph?.edges) ? graph.edges : [],
    viewport: graph?.viewport || { x: 0, y: 0, zoom: 1 },
  };
}

export function materializeWorkflowGraph(graph, agents) {
  const byName = new Map();
  for (const a of agents || []) {
    if (a?.name) byName.set(String(a.name).toLowerCase(), a);
    if (a?.role) byName.set(String(a.role).toLowerCase(), a);
  }
  const nodes = (graph?.nodes || []).map((n) => {
    if (!n || typeof n !== 'object') return n;
    const data = n.data && typeof n.data === 'object' ? { ...n.data } : {};
    const ref = data.agentNameRef || data.agentName || data.agent_name;
    if (ref) {
      const hit =
        byName.get(String(ref).toLowerCase()) ||
        [...byName.values()].find((a) => String(a.name || '').toLowerCase().includes(String(ref).toLowerCase().split(' ')[0]));
      if (hit) {
        data.agentId = hit.id;
        data.agentName = hit.name;
      }
    }
    return { ...n, data };
  });
  return {
    nodes,
    edges: Array.isArray(graph?.edges) ? graph.edges : [],
    viewport: graph?.viewport || { x: 0, y: 0, zoom: 1 },
  };
}

function workflowTemplatesFromOwner(ownerUserId, agents) {
  const out = [];
  try {
    const defs = listDefinitions(ownerUserId) || [];
    for (const d of defs) {
      if (d.status !== 'published' && !d.published_graph) continue;
      const graphSrc = d.published_graph || d.draft_graph;
      if (!graphSrc || !(graphSrc.nodes || []).length) continue;
      // Stable logical key (drop owner-scoped suffixes where possible)
      let template_key = String(d.id || d.name || 'workflow');
      template_key = template_key
        .replace(new RegExp(String(ownerUserId).replace(/[^a-zA-Z0-9]/g, '[_-]?'), 'gi'), '')
        .replace(/operate-+/i, 'operate-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'workflow';
      // Prefer short keys for well-known workflows
      if (/content-publish-social/i.test(d.id) || /content-publish-social/i.test(d.name)) {
        template_key = 'content-publish-social';
      } else if (/content_pipeline|content-pipeline|content pipeline/i.test(d.id + d.name)) {
        template_key = 'content_pipeline';
      } else if (/community_triage|community triage/i.test(d.id + d.name)) {
        template_key = 'community_triage';
      } else if (/weekly_ops|ops_rollup|ops rollup/i.test(d.id + d.name)) {
        template_key = 'weekly_ops_rollup';
      }
      out.push({
        template_key,
        name: d.name,
        description: d.description || '',
        trigger_modes: d.trigger_modes || ['manual'],
        schedule_cron: d.schedule_cron || '',
        chat_trigger_phrase: d.chat_trigger_phrase || '',
        variables: d.variables && typeof d.variables === 'object' ? d.variables : {},
        graph: portableWorkflowGraph(graphSrc, agents),
        source_definition_id: d.id,
      });
    }
  } catch (e) {
    console.warn('[blueprint-publish] workflow templates', e?.message || e);
  }
  return out;
}

function goalTemplatesFromOwner(ownerUserId) {
  try {
    return (listScheduledGoals(ownerUserId) || [])
      .filter((g) => g.status === 'active' || g.status === 'paused')
      .map((g) => ({
        title: g.title,
        prompt: g.prompt,
        agent_name: g.agent_name || g.agent_id,
        agent_role: g.agent_role || null,
        cadence: g.cadence || 'weekly',
        weekday: g.weekday,
        time_local: g.time_local || '09:00',
        timezone: g.timezone || '',
        source: 'blueprint',
      }));
  } catch (e) {
    console.warn('[blueprint-publish] goal templates', e?.message || e);
    return [];
  }
}

async function agentsMdFromOwner(ownerUserId, agents) {
  const out = [];
  let sharedOps = null;
  try {
    const { readFileSync, existsSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const sharedPath = join(repoRoot, 'openclaw-workspace-templates', '_shared', 'AGENT-OS-OPS.md');
    if (existsSync(sharedPath)) {
      sharedOps = readFileSync(sharedPath, 'utf8');
      if (sharedOps && sharedOps.length > 100000) sharedOps = sharedOps.slice(0, 100000);
    }
  } catch {
    sharedOps = null;
  }

  for (const a of agents || []) {
    try {
      const root = workspace.resolveAgentWorkspaceRoot(a, { ceoUserId: ownerUserId });
      const files = {};
      for (const key of AGENT_MD_KEYS) {
        try {
          const r = await workspace.readWorkspaceFile(key, { workspaceRoot: root });
          const text = String(r?.text || '');
          if (text && text.length < 100000) files[key] = text;
        } catch {
          /* optional file */
        }
      }
      // Fall back to platform shared OPERATING rules so publish always carries ops
      if (!files.ops && sharedOps) {
        files.ops = sharedOps;
      }
      const tools = agentToolsFromDb(a.id) || [];
      if (Object.keys(files).length || tools.length) {
        out.push({
          agent_name: a.name,
          agent_role: a.role || a.name,
          department: a.department || null,
          tools,
          files,
          file_keys: Object.keys(files),
          ops_source: files.ops ? (files.ops === sharedOps ? 'platform_shared' : 'agent_workspace') : null,
        });
      }
    } catch (e) {
      console.warn('[blueprint-publish] agents_md', a?.id, e?.message || e);
    }
  }
  return out;
}

/**
 * Connector catalog for re-apply: structure only (no OAuth tokens, client secrets, or runtime tokens).
 */
function connectorsFromOwner(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const out = {
    mcp_oauth: [],
    ceo_mcp_servers: [],
    openconnector: null,
    note: 'No OAuth tokens, client secrets, API keys, or vault refs — reconnect on install.',
  };
  try {
    const connectors = listOauthConnectorsForUser({ id: owner, role: 'ceo' }) || [];
    out.mcp_oauth = connectors.map((c) => ({
      server_id: c.server_id,
      name: c.name,
      description: c.description || '',
      provider: c.provider,
      scopes: c.platform_scopes || c.scopes || '',
      is_platform: true,
      connected: !!c.connection?.connected,
      account_label: c.connection?.account_label || null,
      // secrets intentionally omitted
    }));
  } catch (e) {
    console.warn('[blueprint-publish] mcp oauth connectors', e?.message || e);
  }
  try {
    const db = getDb();
    const servers = db
      .prepare(
        `SELECT id, name, description, url, transport, status, is_platform, owner_role
         FROM mcp_servers
         WHERE owner_user_id = ? AND owner_role = 'ceo'
         ORDER BY name COLLATE NOCASE ASC`
      )
      .all(owner);
    out.ceo_mcp_servers = (servers || []).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description || '',
      url: s.url || '',
      transport: s.transport || '',
      status: s.status || '',
      // headers_json / auth secrets never exported
    }));
  } catch (e) {
    console.warn('[blueprint-publish] ceo mcp servers', e?.message || e);
  }
  try {
    const link = getOpenConnectorLink(owner);
    if (link) {
      out.openconnector = {
        linked: true,
        connection_name: link.connection_name || null,
        oc_user_id: link.oc_user_id || null,
        linked_at: link.linked_at || null,
        runtime_token_set: !!link.runtime_token_set,
        // runtime_token and vault refs never exported
      };
    } else {
      out.openconnector = { linked: false };
    }
  } catch (e) {
    console.warn('[blueprint-publish] openconnector link', e?.message || e);
  }
  return out;
}

function orgSnapshotFromOwner(ownerUserId, agents) {
  let departments = [];
  try {
    const live = listDepartmentsForOwner(ownerUserId) || [];
    departments = live.map((d) => ({
      name: d.name || d.department || d.title,
      purpose: d.purpose || d.description || '',
      source: 'master_data_departments',
    })).filter((d) => d.name);
  } catch (e) {
    console.warn('[blueprint-publish] departments', e?.message || e);
  }
  const agent_department_map = (agents || []).map((a) => ({
    agent_name: a.name,
    agent_role: a.role || a.name,
    department: a.department || 'Operations',
    is_coo: !!a.is_coo,
  }));
  // Derive dept list from agents if master-data empty
  if (!departments.length && agent_department_map.length) {
    const seen = new Set();
    for (const m of agent_department_map) {
      const n = String(m.department || 'Operations').trim() || 'Operations';
      if (seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      departments.push({ name: n, purpose: `${n} team`, source: 'agents' });
    }
  }
  return { departments, agent_department_map };
}

/**
 * Install portable workflow templates for a new CEO (Day 1).
 */
export function installBlueprintWorkflowTemplates(ownerUserId, templates, agents, actor = null) {
  const results = [];
  if (!Array.isArray(templates) || !templates.length) return results;
  const act = actor || { id: ownerUserId, name: 'blueprint-day1' };
  const ownerSlug = String(ownerUserId)
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .slice(0, 28);

  for (const t of templates) {
    const key = String(t.template_key || t.name || 'workflow')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    const forcedId = (`bp-${key}-${ownerSlug}`).replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 64);
    const graph = materializeWorkflowGraph(t.graph, agents);
    try {
      const prior = getDefinition(forcedId, ownerUserId);
      const patch = {
        name: String(t.name || key).slice(0, 80),
        description: String(t.description || `Installed from company blueprint (${key})`).slice(0, 2000),
        graph,
        trigger_modes: t.trigger_modes || ['manual'],
        schedule_cron: t.schedule_cron || '',
        chat_trigger_phrase: t.chat_trigger_phrase || '',
      };
      if (prior) {
        updateDraft(forcedId, ownerUserId, patch, act);
      } else {
        createDefinition({
          id: forcedId,
          name: patch.name,
          description: patch.description,
          ownerUserId,
          actor: act,
          graph,
          trigger_modes: patch.trigger_modes,
          schedule_cron: patch.schedule_cron,
          chat_trigger_phrase: patch.chat_trigger_phrase,
          variables: t.variables || {},
        });
      }
      let published = false;
      let publish_error = null;
      try {
        publishDefinition(forcedId, ownerUserId, act);
        published = true;
      } catch (pe) {
        publish_error = pe?.message || String(pe);
      }
      results.push({
        template_key: key,
        id: forcedId,
        name: patch.name,
        ok: true,
        published,
        publish_error,
      });
      console.info('[blueprint-publish] workflow installed', forcedId, 'owner=', ownerUserId, 'published=', published);
    } catch (e) {
      console.warn('[blueprint-publish] workflow install failed', key, e?.message || e);
      results.push({ template_key: key, ok: false, error: e?.message || String(e) });
    }
  }
  return results;
}

/**
 * Install scheduled goals by agent name/role (Day 1).
 */
export function installBlueprintGoalTemplates(ownerUserId, templates, agents) {
  const results = [];
  if (!Array.isArray(templates) || !templates.length) return results;
  const byName = new Map((agents || []).map((a) => [String(a.name || '').toLowerCase(), a]));
  const matchAgent = (name, role) => {
    if (name && byName.get(String(name).toLowerCase())) return byName.get(String(name).toLowerCase());
    const needle = String(name || role || '').toLowerCase();
    if (!needle) return null;
    for (const a of agents || []) {
      const hay = `${a.name || ''} ${a.role || ''}`.toLowerCase();
      if (hay.includes(needle) || needle.includes(String(a.name || '').toLowerCase())) return a;
    }
    // COO fallback for weekly ops / content goals
    return (agents || []).find((a) => a.is_coo || /coo|chief operating/i.test(`${a.name} ${a.role}`)) || null;
  };

  for (const g of templates) {
    try {
      const agent = matchAgent(g.agent_name, g.agent_role);
      if (!agent) {
        results.push({ title: g.title, ok: false, error: 'no matching agent' });
        continue;
      }
      // Avoid duplicate titles for same agent
      const existing = (listScheduledGoals(ownerUserId) || []).find(
        (x) =>
          String(x.title || '').toLowerCase() === String(g.title || '').toLowerCase() && x.agent_id === agent.id
      );
      if (existing) {
        results.push({ title: g.title, ok: true, skipped: true, id: existing.id });
        continue;
      }
      let cadence = String(g.cadence || 'weekly').toLowerCase();
      if (!['daily', 'weekdays', 'weekly'].includes(cadence)) cadence = 'weekly';
      const created = createScheduledGoal(ownerUserId, {
        title: g.title,
        prompt: g.prompt,
        agent_id: agent.id,
        cadence,
        weekday: g.weekday != null ? g.weekday : 1,
        time_local: g.time_local || '09:00',
        timezone: g.timezone || undefined,
        source: 'blueprint',
      });
      results.push({ title: g.title, ok: true, id: created?.id, agent_id: agent.id });
      console.info('[blueprint-publish] goal installed', created?.id, 'agent=', agent.id);
    } catch (e) {
      console.warn('[blueprint-publish] goal install', g?.title, e?.message || e);
      results.push({ title: g?.title, ok: false, error: e?.message || String(e) });
    }
  }
  return results;
}

/**
 * Write snapshotted AGENTS/SOUL/TOOLS/MEMORY onto matching agents (Day 1).
 */
export async function applyBlueprintAgentsMd(ownerUserId, agentsMd, agents) {
  const results = [];
  if (!Array.isArray(agentsMd) || !agentsMd.length) return results;
  for (const entry of agentsMd) {
    const needle = String(entry.agent_name || '').toLowerCase();
    const agent =
      (agents || []).find((a) => String(a.name || '').toLowerCase() === needle) ||
      (agents || []).find((a) => String(a.name || '').toLowerCase().includes(needle.split(' ')[0] || '___'));
    if (!agent) {
      results.push({ agent_name: entry.agent_name, ok: false, error: 'agent not found' });
      continue;
    }
    try {
      const root = workspace.resolveAgentWorkspaceRoot(agent, { ceoUserId: ownerUserId });
      const files = entry.files || {};
      const wrote = [];
      for (const [key, text] of Object.entries(files)) {
        if (!text || typeof text !== 'string') continue;
        // Include ops (AGENT-OS-OPS.md), identity, tools, etc.
        if (!AGENT_MD_KEYS.includes(key) && !['org', 'policy'].includes(key)) continue;
        await workspace.writeWorkspaceFile(key, text, { workspaceRoot: root, backup: true });
        wrote.push(key);
      }
      if (Array.isArray(entry.tools) && entry.tools.length) {
        try {
          const { setAgentToolGrants } = await import('./openclaw-agent-tools.js');
          setAgentToolGrants(agent, entry.tools);
          wrote.push('tool_grants');
        } catch (te) {
          console.warn('[blueprint-publish] tool grants apply', agent.id, te?.message || te);
        }
      }
      results.push({ agent_name: agent.name, agent_id: agent.id, ok: true, wrote });
      console.info('[blueprint-publish] agents_md applied', agent.id, 'wrote=', wrote.join(','));
    } catch (e) {
      console.warn('[blueprint-publish] agents_md apply', entry.agent_name, e?.message || e);
      results.push({ agent_name: entry.agent_name, ok: false, error: e?.message || String(e) });
    }
  }
  return results;
}

export function applyBlueprintPolicyText(ownerUserId, policyText) {
  if (!policyText || !String(policyText).trim()) return { ok: false, skipped: true };
  try {
    const merged = mergeUniversalSafetyPolicy(String(policyText));
    const row = upsertCeoGuardrails(ownerUserId, { policyText: merged, enabled: true, mergeSafety: false });
    console.info('[blueprint-publish] policy applied owner=', ownerUserId, 'chars=', merged.length);
    return { ok: true, chars: merged.length, updated_at: row?.updated_at };
  } catch (e) {
    console.warn('[blueprint-publish] policy apply', e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

export function listCompanyBlueprintCandidates({ limit = 40 } = {}) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.enabled, s.status, s.strategic_profile_json, s.updated_at
       FROM platform_users u
       LEFT JOIN ceo_org_strategy s ON s.owner_user_id = u.id
       WHERE u.role = 'ceo'
       ORDER BY u.created_at DESC
       LIMIT ?`
    )
    .all(limit);

  return rows
    .map((u) => {
      const strategic = parseJson(u.strategic_profile_json, {});
      let customAgents = 0;
      try {
        customAgents =
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM user_agents ua
             JOIN agents a ON a.id = ua.agent_id
             WHERE ua.user_id = ? AND ua.enabled = 1 AND (a.agent_type = 'custom' OR a.owner_user_id = ?)`
            )
            .get(u.id, u.id)?.n || 0;
      } catch {
        customAgents = 0;
      }
      const formed =
        u.status === 'applied' ||
        strategic.setup_gate === 'completed' ||
        customAgents > 0 ||
        strategic.operate_gate === 'day1_applied';
      return {
        owner_user_id: u.id,
        email: u.email,
        name: u.name,
        enabled: !!u.enabled,
        company_name: strategic.company_name || null,
        company_type: strategic.company_type || strategic.company_type_card || null,
        blueprint_id: strategic.blueprint_id || null,
        setup_gate: strategic.setup_gate || null,
        operate_gate: strategic.operate_gate || null,
        strategy_status: u.status || null,
        custom_agents: customAgents,
        successful: !!formed,
        mission: strategic.mission ? String(strategic.mission).slice(0, 160) : null,
      };
    })
    .filter((c) => c.successful);
}

/**
 * Full Day 0 + Day 1 snapshot for admin publish.
 * (async wrapper available; sync surface still works without MD files)
 */
export function snapshotOwnerAsBlueprintPayload(ownerUserId) {
  const row = ensureStrategyRow(ownerUserId);
  const strategic = getStrategic(row);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const answers = journey.answers || {};

  const industry = resolveIndustry(strategic);
  const base =
    getBlueprint(strategic.blueprint_id || industry || 'content_creator') ||
    getBlueprint('content_creator') ||
    getBlueprint('general_ops') ||
    {};

  let departments = Array.isArray(answers.departments) ? answers.departments : [];
  let agents = Array.isArray(answers.agents) ? answers.agents : [];

  const liveCustom = listAgentsForUser(ownerUserId).filter(
    (a) => a.agent_type === 'custom' || (a.owner_user_id && a.owner_user_id === ownerUserId)
  );
  const liveAll = liveCustom.length
    ? liveCustom
    : listAgentsForUser(ownerUserId).filter((a) =>
        /coordinator|analyst|manager|strategist|publisher|editor|generator|reporter|community|coo/i.test(
          a.name || ''
        )
      );

  if (agents.length) {
    agents = mergeAgents(
      liveAll.map((a) => ({ ...a })),
      agents
    );
  } else {
    agents = mergeAgents(liveAll, base.agents);
  }

  const liveOrg = orgSnapshotFromOwner(ownerUserId, agents);
  // Prefer live master-data / agent-derived org over journey answers when present
  if (liveOrg.departments.length) {
    departments = liveOrg.departments;
  } else if (!departments.length && agents.length) {
    const depts = new Set(agents.map((a) => a.department || 'Operations'));
    departments = [...depts].map((name) => ({ name, purpose: `${name} team` }));
  } else if (!departments.length && Array.isArray(base.departments)) {
    departments = base.departments;
  }

  const knowledge_tables = knowledgeTablesFromOwner(
    ownerUserId,
    answers.knowledge_tables?.length ? answers.knowledge_tables : base.knowledge_tables
  );

  const sop_documents = [
    ...(Array.isArray(base.sop_documents) ? base.sop_documents : []),
    ...(Array.isArray(answers.sop_documents) ? answers.sop_documents : []),
    ...(Array.isArray(answers.md_files)
      ? answers.md_files
          .filter((m) => m?.title || m?.filename)
          .map((m) => ({
            title: m.title || m.filename,
            filename: m.filename || 'sop.md',
            contentText: m.contentText || m.content || '',
          }))
      : []),
  ];
  // Ensure API-primary publish SOP is present
  const hasApiSop = sop_documents.some((s) =>
    /agent_workflow_trigger|content-publish-social|meta graph|api publish/i.test(
      `${s.title || ''}\n${s.contentText || ''}`
    )
  );
  if (!hasApiSop) {
    sop_documents.push({
      title: 'API social publish (primary)',
      filename: 'api-social-publish.md',
      contentText: `# API social publish (primary)

Channel Publisher must publish via published workflow **content-publish-social** using \`agent_workflow_trigger\`.

## Primary path (Facebook + LinkedIn APIs)
1. Confirm CEO publish gate on Kanban when required.
2. Call \`agent_workflow_list\` / \`agent_workflow_trigger\` on **content-publish-social** with platform, caption, link, media URL.
3. Facebook uses Meta Graph MCP (\`create_page_post\`); LinkedIn uses OpenConnector Share product.
4. After success: write **publish_log** and **content_topics_history** (20-day fingerprint / expires_after).

## Fallback
Browser Session compose only when API connectors are not ready — still autonomous (no CEO composer hand-hold): tab focus, shadow fill, primary post, tab recycle.

## Dedupe
Never reuse topic fingerprints from content_topics_history within 20 days without CEO exception.
`,
    });
  }
  const sopSeen = new Set();
  const sopsDedup = [];
  for (const s of sop_documents) {
    const k = String(s.filename || s.title || '').toLowerCase();
    if (!k || sopSeen.has(k)) continue;
    sopSeen.add(k);
    sopsDedup.push(s);
  }

  // Live operate model preferred over static template
  let operate = null;
  try {
    const template = getOperatingModelTemplate(industry, {
      management_style: strategic.management_style,
      blueprint_id: strategic.blueprint_id,
    });
    if (strategic.operating_model && typeof strategic.operating_model === 'object') {
      operate = sanitizeOperatingModel(strategic.operating_model, template);
    } else {
      operate = template;
    }
  } catch (e) {
    console.warn('[blueprint-publish] operate model', e?.message || e);
    try {
      operate = getOperatingModelTemplate('content_creator');
    } catch {
      operate = null;
    }
  }

  const workflow_templates = workflowTemplatesFromOwner(ownerUserId, liveAll.length ? liveAll : liveCustom);
  const goal_templates = goalTemplatesFromOwner(ownerUserId);
  const connectors = connectorsFromOwner(ownerUserId);
  // agents_md filled asynchronously via snapshotOwnerAsBlueprintPayloadAsync
  let agents_md = [];
  try {
    agents_md = [];
  } catch {
    agents_md = [];
  }

  let policy_text = '';
  try {
    policy_text = String(getCeoGuardrails(ownerUserId)?.policy_text || '').trim();
  } catch {
    policy_text = '';
  }

  const publishQuality = {
    browser_autonomy: base.browser_autonomy || {
      focus_platform_tabs: true,
      shadow_dom_fill: true,
      click_primary_post: true,
      recycle_tab_after_task: true,
      no_human_composer_handhold: true,
    },
    content_topics_history_days: 20,
    cadence: 'event_manual_not_cron',
    gates: ['kanban_ceo_publish_gate'],
    not_gates: ['ceo_tab_focus', 'ceo_open_composer'],
    primary_path: 'api_workflow',
    primary_workflow: 'content-publish-social',
    facebook_via: 'mcp_meta_graph',
    linkedin_via: 'openconnector',
  };

  const day0_day1 = {
    day0: {
      org: true,
      departments: !!(departments || []).length,
      agents: !!(agents || []).length,
      agent_tools: (agents || []).every((a) => Array.isArray(a.tools) && a.tools.length > 0),
      knowledge_tables: !!(knowledge_tables || []).length,
      policies: !!(policy_text || Object.keys(base.policy_templates || {}).length),
      operate_model: !!(operate?.loops || []).length,
      connectors: !!(connectors?.mcp_oauth?.length || connectors?.ceo_mcp_servers?.length || connectors?.openconnector?.linked),
    },
    day1: {
      workflow_templates: workflow_templates.length > 0,
      workflow_graphs: (workflow_templates || []).every((w) => (w.graph?.nodes || []).length > 0),
      goal_templates: goal_templates.length > 0,
      agents_md: agents_md.length > 0,
      agents_md_ops: false,
      sop_documents: sopsDedup.length > 0,
    },
  };

  const systems_recommended = Array.isArray(base.systems_recommended) && base.systems_recommended.length
    ? base.systems_recommended
    : [
        { id: 'policies', label: 'Policies & guardrails', path: '/policies' },
        { id: 'master_data', label: 'Knowledge / Master Data', path: '/master-data' },
        { id: 'connectors', label: 'Connectors (Meta Graph MCP + OpenConnector LinkedIn)', path: '/connectors' },
        { id: 'browser_session', label: 'Browser Session (fallback publish)', path: '/browser-session' },
        { id: 'scheduled_goals', label: 'Scheduled goals', path: '/scheduled-goals' },
        { id: 'agent_workflows', label: 'Agent workflows', path: '/agent-workflows' },
      ];

  return {
    industry,
    company_name: strategic.company_name || null,
    mission: strategic.mission || null,
    operate_gate: strategic.operate_gate || null,
    setup_gate: strategic.setup_gate || null,
    payload: {
      depth: base.depth === 'deep' || agents.length >= 4 ? 'deep' : 'thin',
      platforms: base.platforms || ['facebook', 'instagram', 'linkedin', 'blog'],
      departments: departments || [],
      org: {
        departments: departments || [],
        agent_department_map: liveOrg.agent_department_map || [],
      },
      agents: agents || [],
      workflows: answers.workflows?.length
        ? answers.workflows
        : workflow_templates.map((w) => ({
            id: w.template_key,
            name: w.name,
            description: w.description,
          })),
      workflow_templates,
      goal_templates,
      agents_md,
      connectors,
      channels: answers.channels?.length ? answers.channels : base.channels || [],
      knowledge_tables,
      sop_documents: sopsDedup,
      systems_recommended,
      policy_templates: {
        ...(base.policy_templates && typeof base.policy_templates === 'object' ? base.policy_templates : {}),
        ...(policy_text
          ? {
              after_approval: policy_text,
              published_from_company: policy_text,
            }
          : {}),
      },
      policy_text,
      operate_model_id: base.operate_model_id || industry || 'content_creator',
      operate_model_snapshot: operate
        ? {
            id: operate.id,
            label: operate.label,
            loops: operate.loops,
            daily_tasks: operate.daily_tasks,
            weekly_rituals: operate.weekly_rituals,
            channels: operate.channels,
            systems_run: operate.systems_run,
            goals: operate.goals,
            quality_bars: operate.quality_bars,
            knowledge_seeds: operate.knowledge_seeds,
            autonomy_matrix: operate.autonomy_matrix,
            raci: operate.raci,
            digest: operate.digest,
            escalations: operate.escalations,
          }
        : null,
      browser_autonomy: publishQuality.browser_autonomy,
      publish_quality: publishQuality,
      day0_day1,
      description: strategic.mission
        ? `Published Day 0+1 from ${strategic.company_name || ownerUserId}. Mission: ${String(strategic.mission).slice(0, 200)}. Agents+tools+ops MD, knowledge, policies, org, workflows (full graphs), goals, connector stubs (no secrets).`
        : `Published Day 0+1 from ${strategic.company_name || ownerUserId}. Org, agents (tools + workspace MD including ops), knowledge, policies, goals, multi-agent workflow graphs, connector catalog without secrets.`,
    },
  };
}

/**
 * Async snapshot including workspace AGENTS.md / SOUL / TOOLS.
 */
export async function snapshotOwnerAsBlueprintPayloadAsync(ownerUserId) {
  const snap = snapshotOwnerAsBlueprintPayload(ownerUserId);
  const liveCustom = listAgentsForUser(ownerUserId).filter(
    (a) => a.agent_type === 'custom' || (a.owner_user_id && a.owner_user_id === ownerUserId)
  );
  const liveAll =
    liveCustom.length > 0
      ? liveCustom
      : listAgentsForUser(ownerUserId);
  const agents_md = await agentsMdFromOwner(ownerUserId, liveAll.length ? liveAll : liveCustom);
  snap.payload.agents_md = agents_md;
  // Prefer tools array from live grants on each agents_md entry when agents missed grants
  if (Array.isArray(snap.payload.agents)) {
    const byName = new Map(agents_md.map((m) => [String(m.agent_name || '').toLowerCase(), m]));
    snap.payload.agents = snap.payload.agents.map((a) => {
      const md = byName.get(String(a.name || '').toLowerCase());
      const tools = (Array.isArray(a.tools) && a.tools.length
        ? a.tools
        : md?.tools) || a.tools || [];
      return { ...a, tools };
    });
  }
  if (snap.payload.day0_day1) {
    snap.payload.day0_day1.day1.agents_md = agents_md.length > 0;
    snap.payload.day0_day1.day1.agents_md_ops = agents_md.some((m) => !!(m.files && m.files.ops));
    snap.payload.day0_day1.day0.agent_tools = (snap.payload.agents || []).every(
      (a) => Array.isArray(a.tools) && a.tools.length > 0
    );
  }
  return snap;
}

/**
 * Validate a published (or snapshotted) blueprint covers Day 0 + Day 1 content ops.
 */
export function validateContentBlueprintPayload(payload, { expectedCompanyHint = null } = {}) {
  const p = payload?.payload || payload || {};
  const issues = [];
  const checks = [];

  const needAgents = [
    'Content Strategist',
    'Media Generator',
    'Content Reviewer',
    'Community Manager',
    'Channel Publisher',
    'Ops Reporter',
  ];
  const agentNames = (p.agents || []).map((a) => a.name);
  for (const n of needAgents) {
    const ok = agentNames.some((x) => String(x).toLowerCase().includes(n.toLowerCase().split(' ')[0]));
    checks.push({ id: `agent_${n}`, ok, detail: ok ? 'present' : 'missing' });
    if (!ok) issues.push(`Missing agent role near ${n}`);
  }

  const pub = (p.agents || []).find((a) => /publisher/i.test(a.name || ''));
  const tools = pub?.tools || [];
  // API path preferred; browser still accepted as fallback
  const hasApi = API_PUBLISH_TOOLS.some((t) => tools.includes(t));
  const hasBrowse = BROWSER_FALLBACK_TOOLS.some((t) => tools.includes(t));
  checks.push({ id: 'publisher_api_workflow_tools', ok: hasApi, detail: hasApi ? 'granted' : 'missing agent_workflow_*' });
  if (!hasApi) issues.push('Channel Publisher missing agent_workflow_* tools (API publish path)');
  checks.push({ id: 'publisher_browser_fallback', ok: hasBrowse || hasApi, detail: hasBrowse ? 'browse granted' : 'api-only ok' });

  for (const t of ['master_data_rag']) {
    const ok = tools.includes(t);
    checks.push({ id: `publisher_tool_${t}`, ok, detail: ok ? 'granted' : 'missing' });
    if (!ok) issues.push(`Channel Publisher missing tool ${t}`);
  }

  // All content agents should have master_data_rag
  for (const a of p.agents || []) {
    const ok = (a.tools || []).includes('master_data_rag');
    checks.push({ id: `md_tool_${a.name}`, ok, detail: ok ? 'granted' : 'missing' });
    if (!ok && /strategist|generator|reviewer|publisher|community|reporter/i.test(a.name || '')) {
      issues.push(`Agent ${a.name} missing master_data_rag`);
    }
  }

  const tables = (p.knowledge_tables || []).map((t) => String(t.name || '').toLowerCase());
  for (const t of ['content_topics_history', 'publish_log']) {
    const ok = tables.some((x) => x.includes(t));
    checks.push({ id: `table_${t}`, ok, detail: ok ? 'present' : 'missing' });
    if (!ok) issues.push(`Missing knowledge table ${t}`);
  }

  const sopText = (p.sop_documents || [])
    .map((s) => `${s.title}\n${s.contentText || ''}`)
    .join('\n')
    .toLowerCase();
  const sopPhrases = [
    { id: 'content_topics_history', re: /content_topics_history/i },
    { id: '20_day', re: /20[- ]?day/i },
    { id: 'agent_workflow_trigger', re: /agent_workflow_trigger/i },
    { id: 'content_publish_social', re: /content-publish-social|api social publish|meta graph/i },
  ];
  for (const { id, re } of sopPhrases) {
    const ok = re.test(sopText);
    checks.push({ id: `sop_${id}`, ok, detail: ok ? 'found in SOPs' : 'not in SOPs' });
    if (!ok) issues.push(`SOP text missing mention related to ${id}`);
  }

  const ba = p.browser_autonomy || p.publish_quality?.browser_autonomy || {};
  // Soft: browser autonomy preferred when fallback present
  for (const k of [
    'focus_platform_tabs',
    'shadow_dom_fill',
    'click_primary_post',
    'recycle_tab_after_task',
    'no_human_composer_handhold',
  ]) {
    const ok = ba[k] === true;
    checks.push({ id: `browser_autonomy_${k}`, ok, detail: String(ba[k]) });
    // do not hard-fail if API path is primary and tools present
    if (!ok && !hasApi) issues.push(`browser_autonomy.${k} not true`);
  }

  const wfs = p.workflow_templates || [];
  checks.push({ id: 'day1_workflow_templates', ok: wfs.length > 0, detail: `count=${wfs.length}` });
  if (!wfs.length) issues.push('Missing day1 workflow_templates (publish graphs)');
  const hasPublishSocial = wfs.some(
    (w) =>
      /content-publish-social/i.test(w.template_key || '') ||
      /content-publish-social|api publish|meta/i.test(`${w.name || ''} ${w.description || ''}`)
  );
  checks.push({ id: 'workflow_content_publish_social', ok: hasPublishSocial, detail: hasPublishSocial ? 'present' : 'missing' });
  if (!hasPublishSocial && wfs.length) {
    issues.push('workflow_templates should include content-publish-social (or equivalent API publish graph)');
  }

  const goals = p.goal_templates || [];
  const opGoals = p.operate_model_snapshot?.goals || [];
  const hasGoals = goals.length > 0 || opGoals.length > 0;
  checks.push({ id: 'day1_goal_templates', ok: hasGoals, detail: `scheduled=${goals.length} operate_goals=${opGoals.length}` });
  if (!hasGoals) issues.push('Missing scheduled goal_templates and operate model goals');

  const policyOk = !!(p.policy_text || p.policy_templates?.published_from_company || p.policy_templates?.after_approval);
  checks.push({ id: 'day0_policies', ok: policyOk, detail: policyOk ? 'present' : 'missing' });
  if (!policyOk) issues.push('Missing policies (policy_text / policy_templates)');

  const loops = p.operate_model_snapshot?.loops || [];
  checks.push({ id: 'day0_operate_loops', ok: loops.length > 0, detail: `loops=${loops.length}` });
  if (!loops.length) issues.push('Missing operate_model_snapshot.loops (Day 0)');

  const hasEvent = loops.some((l) => l.cadence === 'event' || l.cadence === 'manual');
  checks.push({ id: 'operate_event_loops', ok: hasEvent || loops.length === 0, detail: `loops=${loops.length}` });
  if (loops.length && !hasEvent) issues.push('operate loops should include event/manual cadence for content publish');

  const depts = p.departments || p.org?.departments || [];
  checks.push({ id: 'day0_org_departments', ok: depts.length > 0, detail: `count=${depts.length}` });
  if (!depts.length) issues.push('Missing organization departments');

  const agentDeptMap = p.org?.agent_department_map || [];
  checks.push({
    id: 'day0_agent_department_map',
    ok: agentDeptMap.length > 0 || (p.agents || []).length === 0,
    detail: `map=${agentDeptMap.length}`,
  });
  if ((p.agents || []).length && !agentDeptMap.length) {
    issues.push('Missing org.agent_department_map (agent → department)');
  }

  const hasMd = Array.isArray(p.agents_md) && p.agents_md.length > 0;
  checks.push({ id: 'day1_agents_md', ok: hasMd, detail: `count=${(p.agents_md || []).length}` });
  if (!hasMd && (p.agents || []).length) issues.push('Missing agents_md workspace files');

  const hasOps = (p.agents_md || []).some((m) => !!(m.files && m.files.ops));
  checks.push({ id: 'day1_agents_md_ops', ok: hasOps || !hasMd, detail: hasOps ? 'ops present' : 'ops missing' });
  if (hasMd && !hasOps) issues.push('agents_md missing ops (AGENT-OS-OPS.md) for all agents');

  const toolsOnAgents = (p.agents || []).filter((a) => Array.isArray(a.tools) && a.tools.length > 0).length;
  checks.push({
    id: 'day0_agent_tools',
    ok: toolsOnAgents === (p.agents || []).length && (p.agents || []).length > 0,
    detail: `with_tools=${toolsOnAgents}/${(p.agents || []).length}`,
  });

  const graphsOk =
    wfs.length > 0 && wfs.every((w) => Array.isArray(w.graph?.nodes) && w.graph.nodes.length > 0);
  checks.push({ id: 'day1_workflow_graphs', ok: graphsOk || !wfs.length, detail: graphsOk ? 'all graphs present' : 'some graphs empty' });
  if (wfs.length && !graphsOk) issues.push('workflow_templates missing full graph JSON definitions');

  const connectors = p.connectors;
  const connectorsOk = !!(
    connectors &&
    (connectors.mcp_oauth?.length || connectors.ceo_mcp_servers?.length || connectors.openconnector)
  );
  checks.push({ id: 'day0_connectors_catalog', ok: connectorsOk, detail: connectorsOk ? 'present (no secrets)' : 'missing' });
  // Soft: connectors may be empty if company never linked; only flag when systems_recommended imply them
  if (!connectors) issues.push('Missing connectors catalog (structure-only, no secrets)');

  if (expectedCompanyHint && p.description) {
    checks.push({ id: 'company_hint', ok: true, detail: 'soft' });
  }

  const d01 = p.day0_day1 || {};
  checks.push({
    id: 'day0_day1_flags',
    ok: !!(d01.day0 && d01.day1),
    detail: JSON.stringify(d01).slice(0, 200),
  });

  return {
    ok: issues.length === 0,
    issues,
    checks,
    summary: issues.length
      ? `Blueprint validation failed: ${issues.length} issue(s)`
      : 'Blueprint validation passed (knowledge, policies, org, agents+tools+ops MD, workflows graphs, connectors, goals)',
  };
}

function resolveIndustry(strategic) {
  return String(strategic.company_type || strategic.company_type_card || 'general_ops')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}
