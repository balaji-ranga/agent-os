/**
 * Install video_content workflows from golden standard JSON.
 * Templates: company-blueprints/standard/video-content/workflow-*.json
 */
import { getDb } from '../db/schema.js';
import * as store from './agent-workflow-store.js';
import { materializeWorkflowGraph } from './company-blueprint-publish.js';
import {
  listVideoContentWorkflowTemplates,
  loadVideoContentWorkflowTemplate,
  ownerWorkflowSlug,
  getVideoAgentDefs,
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

function resolveVideoSpecialists(ownerUserId, prefabIds = []) {
  const byRole = {
    story: null,
    scene: null,
    prompt: null,
    orchestrator: null,
  };
  const nameMap = {
    story: ['Story Agent'],
    scene: ['Scene Planner'],
    prompt: ['Prompt Agent'],
    orchestrator: ['Content Orchestrator'],
  };
  for (const [role, names] of Object.entries(nameMap)) {
    for (const n of names) {
      const hit = findGrantedAgentByName(ownerUserId, n);
      if (hit) {
        byRole[role] = hit;
        break;
      }
    }
  }
  const defs = getVideoAgentDefs(ownerUserId);
  for (const def of defs) {
    const row = findGrantedAgentById(ownerUserId, def.id);
    if (!row) continue;
    const key = String(def.role_key || def.key || '');
    if (key && !byRole[key]) byRole[key] = row;
  }
  for (const id of prefabIds || []) {
    const row = findGrantedAgentById(ownerUserId, id);
    if (!row) continue;
    const low = String(id).toLowerCase();
    if (!byRole.story && low.includes('story')) byRole.story = row;
    if (!byRole.scene && low.includes('scene')) byRole.scene = row;
    if (!byRole.prompt && low.includes('prompt')) byRole.prompt = row;
    if (!byRole.orchestrator && low.includes('orch')) byRole.orchestrator = row;
  }
  return byRole;
}

function bindVideoAgentsInGraph(graph, specialists) {
  const agents = [];
  for (const row of Object.values(specialists)) {
    if (row?.id) agents.push(row);
  }
  // Aliases for materializeWorkflowGraph name matching
  if (specialists.story) {
    agents.push({ id: specialists.story.id, name: 'Story Agent', role: 'Story Agent' });
  }
  if (specialists.scene) {
    agents.push({ id: specialists.scene.id, name: 'Scene Planner', role: 'Scene Planner' });
  }
  if (specialists.prompt) {
    agents.push({ id: specialists.prompt.id, name: 'Prompt Agent', role: 'Prompt Agent' });
  }
  if (specialists.orchestrator) {
    agents.push({
      id: specialists.orchestrator.id,
      name: 'Content Orchestrator',
      role: 'Content Orchestrator',
    });
  }
  const material = materializeWorkflowGraph(graph, agents);
  const nodes = (material.nodes || []).map((n) => {
    if (n.type !== 'agent') return n;
    const data = { ...(n.data || {}) };
    const ref = String(data.agentNameRef || data.agentName || '').toLowerCase();
    let pick = null;
    if (ref.includes('story')) pick = specialists.story;
    else if (ref.includes('scene')) pick = specialists.scene;
    else if (ref.includes('prompt')) pick = specialists.prompt;
    else if (ref.includes('orchestr')) pick = specialists.orchestrator;
    if (pick) {
      data.agentId = pick.id;
      data.agentName = pick.name;
    }
    return { ...n, data };
  });
  return { ...material, nodes };
}

function upsertWorkflow(ownerUserId, { name, description, chatPhrase, graph, forcedId, triggerModes }) {
  const actor = { id: 'system', name: 'standard-video-workflow' };
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

/**
 * Seed Phase 1 (and optionally stub Phase 2) video workflows for one CEO.
 * Loads graphs only from standard/video-content/ (golden source).
 */
export function seedVideoContentWorkflowsForOwner(ownerUserId, opts = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return { ok: false, skipped: 'no owner', results: [] };
  const safe = ownerWorkflowSlug(owner);
  const templates = opts.templateKey
    ? [loadVideoContentWorkflowTemplate(opts.templateKey)].filter(Boolean)
    : listVideoContentWorkflowTemplates({ includeStubs: opts.includeStubs === true });

  const specialists = resolveVideoSpecialists(owner, opts.prefabIds || []);
  const results = [];
  const skipped = [];

  const needsAgents = (tpl) =>
    (tpl?.graph?.nodes || []).some((n) => String(n.type || '') === 'agent');

  if (!specialists.story || !specialists.scene || !specialists.prompt) {
    // Still allow seeding tool-only Phase 2 graphs (media/assembly).
    const onlyToolGraphs = (templates || []).every((t) => !needsAgents(t));
    if (!onlyToolGraphs) {
      return {
        ok: false,
        owner,
        results: [],
        skipped: [
          {
            reason: 'video_specialists_missing',
            story: !!specialists.story,
            scene: !!specialists.scene,
            prompt: !!specialists.prompt,
          },
        ],
      };
    }
  }

  for (const tpl of templates) {
    if (!tpl?.graph?.nodes?.length) {
      skipped.push({ template_key: tpl?.template_key, reason: 'template_missing' });
      continue;
    }
    if (String(tpl.status || '') === 'stub' && opts.includeStubs !== true) {
      skipped.push({ template_key: tpl.template_key, reason: 'stub_skipped' });
      continue;
    }
    if (needsAgents(tpl) && (!specialists.story || !specialists.scene || !specialists.prompt)) {
      skipped.push({ template_key: tpl.template_key, reason: 'video_specialists_missing' });
      continue;
    }
    const graph = needsAgents(tpl) ? bindVideoAgentsInGraph(tpl.graph, specialists) : tpl.graph;
    const forcedId = String(tpl.workflow_id_pattern || 'video-reasoning-{ownerSlug}')
      .replace('{ownerSlug}', safe)
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .slice(0, 64);
    try {
      const up = upsertWorkflow(owner, {
        name: tpl.name || tpl.template_key,
        description: tpl.description || '',
        chatPhrase: tpl.chat_trigger_phrase || 'run video storyboard',
        graph,
        forcedId,
        triggerModes: tpl.trigger_modes,
      });
      results.push({
        template_key: tpl.template_key,
        story_id: specialists.story.id,
        scene_id: specialists.scene.id,
        prompt_id: specialists.prompt.id,
        ...up,
      });
      console.info(
        '[video-workflows] seeded key=%s owner=%s id=%s action=%s',
        tpl.template_key,
        owner,
        up.id,
        up.action
      );
    } catch (e) {
      console.warn(
        '[video-workflows] seed failed key=%s owner=%s',
        tpl.template_key,
        owner,
        e?.message || e
      );
      skipped.push({ template_key: tpl.template_key, reason: e?.message || String(e) });
    }
  }

  return { ok: true, owner, results, skipped };
}
