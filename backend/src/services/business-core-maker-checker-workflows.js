/**
 * Install CRM/ERP Maker-Checker workflow templates per CEO from standard packs.
 * Templates live under company-blueprints/standard/business-core/
 * Called after ensurePrefabCrmAgents / ensurePrefabErpAgents when Profile enables CRM/ERP.
 */
import { getDb } from '../db/schema.js';
import * as store from './agent-workflow-store.js';
import { materializeWorkflowGraph } from './company-blueprint-publish.js';
import {
  loadMakerCheckerWorkflowTemplate,
  ownerWorkflowSlug,
} from './company-blueprints/standard-prefabs.js';

function findGrantedAgentByName(ownerUserId, nameExact) {
  return getDb()
    .prepare(
      `SELECT a.id, a.name FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id
       WHERE ua.user_id = ? AND COALESCE(ua.enabled, 1) = 1 AND lower(a.name) = lower(?)
       LIMIT 1`
    )
    .get(ownerUserId, nameExact);
}

function findGrantedAgentById(ownerUserId, agentId) {
  if (!agentId) return null;
  return getDb()
    .prepare(
      `SELECT a.id, a.name FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id
       WHERE ua.user_id = ? AND COALESCE(ua.enabled, 1) = 1 AND a.id = ?
       LIMIT 1`
    )
    .get(ownerUserId, agentId);
}

export function resolveMakerCheckerPair(ownerUserId, kind, prefabIds = []) {
  const isErp = String(kind || '').toLowerCase() === 'erp';
  const makerNames = isErp
    ? ['ERP Maker A', 'ERP Maker B']
    : ['CRM Maker A', 'CRM Maker B'];
  const checkerNames = isErp ? ['ERP Checker'] : ['CRM Checker'];
  const idPrefixes = isErp
    ? { maker: ['erp-s1-', 'erp-s2-'], checker: ['erp-ap-'] }
    : { maker: ['crm-s1-', 'crm-s2-'], checker: ['crm-ap-'] };

  let maker = null;
  let checker = null;

  for (const n of makerNames) {
    maker = findGrantedAgentByName(ownerUserId, n);
    if (maker) break;
  }
  for (const n of checkerNames) {
    checker = findGrantedAgentByName(ownerUserId, n);
    if (checker) break;
  }

  if (!maker || !checker) {
    for (const id of prefabIds || []) {
      const row = findGrantedAgentById(ownerUserId, id);
      if (!row) continue;
      const low = String(id).toLowerCase();
      if (!maker && idPrefixes.maker.some((p) => low.startsWith(p))) maker = row;
      if (!checker && idPrefixes.checker.some((p) => low.startsWith(p))) checker = row;
    }
  }

  if (!maker || !checker) {
    const rows = getDb()
      .prepare(
        `SELECT a.id, a.name FROM agents a
         INNER JOIN user_agents ua ON ua.agent_id = a.id
         WHERE ua.user_id = ? AND COALESCE(ua.enabled, 1) = 1`
      )
      .all(ownerUserId);
    for (const row of rows) {
      const low = String(row.id).toLowerCase();
      if (!maker && idPrefixes.maker.some((p) => low.startsWith(p))) maker = row;
      if (!checker && idPrefixes.checker.some((p) => low.startsWith(p))) checker = row;
    }
  }

  return { maker, checker };
}

function kindHint(tpl) {
  return tpl?.kind || tpl?.template_key || '';
}

function bindAgentIdsInGraph(graph, maker, checker, tpl) {
  const agents = [];
  const isErp = String(kindHint(tpl)).toLowerCase().includes('erp');
  if (maker) {
    agents.push(maker);
    if (isErp) {
      agents.push({ id: maker.id, name: 'ERP Maker A', role: 'ERP Maker A' });
      agents.push({ id: maker.id, name: 'ERP Maker B', role: 'ERP Maker B' });
    } else {
      agents.push({ id: maker.id, name: 'CRM Maker A', role: 'CRM Maker A' });
      agents.push({ id: maker.id, name: 'CRM Maker B', role: 'CRM Maker B' });
    }
  }
  if (checker) {
    agents.push(checker);
    agents.push({
      id: checker.id,
      name: isErp ? 'ERP Checker' : 'CRM Checker',
      role: isErp ? 'ERP Checker' : 'CRM Checker',
    });
  }
  const material = materializeWorkflowGraph(graph, agents);
  const nodes = (material.nodes || []).map((n) => {
    if (n.type !== 'agent') return n;
    const data = { ...(n.data || {}) };
    const ref = String(data.agentNameRef || data.agentName || '').toLowerCase();
    if (ref.includes('checker') && checker) {
      data.agentId = checker.id;
      data.agentName = checker.name;
    } else if (maker) {
      data.agentId = maker.id;
      data.agentName = maker.name;
    }
    return { ...n, data };
  });
  return { ...material, nodes };
}

function upsertWorkflow(ownerUserId, { name, description, chatPhrase, graph, forcedId, triggerModes }) {
  const actor = { id: 'system', name: 'standard-mc-workflow' };
  const existing = getDb()
    .prepare(
      `SELECT id FROM agent_workflow_definitions WHERE owner_user_id = ? AND (id = ? OR name = ?) ORDER BY updated_at DESC LIMIT 1`
    )
    .get(ownerUserId, forcedId, name);
  const patch = {
    name,
    description,
    graph,
    trigger_modes: triggerModes || ['manual', 'chat'],
    chat_trigger_phrase: chatPhrase,
  };
  if (existing) {
    store.updateDraft(existing.id, ownerUserId, patch, actor);
    store.publishDefinition(existing.id, ownerUserId, actor);
    return { id: existing.id, action: 'updated' };
  }
  const def = store.createDefinition({
    ...patch,
    ownerUserId,
    actor,
    id: forcedId,
  });
  store.publishDefinition(def.id, ownerUserId, actor);
  return { id: def.id, action: 'created' };
}

export function seedMakerCheckerWorkflowsForOwner(ownerUserId, opts = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return { ok: false, skipped: 'no owner', results: [] };
  const safe = ownerWorkflowSlug(owner);
  const kinds = Array.isArray(opts.kinds) && opts.kinds.length ? opts.kinds : ['crm', 'erp'];
  const results = [];
  const skipped = [];

  for (const kind of kinds) {
    const isErp = kind === 'erp';
    const tpl = loadMakerCheckerWorkflowTemplate(kind);
    if (!tpl?.graph?.nodes?.length) {
      skipped.push({ kind, reason: 'template_missing' });
      console.warn('[mc-workflows] template missing kind=%s', kind);
      continue;
    }
    const prefabIds = isErp ? opts.erpPrefabIds : opts.crmPrefabIds;
    const { maker, checker } = resolveMakerCheckerPair(owner, kind, prefabIds);
    if (!maker || !checker) {
      skipped.push({ kind, reason: 'prefab_agents_missing', maker: !!maker, checker: !!checker });
      continue;
    }
    const graph = bindAgentIdsInGraph(tpl.graph, maker, checker, tpl);
    const forcedId = String(tpl.workflow_id_pattern || kind + '-mc-{ownerSlug}')
      .replace('{ownerSlug}', safe)
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .slice(0, 64);
    try {
      const up = upsertWorkflow(owner, {
        name: tpl.name || kind.toUpperCase() + ': maker checker',
        description: tpl.description || '',
        chatPhrase: tpl.chat_trigger_phrase || 'run ' + kind + ' maker checker',
        graph,
        forcedId,
        triggerModes: tpl.trigger_modes,
      });
      results.push({ kind, maker_id: maker.id, checker_id: checker.id, ...up });
      console.info(
        '[mc-workflows] seeded kind=%s owner=%s id=%s action=%s',
        kind,
        owner,
        up.id,
        up.action
      );
    } catch (e) {
      console.warn('[mc-workflows] seed failed kind=%s owner=%s', kind, owner, e?.message || e);
      skipped.push({ kind, reason: e?.message || String(e) });
    }
  }

  return { ok: true, owner, results, skipped };
}

export function seedMakerCheckerWorkflowsForBusinessProfile(ownerUserId, profile) {
  const p = profile || {};
  const kinds = [];
  if (p.crm_provider === 'twenty' || p.crm_provider === 'erpnext') kinds.push('crm');
  if (p.erp_provider === 'erpnext') kinds.push('erp');
  if (!kinds.length) {
    return {
      ok: true,
      owner: ownerUserId,
      results: [],
      skipped: [{ reason: 'crm_erp_disabled' }],
    };
  }
  return seedMakerCheckerWorkflowsForOwner(ownerUserId, {
    kinds,
    crmPrefabIds: p.prefab_crm_agent_ids || [],
    erpPrefabIds: p.prefab_erp_agent_ids || [],
  });
}