/**
 * First-class multi-intent goal plan classification.
 * Maps CEO/COO goal text into ordered lanes using:
 *  - tenant published workflow chat phrases (catalog)
 *  - org AGENTS.md / under-COO roster (specialty)
 *  - orchestrator tool grants + content-tools meta (self_tool / agent_tool)
 *  - LLM residual classification (JSON) when free-form mapping is needed
 *
 * No product CRM/ERP keyword hardcoding. Workflow match is phrase-catalog only.
 */
import { chatCompletions } from '../config/llm.js';
import { readCooAgentsMdForCeo, getCooAgentRow, getAgentsUnderCooForCeo, getAgentsUnderOrchestratorForCeo } from './org-context.js';
import { parseAgentsFromAgentsMd, isEligiblePlanningAgent as isEligibleRosterAgent } from './intent-classifier.js';
import {
  classifySpecialtyIntentsForPlan,
  specialtyIntentsToSteps,
  stripWorkflowPhrasesFromPrompt,
  residualIsLetteredOrNumbered,
} from './goal-plan-specialty.js';
import { listChatTriggerableWorkflows, listPublishedWorkflows } from './agent-workflow-chat-tools.js';
import { getAgentToolGrants } from './openclaw-agent-tools.js';
import { listEnabledContentTools } from './content-tools-meta.js';
import { getDb } from '../db/schema.js';
import { mergeCapabilitySteps } from './business-capabilities.js';
import { getWorkAssignmentPolicy, listHumanWorkCandidates, chooseOverlappingExecutor } from './work-assignment-policy.js';
import { goalWantsChatSynthesis } from './goal-plan-tool-args.js';

const MAX_INTENTS = Math.max(4, Math.min(20, Number(process.env.GOAL_PLAN_MAX_INTENTS) || 12));

export const GOAL_PLAN_SELF_TOOLS_PREFER = [
  'notify_ceo',
  'email_send',
  'agent_workflow_list',
  'agent_workflow_enquire',
  'agent_workflow_runs',
  'agent_goal_list',
  'agent_goal_status',
  'status_checker',
  'this_week_digest',
  'operational_effectiveness',
  'llmops_summary',
  'ceo_profile',
  'kanban_create_task',
  'learnings_summary',
  // Market data — args (symbols) resolved at execute time from goal prose (MAG7, lists, …)
  'market_history',
  'market_fundamentals',
  'market_regime',
  'market_screener',
];

function orchestratorBaseId(orchestratorAgentId) {
  const raw = String(orchestratorAgentId || '').trim();
  if (!raw) return '';
  return raw.includes('--') ? raw.split('--').pop() : raw;
}

/**
 * COO / Workflow Builder keep nested specialty_task + prefer-list tool filtering.
 * Any other orchestrator (granted agent_goal_create) plans against its own grants.
 */
export function isCooStyleOrchestrator(orchestratorAgentId) {
  if (!orchestratorAgentId) return true;
  const id = String(orchestratorAgentId).trim().toLowerCase();
  if (!id) return true;
  const base = orchestratorBaseId(id).toLowerCase();
  if (base === 'balserve' || base === 'workflowbuilder') return true;
  try {
    const coo = getCooAgentRow();
    const cooId = String(coo?.id || '').toLowerCase();
    if (cooId && (id === cooId || base === cooId)) return true;
    const row = getDb()
      .prepare('SELECT is_coo, COALESCE(is_orchestrator, 0) AS is_orchestrator FROM agents WHERE lower(id) = ? OR lower(id) = ? LIMIT 1')
      .get(id, base);
    if (row?.is_coo || row?.is_orchestrator) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function grantsForOrchestrator(orchestratorAgentId, ownerUserId) {
  const ids = [];
  const raw = String(orchestratorAgentId || '').trim();
  if (raw) ids.push(raw);
  const base = orchestratorBaseId(raw);
  if (base && base !== raw) ids.push(base);
  const owner = String(ownerUserId || '').trim();
  if (owner && base && !String(raw).includes('--')) {
    ids.push(`t-${owner}--${base}`);
  }
  if (!raw) {
    try {
      const coo = getCooAgentRow();
      if (coo?.id) ids.push(coo.id);
    } catch {
      /* ignore */
    }
    ids.push('balserve');
  }
  const seen = new Set();
  for (const id of ids) {
    const key = String(id || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    try {
      const g = getAgentToolGrants(key) || [];
      if (g.length) return g;
    } catch {
      /* ignore */
    }
  }
  return [];
}

const SKIP_META_TOOLS = new Set([
  'agent_goal_create',
  'agent_workflow_trigger',
  'agent_goal_complete_step',
  'intent_classify_and_delegate',
]);

const GENERIC_TOKENS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'use',
  'via',
  'run',
  'get',
  'set',
  'task',
  'data',
  'tool',
  'tools',
  'agent',
  'user',
  'when',
  'after',
  'status',
  'step',
  'plan',
  'goal',
  'send',
  'list',
  'push',
  'api',
  'ceo',
  'only',
  'them',
  'your',
  'into',
  'over',
  'under',
  'custom',
  'owner',
  'session',
  'true',
  'false',
  'body',
  'text',
  'json',
  'optional',
  'never',
  'pass',
  'uses',
  'env',
]);

function clip(s, n = 400) {
  const t = String(s || '');
  return t.length <= n ? t : t.slice(0, n) + '…';
}

export function normalizeIntentText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract first complete JSON object / {intents:[]} even when model wraps in prose.
 */
export function parseJsonObject(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  let t = String(raw).trim();
  if (!t) return null;

  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  // Prefer last '{"intents"' occurrence (model may narrate then emit JSON)
  const intentKey = t.lastIndexOf('"intents"');
  if (intentKey >= 0) {
    const brace = t.lastIndexOf('{', intentKey);
    if (brace >= 0) {
      const sliced = balanceJsonObject(t, brace);
      if (sliced) {
        try {
          return JSON.parse(sliced);
        } catch (_) {
          /* fall through */
        }
      }
    }
  }

  try {
    return JSON.parse(t);
  } catch (_) {
    /* continue */
  }

  const i = t.indexOf('{');
  if (i >= 0) {
    const sliced = balanceJsonObject(t, i);
    if (sliced) {
      try {
        return JSON.parse(sliced);
      } catch (_) {
        /* continue */
      }
    }
  }

  // Recover truncated intents array
  const m = t.match(/"intents"\s*:\s*\[/);
  if (m) {
    const start = t.indexOf('[', m.index);
    let buf = '';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let k = start; k < t.length; k++) {
      const ch = t[k];
      buf += ch;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === ']' && depth === 0) {
        try {
          return { intents: JSON.parse(buf) };
        } catch {
          break;
        }
      }
    }
    let repaired = buf;
    if (inStr) repaired += '"';
    const lastComplete = repaired.lastIndexOf('}');
    if (lastComplete > 0) {
      repaired = repaired.slice(0, lastComplete + 1) + ']';
      try {
        return { intents: JSON.parse(repaired) };
      } catch {
        try {
          return { intents: JSON.parse(repaired.replace(/,\s*\]$/, ']')) };
        } catch {
          /* ignore */
        }
      }
    }
  }

  // Scrape discrete intent objects from prose if model never closed a root object
  const scraped = scrapeIntentObjects(t);
  if (scraped.length) return { intents: scraped };
  return null;
}

function balanceJsonObject(t, startBrace) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = startBrace; k < t.length; k++) {
    const ch = t[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return t.slice(startBrace, k + 1);
    }
  }
  return null;
}

function scrapeIntentObjects(t) {
  const out = [];
  const re = /\{\s*"lane"\s*:/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const obj = balanceJsonObject(t, m.index);
    if (!obj) continue;
    try {
      const o = JSON.parse(obj);
      if (o && o.lane) out.push(o);
    } catch {
      /* skip */
    }
  }
  return out;
}

function resolveCeoEmail(ownerUserId) {
  const id = String(ownerUserId || '').trim();
  if (!id) return null;
  try {
    const db = getDb();
    const row =
      db.prepare('SELECT email FROM platform_users WHERE id = ?').get(id) ||
      db.prepare('SELECT email FROM users WHERE id = ?').get(id);
    const email = row?.email ? String(row.email).trim() : '';
    return email || null;
  } catch {
    return null;
  }
}

/**
 * Catalog of tool names the goal owner agent may self-execute on plan steps.
 */
export function listOrchestratorToolsForGoalPlan(ownerUserId, orchestratorAgentId = null) {
  const grants = grantsForOrchestrator(orchestratorAgentId, ownerUserId);
  const grantSet = new Set(grants.map((g) => String(g).toLowerCase()));
  const enabled = listEnabledContentTools();
  const tools = enabled
    .filter((t) => {
      if (!t?.name || SKIP_META_TOOLS.has(t.name)) return false;
      if (grantSet.size && !grantSet.has(String(t.name).toLowerCase())) return false;
      return true;
    })
    .map((t) => ({
      name: t.name,
      display_name: t.display_name || t.name,
      purpose: clip(t.purpose || '', 160),
    }));
  // Prefer frequently used orchestrator tools early in the LLM window
  const prefer = [
    'notify_ceo',
    'email_send',
    'agent_workflow_list',
    'agent_workflow_enquire',
    'agent_workflow_runs',
    'agent_goal_list',
    'agent_goal_status',
    'status_checker',
    'this_week_digest',
    'operational_effectiveness',
    'llmops_summary',
    'ceo_profile',
    'kanban_create_task',
  ];
  tools.sort((a, b) => {
    const ia = prefer.indexOf(a.name);
    const ib = prefer.indexOf(b.name);
    if (ia === -1 && ib === -1) return a.name.localeCompare(b.name);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return tools;
}

export function listWorkflowCatalogForGoalPlan(ownerUserId) {
  const chatable = listChatTriggerableWorkflows(ownerUserId) || [];
  const published = listPublishedWorkflows(ownerUserId) || [];
  const byId = new Map();
  for (const w of [...published, ...chatable]) {
    if (!w?.id) continue;
    byId.set(w.id, {
      id: w.id,
      name: w.name || w.id,
      description: clip(w.description || '', 200),
      chat_trigger_phrase: String(w.chat_trigger_phrase || '').trim(),
    });
  }
  return [...byId.values()];
}

export async function listSpecialtyAgentsForGoalPlan(ownerUserId, orchestratorAgentId = null) {
  const md = ownerUserId ? await readCooAgentsMdForCeo(ownerUserId) : '';
  let roster = parseAgentsFromAgentsMd(md || '');
  try {
    const under = orchestratorAgentId
      ? getAgentsUnderOrchestratorForCeo(ownerUserId, orchestratorAgentId)
      : getAgentsUnderCooForCeo(ownerUserId) || [];
    const seen = new Set(roster.map((a) => String(a.id).toLowerCase()));
    for (const a of under) {
      const id = String(a.id || '').toLowerCase();
      if (!id || seen.has(id) || a.is_coo) continue;
      seen.add(id);
      roster.push({
        id,
        name: a.name || id,
        role: [a.department, a.role].filter(Boolean).join(' — ') || 'specialty agent',
        planning_status: a.planning_status || 'production',
      });
    }
  } catch (_) {
    /* ignore */
  }
  roster = roster.filter((a) => {
    const id = String(a.id || '').toLowerCase();
    if (!id || id === 'balserve' || !isEligiblePlanningAgent(a) || /coo|chief operating/i.test(String(a.name || '') + ' ' + String(a.role || ''))) return false;
    try {
      const live = getDb().prepare("SELECT COALESCE(planning_status, 'production') AS planning_status FROM agents WHERE lower(id)=lower(?) LIMIT 1").get(id);
      return !live || live.planning_status === 'production';
    } catch {
      return true;
    }
  });
  return roster;
}

export const isEligiblePlanningAgent = isEligibleRosterAgent;

/**
 * Apply the CEO's generic agent-vs-human policy after capability planning.
 * The model only scores semantic fit/risk against the live human roster; the
 * deterministic policy function makes the final choice.
 */
export async function applyHumanAssignmentPolicy(ownerUserId, prompt, steps = []) {
  const humans = listHumanWorkCandidates(ownerUserId);
  const specialty = (steps || []).map((step, index) => ({ step, index })).filter(({ step }) => step.type === 'specialty_task');
  if (!humans.length) return steps;
  const policy = getWorkAssignmentPolicy(ownerUserId);
  const explicitLower = String(prompt || '').toLowerCase();
  const explicit = new Map();
  for (const human of humans) {
    for (const token of [human.id, human.name].map((x) => String(x || '').trim().toLowerCase()).filter((x) => x.length >= 4)) {
      if (explicitLower.includes(token)) explicit.set(token, human);
    }
  }
  const humanBlock = humans.map((h) => `${h.id} | ${h.name} | ${h.department || ''} | ${h.role_title || ''} | ${h.specialty || ''} | ${h.purpose || ''}`).join('\n');
  const stepBlock = specialty.map(({ step, index }) => `${index} | ${step.label} | ${step.spec?.message || ''} | agent=${step.spec?.agent_id || ''}`).join('\n');
  let matches = [];
  try {
    const completion = await chatCompletions({
      ownerUserId,
      maxTokens: 900,
      toolName: 'goal_human_assignment',
      temperature: 0,
      responseFormat: 'json_object',
      messages: [
        { role: 'system', content: 'Match planned work to HUMAN employees only when their department, role, specialty or purpose genuinely fits. Classify task risk as high only for financial commitments/costs, legal/regulatory decisions, destructive operations, or binding external commitments. JSON only: {"matches":[{"step_index":0,"user_id":"exact id or empty","human_match_score":0-100,"agent_match_score":0-100,"risk":"normal|high","reason":"short"}]}.' },
        { role: 'user', content: `GOAL:\n${String(prompt || '').slice(0, 3500)}\n\nPLANNED AGENT STEPS:\n${stepBlock}\n\nHUMAN EMPLOYEES:\n${humanBlock}` },
      ],
    });
    const parsed = parseJsonObject(completion?.content || completion);
    matches = Array.isArray(parsed?.matches) ? parsed.matches : [];
  } catch (e) {
    console.warn('[goal-plan-intent] human assignment scoring skipped', e?.message || e);
  }
  const byIndex = new Map(matches.map((m) => [Number(m.step_index), m]));
  const directHumans = [...new Map([...explicit.values()].map((h) => [h.id, h])).values()];
  if (!specialty.length && !directHumans.length) return steps;
  const forcedByIndex = new Map();
  const reserved = new Set();
  for (const human of directHumans) {
    let best = null;
    for (const { index } of specialty) {
      if (reserved.has(index)) continue;
      const match = byIndex.get(index);
      const score = match?.user_id === human.id ? Number(match?.human_match_score || 0) : 0;
      const riskBonus = match?.risk === 'high' ? 10 : 0;
      const rank = score + riskBonus;
      if (!best || rank > best.rank) best = { index, rank };
    }
    if (best) {
      forcedByIndex.set(best.index, human);
      reserved.add(best.index);
    }
  }
  const assignedHumans = new Set();
  let out = (steps || []).map((step, index) => {
    if (step.type !== 'specialty_task') return step;
    const direct = forcedByIndex.get(index) || null;
    const match = byIndex.get(index);
    const human = direct || (Number(match?.human_match_score || 0) >= 60 ? humans.find((h) => h.id === match?.user_id) : null);
    if (!human) return step;
    const decision = direct
      ? { kind: 'human', candidate: human }
      : chooseOverlappingExecutor({
          policy,
          risk: match?.risk === 'high' ? 'high' : 'normal',
          agentCandidate: { id: step.spec?.agent_id, match_score: match?.agent_match_score },
          humanCandidate: { ...human, match_score: match?.human_match_score },
        });
    if (decision?.kind !== 'human') return step;
    if (assignedHumans.has(human.id)) return null;
    assignedHumans.add(human.id);
    return {
      type: 'human_task',
      label: `Human: ${human.name}`,
      spec: {
        user_id: human.id,
        message: step.spec?.message || step.label,
        risk: match?.risk === 'high' ? 'high' : 'normal',
        selection_rationale: direct
          ? `Assigned to the explicitly named human employee ${human.name}.`
          : `${policy.mode}: ${match?.reason || `${human.name}'s role and specialty fit this work`}`,
      },
    };
  }).filter(Boolean);
  // An explicitly named human is an execution instruction, not merely a score
  // hint. Preserve it even when the post-plan capability gate correctly removed
  // an unrelated AI candidate that the model had used as a temporary proxy.
  for (const human of directHumans) {
    if (assignedHumans.has(human.id) || out.some((step) => step.type === 'human_task' && step.spec?.user_id === human.id)) continue;
    const highRisk = /\b(financ|invoice|payment|discount|fee|cost|legal|regulat|compliance|contract|destructive|delete)\b/i.test(String(prompt || ''));
    const humanStep = {
      type: 'human_task',
      label: `Human: ${human.name}`,
      spec: {
        user_id: human.id,
        message: String(prompt || '').slice(0, 6000),
        risk: highRisk ? 'high' : 'normal',
        selection_rationale: `Assigned to the explicitly named human employee ${human.name}.`,
      },
    };
    const terminalAt = out.findIndex((step) => step.type === 'agent_continue' || step.type === 'notify_ceo');
    out.splice(terminalAt >= 0 ? terminalAt : out.length, 0, humanStep);
    assignedHumans.add(human.id);
  }
  if (out.some((step) => step.type === 'human_task') && goalWantsChatSynthesis(prompt) && !out.some((step) => step.type === 'agent_continue')) {
    const notifyAt = out.findIndex((step) => step.type === 'notify_ceo');
    out.splice(notifyAt >= 0 ? notifyAt : out.length, 0, {
      type: 'agent_continue',
      label: 'Consolidate completed work',
      spec: {
        message: '[Goal run — synthesis] Use only this goal run’s completed step outputs. Produce the requested final outcome for the CEO; do not delegate this synthesis.',
        selection_rationale: 'The originating orchestrator consolidates prior step outputs before notifying the CEO.',
      },
    });
  }
  // A human goal step creates and owns its Kanban card itself. A separately
  // inferred kanban_create_task step is duplicate work and can orphan a card.
  if (out.some((step) => step.type === 'human_task')) {
    out = out.filter((step) => !(
      step.type === 'agent_tool' &&
      String(step.spec?.tool_name || step.tool_name || '').toLowerCase() === 'kanban_create_task'
    ));
  }
  return out;
}

function resolveWorkflowMatch(intent, catalog) {
  const id = String(intent.workflow_id || intent.workflowId || '').trim();
  const phrase = String(intent.chat_phrase || intent.phrase || intent.workflow_phrase || '').trim();
  const name = String(intent.workflow_name || intent.name || '').trim().toLowerCase();
  if (id) {
    const hit = catalog.find((w) => String(w.id) === id);
    if (hit) return hit;
  }
  if (phrase) {
    const p = normalizeIntentText(phrase);
    let hit = catalog.find((w) => normalizeIntentText(w.chat_trigger_phrase || '') === p);
    if (hit) return hit;
    hit = catalog.find((w) => p && normalizeIntentText(w.chat_trigger_phrase || '').includes(p));
    if (hit) return hit;
    hit = catalog.find((w) => {
      const cp = normalizeIntentText(w.chat_trigger_phrase || '');
      return p && cp && (p.includes(cp) || cp.includes(p));
    });
    if (hit) return hit;
  }
  if (name) {
    const hit = catalog.find(
      (w) =>
        String(w.name || '').toLowerCase() === name ||
        String(w.name || '').toLowerCase().includes(name) ||
        String(w.id).toLowerCase().includes(name.replace(/\s+/g, '-'))
    );
    if (hit) return hit;
  }
  return null;
}

function resolveAgentMatch(intent, roster) {
  const raw = String(intent.agent_id || intent.agentId || intent.agent || '').trim().toLowerCase();
  if (!raw) return null;
  const cleaned = raw.replace(/[`*]/g, '').trim();
  let hit = roster.find((a) => String(a.id).toLowerCase() === cleaned);
  if (hit) return hit;
  hit = roster.find((a) => String(a.name || '').toLowerCase().replace(/\s+/g, '') === cleaned.replace(/\s+/g, ''));
  if (hit) return hit;
  hit = roster.find(
    (a) =>
      String(a.name || '').toLowerCase().includes(cleaned) ||
      String(a.role || '').toLowerCase().includes(cleaned) ||
      cleaned.includes(String(a.id).toLowerCase())
  );
  return hit || null;
}

function resolveToolMatch(intent, tools) {
  const name = String(intent.tool_name || intent.tool || intent.name || '').trim().toLowerCase();
  if (!name || name === '...' || name === '?' || name === 'null') return null;
  return tools.find((t) => String(t.name).toLowerCase() === name) || null;
}

function intentsToStepSpecs(intents, { tools, workflows, agents, ownerUserId }) {
  const steps = [];
  for (const raw of intents) {
    if (!raw || typeof raw !== 'object') continue;
    const lane = String(raw.lane || raw.kind || raw.type || '')
      .toLowerCase()
      .trim();
    if (!lane || lane === 'skip' || lane === 'meta' || lane === 'create_goal' || lane === 'create') {
      continue;
    }

    if (lane === 'workflow' || lane === 'workflow_trigger') {
      const wf = resolveWorkflowMatch(raw, workflows);
      if (!wf) {
        console.warn('[goal-plan-intent] drop workflow intent — no catalog match', {
          label: raw.label,
          workflow_id: raw.workflow_id,
          phrase: raw.chat_phrase || raw.phrase,
        });
        continue;
      }
      steps.push({
        type: 'workflow_trigger',
        label: String(raw.label || wf.name || wf.chat_trigger_phrase || 'Run workflow').trim(),
        phrase: wf.chat_trigger_phrase || wf.name,
        workflow_id: wf.id,
        phase: String(raw.phase || 'workflow').slice(0, 40),
        _order: Number.isFinite(raw.order) ? raw.order : null,
      });
      continue;
    }

    if (lane === 'specialty' || lane === 'specialty_task' || lane === 'delegate') {
      const agent = resolveAgentMatch(raw, agents);
      if (!agent) {
        console.warn('[goal-plan-intent] drop specialty intent — no roster match', {
          label: raw.label,
          agent_id: raw.agent_id,
        });
        continue;
      }
      steps.push({
        type: 'specialty_task',
        label: String(raw.label || `Specialty: ${agent.name || agent.id}`).trim(),
        agent_id: agent.id,
        message: String(raw.message || raw.task || raw.prompt || raw.label || '').trim() || null,
        _order: Number.isFinite(raw.order) ? raw.order : null,
      });
      continue;
    }

    if (
      lane === 'self_tool' ||
      lane === 'agent_tool' ||
      lane === 'tool' ||
      lane === 'self' ||
      lane === 'notify_ceo'
    ) {
      let toolName = String(raw.tool_name || raw.tool || '').trim();
      if (!toolName && (lane === 'notify_ceo' || /notify/i.test(String(raw.label || '')))) {
        toolName = 'notify_ceo';
      }
      const tool = resolveToolMatch({ tool_name: toolName }, tools);
      if (!tool && toolName !== 'notify_ceo') {
        console.warn('[goal-plan-intent] drop self_tool intent — tool not granted/catalogued', {
          label: raw.label,
          tool_name: toolName,
        });
        continue;
      }
      const resolvedName = tool?.name || toolName;
      if (resolvedName === 'notify_ceo') {
        steps.push({
          type: 'notify_ceo',
          label: String(raw.label || 'Notify CEO').trim(),
          title: raw.title || raw.tool_args?.title || null,
          body: raw.body || raw.tool_args?.body || raw.message || null,
          _order: Number.isFinite(raw.order) ? raw.order : null,
        });
      } else {
        const args =
          raw.tool_args && typeof raw.tool_args === 'object' && !Array.isArray(raw.tool_args)
            ? { ...raw.tool_args }
            : {};
        if (resolvedName === 'email_send') {
          if (!args.to && ownerUserId) {
            const ceoEmail = resolveCeoEmail(ownerUserId);
            if (ceoEmail) args.to = ceoEmail;
          }
          if (raw.subject && !args.subject) args.subject = raw.subject;
          if ((raw.body || raw.message) && !args.body) args.body = raw.body || raw.message;
        }
        steps.push({
          type: 'agent_tool',
          label: String(raw.label || tool?.display_name || resolvedName).trim(),
          tool_name: resolvedName,
          args,
          _order: Number.isFinite(raw.order) ? raw.order : null,
        });
      }
    }
  }
  return steps;
}

/**
 * Published chat-phrase match (tenant workflows only). Order by appearance in goal text.
 */
export function matchWorkflowStepsFromCatalog(prompt, ownerUserId) {
  const text = String(prompt || '');
  const lower = normalizeIntentText(text);
  const catalog = listWorkflowCatalogForGoalPlan(ownerUserId);
  const hits = [];
  for (const w of catalog) {
    const phrase = String(w.chat_trigger_phrase || '').trim();
    if (!phrase) continue;
    const pNorm = normalizeIntentText(phrase);
    if (!pNorm || pNorm.length < 4) continue;
    const idx = lower.indexOf(pNorm);
    if (idx >= 0) hits.push({ idx, w, phrase });
  }
  hits.sort((a, b) => a.idx - b.idx || b.phrase.length - a.phrase.length);
  const seen = new Set();
  const steps = [];
  for (const h of hits) {
    if (seen.has(h.w.id)) continue;
    seen.add(h.w.id);
    steps.push({
      type: 'workflow_trigger',
      label: h.w.name || h.phrase,
      phrase: h.phrase,
      workflow_id: h.w.id,
      phase: 'workflow',
      _order: h.idx,
    });
  }
  return steps;
}

function allTokenIndices(lower, tok, { wholeWord = false } = {}) {
  const out = [];
  if (!tok) return out;
  if (!wholeWord) {
    let from = 0;
    while (from < lower.length) {
      const i = lower.indexOf(tok, from);
      if (i < 0) break;
      out.push(i);
      from = i + Math.max(1, tok.length);
    }
    return out;
  }
  // Whole-word-ish: not letter/digit on either side (handles snake_case goal names)
  const re = new RegExp(`(?:^|[^a-z0-9_])(${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=[^a-z0-9_]|$)`, 'g');
  let m;
  while ((m = re.exec(lower)) !== null) {
    out.push(m.index + (m[0].length - m[1].length));
  }
  return out;
}

/** True when some co-occurrence of every token lies within `window` chars; returns earliest start. */
function tokensNear(lower, tokens, window = 72, opts = {}) {
  const lists = [];
  for (const tok of tokens) {
    if (!tok || tok.length < 3) return -1;
    const idxs = allTokenIndices(lower, tok, opts);
    if (!idxs.length) return -1;
    lists.push(idxs);
  }
  if (!lists.length) return -1;
  if (lists.length === 1) return lists[0][0];

  let best = -1;
  const first = lists[0];
  for (const a of first) {
    let ok = true;
    let min = a;
    let max = a;
    for (let li = 1; li < lists.length; li++) {
      let found = -1;
      let bestDist = Infinity;
      for (const b of lists[li]) {
        const nmin = Math.min(min, b);
        const nmax = Math.max(max, b);
        const span = nmax - nmin;
        if (span <= window && span < bestDist) {
          bestDist = span;
          found = b;
        }
      }
      if (found < 0) {
        ok = false;
        break;
      }
      min = Math.min(min, found);
      max = Math.max(max, found);
    }
    if (ok && (best < 0 || min < best)) best = min;
  }
  return best;
}

/**
 * Catalog-driven self_tool match from tool registry names / display names / purpose tokens.
 * Name segments from the tool registry (not product domain keywords). Orders by first hit index.
 */
export function matchSelfToolsFromCatalog(prompt, tools) {
  const origin = String(prompt || '');
  const lower = normalizeIntentText(origin);
  const originLower = origin.toLowerCase();
  const prefer = new Set(GOAL_PLAN_SELF_TOOLS_PREFER);
  const hits = [];

  for (const t of tools || []) {
    if (!t?.name || SKIP_META_TOOLS.has(t.name)) continue;
    let idx = -1;

    // 1) Exact registry tool name in goal (notify_ceo, email_send, …)
    const u = originLower.indexOf(String(t.name).toLowerCase());
    if (u >= 0) idx = u;

    // 2) Spaced form with 3+ segments (agent workflow list) or exact long names
    if (idx < 0) {
      const spaced = normalizeIntentText(String(t.name).replace(/_/g, ' '));
      const segs = spaced.split(' ').filter(Boolean);
      if (segs.length >= 3) {
        const s = lower.indexOf(spaced);
        if (s >= 0) idx = s;
      }
    }

    // 3) Full distinctive display name (3+ words or length>=18)
    if (idx < 0) {
      const display = normalizeIntentText(t.display_name || '');
      const words = display.split(' ').filter(Boolean);
      if (display.length >= 18 || words.length >= 3) {
        const full = lower.indexOf(display);
        if (full >= 0) idx = full;
      }
    }

    // 4) Prefer-list tools only: last name segments as whole words near each other.
    // High precision for multi-segment registry names without domain keyword lists.
    if (idx < 0 && prefer.has(t.name)) {
      const rawSegs = String(t.name)
        .toLowerCase()
        .split(/_+/g)
        .filter((s) => s.length >= 3 && s !== 'agent');
      if (rawSegs.length >= 2) {
        const tail = rawSegs.slice(-2);
        // skip pairs that are both ultra-generic (goal+status)
        if (!(tail.every((s) => GENERIC_TOKENS.has(s)))) {
          const near = tokensNear(lower, tail, 48, { wholeWord: true });
          if (near >= 0) idx = near;
        }
      } else if (rawSegs.length === 1 && rawSegs[0].length >= 8) {
        const near = tokensNear(lower, rawSegs, 8, { wholeWord: true });
        if (near >= 0) idx = near;
      }
    }

    // 5) Small catalogs (specialty orchestrators): distinctive purpose tokens from the registry.
    if (idx < 0 && (tools || []).length <= 28 && !prefer.has(t.name)) {
      const purpose = normalizeIntentText(String(t.purpose || t.display_name || ''));
      const toks = purpose.split(' ').filter((s) => s.length >= 6 && !GENERIC_TOKENS.has(s));
      if (toks.length >= 2) {
        const near = tokensNear(lower, toks.slice(0, 2), 96, { wholeWord: true });
        if (near >= 0) idx = near;
      }
    }

    if (idx >= 0) hits.push({ idx, t });
  }

  hits.sort((a, b) => a.idx - b.idx);
  const seen = new Set();
  const steps = [];
  for (const h of hits) {
    if (seen.has(h.t.name)) continue;
    seen.add(h.t.name);
    if (h.t.name === 'notify_ceo') {
      steps.push({
        type: 'notify_ceo',
        label: h.t.display_name || 'Notify CEO',
        title: null,
        body: null,
        _order: h.idx,
      });
    } else {
      steps.push({
        type: 'agent_tool',
        label: h.t.display_name || h.t.name,
        tool_name: h.t.name,
        args: {},
        _order: h.idx,
      });
    }
  }
  return steps;
}

async function llmJsonIntents({ ownerUserId, system, user, maxTokens = 1400, toolName = 'goal_plan_intent' }) {
  const { content } = await chatCompletions({
    ownerUserId,
    maxTokens,
    toolName,
    temperature: 0,
    responseFormat: 'json_object',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const textOut = String(content || '').trim();
  const parsed = parseJsonObject(textOut);
  let intents = Array.isArray(parsed?.intents)
    ? parsed.intents
    : Array.isArray(parsed)
      ? parsed
      : null;
  if (!intents?.length && textOut) {
    console.warn('[goal-plan-intent] LLM non-JSON residual', clip(textOut, 200));
  }
  return { intents: intents || [], textOut };
}

/**
 * Primary entry: catalog + LLM + specialty residual → ordered step specs.
 */

/**
 * Multi-label tool pick against catalog enum (stable than free-form intent arrays).
 * tool_name values MUST exist in the provided tools list.
 */
async function classifyToolsMultiLabel(ownerUserId, prompt, tools) {
  if (!tools?.length) return [];
  // Prefer orchestrator-facing tools in the LLM enum (avoids domain status tools
  // false-firing on words inside notify summaries). Full tool list still used for validation elsewhere.
  const prefer = [
    'notify_ceo',
    'email_send',
    'agent_workflow_list',
    'agent_workflow_enquire',
    'agent_workflow_runs',
    'agent_goal_list',
    'agent_goal_status',
    'status_checker',
    'this_week_digest',
    'operational_effectiveness',
    'llmops_summary',
    'ceo_profile',
    'kanban_create_task',
    'learnings_summary',
  ];
  const preferSet = new Set(prefer);
  // Prefer-only enum (no domain status tools polluting multi-label)
  let catalog = tools.filter((x) => preferSet.has(x.name));
  if (catalog.length < 4) {
    catalog = tools.slice(0, 12);
  }
  const enumLine = catalog.map((t) => t.name).join(', ');
  const purposeBlock = catalog
    .map((t) => t.name + ' — ' + clip(t.purpose || t.display_name || '', 100))
    .join('\n');
  const system =
    'You select which SELF-TOOLS from CATALOG are clearly requested by the GOAL. ' +
    'Return JSON only: {"tool_names":["exact_name",...]}. ' +
    'Use only names from CATALOG. Preserve goal order roughly. ' +
    'HIGH PRECISION: include only tools the orchestrator must RUN as discrete plan steps. Do NOT map words that only appear inside a notify/email summary list (e.g. covering CRM status). Typical: notify_ceo when notified, email_send when send email, agent_workflow_list when list workflows via tools. Prefer omit when unsure. ' +
    'Skip meta create-goal / compliance-only. Skip specialty agent work (not a tool). ' +
    'Skip published workflow runs (not tools). Empty array if none.';
  const user =
    'GOAL:\n"""\n' +
    String(prompt || '').slice(0, 4000) +
    '\n"""\n\nCATALOG names: ' +
    enumLine +
    '\n\nCATALOG purpose:\n' +
    purposeBlock;
  try {
    const { intents: _ignore, textOut } = await (async () => {
      const { content } = await chatCompletions({
        ownerUserId,
        maxTokens: 500,
        toolName: 'goal_plan_intent',
        temperature: 0,
        responseFormat: 'json_object',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      return { intents: [], textOut: String(content || '') };
    })();
    const parsed = parseJsonObject(textOut);
    let names = Array.isArray(parsed?.tool_names)
      ? parsed.tool_names
      : Array.isArray(parsed?.tools)
        ? parsed.tools
        : Array.isArray(parsed?.intents)
          ? parsed.intents.map((x) => x?.tool_name || x?.name).filter(Boolean)
          : [];
    names = names.map((n) => String(n || '').trim()).filter(Boolean);
    const byName = new Map(catalog.map((t) => [t.name, t]));
    const lower = normalizeIntentText(prompt);
    const steps = [];
    const seen = new Set();
    for (const name of names) {
      const t = byName.get(name) || byName.get(name.toLowerCase());
      if (!t || seen.has(t.name)) continue;
      seen.add(t.name);
      // order by first hit of name or purpose keyword's space-form
      const spaced = normalizeIntentText(t.name.replace(/_/g, ' '));
      let order = lower.indexOf(spaced);
      if (order < 0) order = String(prompt).toLowerCase().indexOf(t.name.toLowerCase());
      if (order < 0) order = 1e6 + steps.length;
      if (t.name === 'notify_ceo') {
        steps.push({
          type: 'notify_ceo',
          label: t.display_name || 'Notify CEO',
          title: null,
          body: null,
          _order: order,
        });
      } else {
        steps.push({
          type: 'agent_tool',
          label: t.display_name || t.name,
          tool_name: t.name,
          args: {},
          _order: order,
        });
      }
    }
    return steps;
  } catch (e) {
    console.warn('[goal-plan-intent] tool multi-label failed', e?.message || e);
    return [];
  }
}

export async function classifyGoalPlanIntents(ownerUserId, prompt, opts = {}) {
  const owner = String(ownerUserId || '').trim();
  const text = String(prompt || '').trim();
  if (!owner || text.length < 8) return null;

  const tools = listOrchestratorToolsForGoalPlan(owner, opts.orchestratorAgentId || null);
  const workflows = listWorkflowCatalogForGoalPlan(owner);
  const agents = await listSpecialtyAgentsForGoalPlan(owner, opts.orchestratorAgentId || null);
  const cooStyle = isCooStyleOrchestrator(opts.orchestratorAgentId);

  // --- Lane A: tenant published workflow phrases (catalog order) ---
  const wfCatalogSteps = matchWorkflowStepsFromCatalog(text, owner);

  // --- Lane B: specialty residual via org roster + specialty LLM allocator ---
  let specialtySteps = [];
  try {
    if (cooStyle) {
      const residualForSpecialty = stripWorkflowPhrasesFromPrompt(text, owner).trim();
      if (residualForSpecialty.length >= 8) {
        const specialtyRaw = await classifySpecialtyIntentsForPlan(owner, residualForSpecialty, {
          maxSpecialty: opts.maxSpecialty || 4,
          orchestratorAgentId: opts.orchestratorAgentId || null,
        });
        const lettered = residualIsLetteredOrNumbered(residualForSpecialty);
        specialtySteps = specialtyIntentsToSteps(specialtyRaw, {
          parallel: specialtyRaw.length > 1 && !lettered,
        }).map((st) => ({
          type: 'specialty_task',
          label: st.label,
          agent_id: st.agent_id || st.spec?.agent_id,
          message: st.message || st.spec?.message || null,
          parallel_group: st.parallel_group || st.spec?.parallel_group || null,
          _order: null,
        }));
      }
      const lowerText = text.toLowerCase();
      for (const st of specialtySteps) {
        const id = String(st.agent_id || '').toLowerCase();
        const name = String(st.label || '')
          .replace(/specialty:\s*/i, '')
          .trim()
          .toLowerCase();
        const needles = [name, id, name.replace(/\s+/g, ''), id.replace(/[-_]/g, ' ')].filter(
          (n) => n && n.length >= 4
        );
        let at = -1;
        for (const n of needles) {
          const i = lowerText.indexOf(n);
          if (i >= 0 && (at < 0 || i < at)) at = i;
        }
        if (at < 0 && id.includes('help')) {
          at = lowerText.search(/platform\s*help|platformhelp/);
        }
        st._order = at >= 0 ? at : text.length;
      }
    }
  } catch (e) {
    console.warn('[goal-plan-intent] specialty residual failed', e?.message || e);
  }

  // --- Lane C: self tools — exact catalog hit + LLM multi-label enum picker ---
  let toolCatalogSteps = matchSelfToolsFromCatalog(text, tools);
  try {
    const labeled = await classifyToolsMultiLabel(owner, text, tools);
    // Prefer multi-label coverage; de-dupe onto catalog hits
    const seen = new Set(toolCatalogSteps.map((s) => (s.type === 'notify_ceo' ? 'notify_ceo' : s.tool_name)));
    for (const st of labeled) {
      const key = st.type === 'notify_ceo' ? 'notify_ceo' : st.tool_name;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      toolCatalogSteps.push(st);
    }
    const preferSet2 = new Set(GOAL_PLAN_SELF_TOOLS_PREFER);
    const exact2 = new Set(
      matchSelfToolsFromCatalog(text, tools).map((s) =>
        s.type === 'notify_ceo' ? 'notify_ceo' : s.tool_name
      )
    );
    if (cooStyle) {
      toolCatalogSteps = toolCatalogSteps.filter((s) => {
        const key = s.type === 'notify_ceo' ? 'notify_ceo' : s.tool_name;
        return preferSet2.has(key) || exact2.has(key);
      });
    }
    toolCatalogSteps.sort((a, b) => (a._order ?? 1e9) - (b._order ?? 1e9));
  } catch (e) {
    console.warn('[goal-plan-intent] tool multi-label wire failed', e?.message || e);
  }

  // Core multi-label with tiny enum (reliable on reasoning models)
  try {
    const coreNames = new Set(['notify_ceo', 'email_send', 'agent_workflow_list', 'agent_workflow_enquire']);
    const coreTools = tools.filter((x) => coreNames.has(x.name));
    if (coreTools.length) {
      const coreLabeled = await classifyToolsMultiLabel(owner, text, coreTools);
      const seen = new Set(
        toolCatalogSteps.map((s) => (s.type === 'notify_ceo' ? 'notify_ceo' : s.tool_name))
      );
      for (const st of coreLabeled) {
        const key = st.type === 'notify_ceo' ? 'notify_ceo' : st.tool_name;
        if (!key || seen.has(key)) continue;
        if (!coreNames.has(key) && key !== 'notify_ceo') continue;
        seen.add(key);
        toolCatalogSteps.push(st);
      }
      toolCatalogSteps.sort((a, b) => (a._order ?? 1e9) - (b._order ?? 1e9));
    }
  } catch (e) {
    console.warn('[goal-plan-intent] core tool multi-label failed', e?.message || e);
  }


  // LLM: classify remaining specialty+tools when catalog is thin, or confirm tool set
  const toolsForPrompt = tools.slice(0, 22);
  const toolsBlock = toolsForPrompt.map((t) => `${t.name}: ${clip(t.purpose || t.display_name, 90)}`).join('\n');
  const agentBlock = agents.map((a) => `${a.id} | ${clip(a.name, 40)} | ${clip(a.role, 80)}`).join('\n');
  const already = [
    ...wfCatalogSteps.map((w) => `workflow:${w.phrase}`),
    ...specialtySteps.map((s) => `specialty:${s.agent_id}`),
    ...toolCatalogSteps.map((s) => (s.type === 'notify_ceo' ? 'tool:notify_ceo' : `tool:${s.tool_name}`)),
  ].join('; ');

  let llmExtra = [];
  try {
    const system =
      'You map remaining goal intents to specialty agents or self_tools. ' +
      'Workflow phrases already planned — do not re-emit workflows. ' +
      'Skip meta create-goal / compliance-only lines. ' +
      'tool_name MUST be an exact TOOLS catalog name; agent_id MUST be exact AGENTS catalog id. ' +
      'Output ONLY compact JSON (first char { last char }). No prose. No markdown. ' +
      'Schema: {"intents":[{"lane":"specialty|self_tool|skip","label":"string","agent_id":"optional","message":"optional","tool_name":"optional","tool_args":{}}]}';

    const user =
      'GOAL:\n"""\n' +
      text.slice(0, 4500) +
      '\n"""\n\nAlready planned (do not duplicate): ' +
      (already || '(none)') +
      '\n\nAGENTS:\n' +
      (agentBlock || '(none)') +
      '\n\nTOOLS:\n' +
      (toolsBlock || '(none)') +
      '\n\nEmit every remaining specialty and self_tool in CEO order. ' +
      'If GOAL names a tool id in backticks or snake_case, emit that self_tool. ' +
      'If GOAL asks to notify, email, or list workflows via orchestrator tools, map to matching TOOLS.';

    let { intents } = await llmJsonIntents({
      ownerUserId: owner,
      system,
      user,
      maxTokens: 1200,
    });

    // Second pass when empty: tools-only forced enum
    const hasToolsFromLlm = intents.some((it) => {
      const lane = String(it?.lane || '').toLowerCase();
      return lane === 'self_tool' || lane === 'tool' || lane === 'agent_tool' || lane === 'notify_ceo';
    });
    if (!intents.length || (!hasToolsFromLlm && !toolCatalogSteps.length)) {
      const enumLine = toolsForPrompt.map((t) => t.name).join('|');
      const r2 = await llmJsonIntents({
        ownerUserId: owner,
        maxTokens: 900,
        system:
          'JSON only. {"intents":[{"lane":"self_tool","label":"...","tool_name":"<exact>"}]}. ' +
          'tool_name one of: ' +
          enumLine +
          '. Skip if no self-tool intent.',
        user: 'GOAL:\n' + text.slice(0, 3500) + '\nTOOLS:\n' + toolsBlock,
      });
      if (r2.intents?.length) intents = r2.intents;
    }

    if (intents.length) {
      llmExtra = intentsToStepSpecs(intents.slice(0, MAX_INTENTS), {
        tools,
        workflows: [],
        agents,
        ownerUserId: owner,
      }).filter((st) => {
        if (st.type === 'workflow_trigger') return false;
        if (st.type === 'specialty_task') return cooStyle;
        if (st.type === 'notify_ceo') return true;
        // Self tools: COO prefer-set or exact-in-text; specialty orchestrators keep granted catalog tools
        if (st.type === 'agent_tool') {
          if (!cooStyle) return true;
          const prefer = new Set(GOAL_PLAN_SELF_TOOLS_PREFER);
          const exact = matchSelfToolsFromCatalog(text, tools).some(
            (x) => x.tool_name === st.tool_name || (st.tool_name === 'notify_ceo' && x.type === 'notify_ceo')
          );
          return prefer.has(st.tool_name) || exact;
        }
        return true;
      });
    }
  } catch (e) {
    console.warn('[goal-plan-intent] residual LLM failed', e?.message || e);
  }

  // Merge tools: catalog + llm, de-dupe by type+name; drop non-prefer junk from freeform LLM
  const preferTools = new Set(GOAL_PLAN_SELF_TOOLS_PREFER);
  const exactToolNames = new Set(
    matchSelfToolsFromCatalog(text, tools).map((s) => (s.type === 'notify_ceo' ? 'notify_ceo' : s.tool_name))
  );
  const toolSteps = [];
  const seenTool = new Set();
  for (const st of [...toolCatalogSteps, ...llmExtra.filter((x) => x.type === 'agent_tool' || x.type === 'notify_ceo')]) {
    const key = st.type === 'notify_ceo' ? 'notify_ceo' : st.tool_name;
    if (!key || seenTool.has(key)) continue;
    if (st.type === 'agent_tool' && cooStyle && !preferTools.has(key) && !exactToolNames.has(key)) continue;
    seenTool.add(key);
    if (st._order == null) {
      // place after specialties by text search
      const needle = st.type === 'notify_ceo' ? 'notify' : String(st.tool_name || '').replace(/_/g, ' ');
      const at = normalizeIntentText(text).indexOf(normalizeIntentText(needle));
      st._order = at >= 0 ? at : text.length + toolSteps.length;
    }
    toolSteps.push(st);
  }

  // Specialty: catalog residual primary; merge LLM specialty not already present (COO-style only)
  const specialtyMerged = cooStyle ? [...specialtySteps] : [];
  const seenAgent = new Set(specialtyMerged.map((s) => String(s.agent_id || '').toLowerCase()));
  if (cooStyle) {
    for (const st of llmExtra.filter((x) => x.type === 'specialty_task')) {
      const id = String(st.agent_id || '').toLowerCase();
      if (!id || seenAgent.has(id)) continue;
      seenAgent.add(id);
      if (st._order == null) st._order = text.length;
      specialtyMerged.push(st);
    }
  }

  // Orchestrator self-tools that only appear as instructions *inside* a specialty
  // step (e.g. "create a Kanban card assigned to CRM Maker") must not become
  // their own COO plan steps — that used to sort Kanban/notify ahead of specialists.
  if (specialtyMerged.length) {
    const specBlob = specialtyMerged
      .map((s) => `${s.message || ''} ${s.label || ''}`)
      .join(' ')
      .toLowerCase();
    for (let i = toolSteps.length - 1; i >= 0; i -= 1) {
      const st = toolSteps[i];
      if (!st || st.type === 'notify_ceo') continue;
      const token = String(st.tool_name || '')
        .split('_')
        .find((p) => p.length >= 5);
      if (token && specBlob.includes(token.toLowerCase())) {
        toolSteps.splice(i, 1);
      }
    }
  }

  function laneRank(t) {
    if (t.type === 'workflow_trigger') return 0;
    if (t.type === 'specialty_task') return 1;
    if (t.type === 'notify_ceo') return 4;
    if (t.type === 'agent_continue') return 3;
    return 2;
  }

  // Final ordered list: lane first (specialty before COO tools/notify), then prompt order.
  const all = [...wfCatalogSteps, ...specialtyMerged, ...toolSteps];
  all.sort((a, b) => {
    const lr = laneRank(a) - laneRank(b);
    if (lr !== 0) return lr;
    const oa = a._order != null ? a._order : 1e9;
    const ob = b._order != null ? b._order : 1e9;
    return oa - ob;
  });

  // Strip internal order key
  let steps = all.map(({ _order, ...rest }) => rest).slice(0, MAX_INTENTS);

  // Agent interpretation: compositional tools (email_send, …) after data/workflow steps
  // become agent_continue so the orchestrator composes like chat — not dry HTTP dumps.
  // Also appends continue when the goal asks for chat synthesis / HTML email / craft.
  try {
    const { rewriteCompositionalToolsForAgentInterpretation } = await import(
      './goal-plan-tool-args.js'
    );
    steps = rewriteCompositionalToolsForAgentInterpretation(steps, text, {
      maxSteps: MAX_INTENTS,
    });
  } catch (e) {
    console.warn('[goal-plan-intent] agent-interpretation rewrite skipped', e?.message || e);
  }

  if (!steps.length) return null;
  steps = mergeCapabilitySteps(steps, text);
  console.info('[goal-plan-intent] classified', {
    owner: owner.slice(0, 24),
    steps: steps.map((x) => x.type + ':' + (x.label || x.tool_name || x.agent_id || '')).slice(0, 12),
  });
  return steps;
}

export { resolveCeoEmail };
