/**
 * CEO Onboarding Helper - guided strategic org setup (draft + apply).
 */
import { getDb } from '../db/schema.js';
import {
  DEPARTMENTS_BUDGET_COLUMN,
  DEPARTMENTS_COLUMN,
  DEPARTMENTS_PURPOSE_COLUMN,
  DEPARTMENTS_TABLE_NAME,
  ensureDepartmentsMasterData,
} from './ceo-default-master-data.js';
import { findTableByName, insertRow, listRows } from './master-data.js';
import { createFullAgent } from './create-full-agent.js';
import { grantUserAgent } from './users.js';
import { ownerSlug } from './company-blueprints/standard-prefabs.js';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import {
  getBlueprint,
  inferCompanyTypeFromText,
  resolveCompanyTypeId,
} from './company-blueprints/index.js';

export const STEPS = [
  { id: 'welcome', title: 'Welcome', hint: 'Detect existing org and confirm proceed.' },
  { id: 'purpose', title: 'Purpose', hint: 'What does your organization do?' },
  { id: 'vision', title: 'Vision', hint: 'North-star aspiration.' },
  { id: 'goals_short', title: 'Short-term goals', hint: '1-3 year goals.' },
  { id: 'goals_long', title: 'Long-term goals', hint: '~5 year goals.' },
  { id: 'strategic', title: 'Strategic context', hint: 'Industry, size, channels, priorities.' },
  { id: 'departments', title: 'Departments', hint: 'Recommended departments.' },
  { id: 'agents', title: 'Agents', hint: 'Specialists mapped to departments.' },
  { id: 'tools', title: 'Tools', hint: 'Tool grants per agent.' },
  { id: 'workflows', title: 'Workflows', hint: 'Starter automation ideas.' },
  { id: 'channels', title: 'Channels', hint: 'WhatsApp / policies pointers.' },
  { id: 'review', title: 'Review & apply', hint: 'Final diff and override confirm.' },
  { id: 'done', title: 'Done', hint: 'Next steps and links.' },
];

function blueprintToTemplate(bp) {
  return {
    label: bp.label,
    departments: bp.departments,
    agents: bp.agents,
    workflows: bp.workflows,
    channels: bp.channels,
  };
}

function inferProfile(text) {
  return resolveCompanyTypeId(inferCompanyTypeFromText(text));
}

export function stepIndexById(stepId) {
  const i = STEPS.findIndex((s) => s.id === stepId);
  return i >= 0 ? i : 0;
}

export function defaultJourney() {
  return {
    step_index: 0,
    answers: {},
    confirmed: {},
    chat_log: [],
    override_ack: false,
  };
}

export function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function ensureStrategyRow(ownerUserId) {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO ceo_org_strategy (owner_user_id, status, draft_journey_json)
     VALUES (?, 'draft', ?)`
  ).run(ownerUserId, JSON.stringify(defaultJourney()));
  return db.prepare('SELECT * FROM ceo_org_strategy WHERE owner_user_id = ?').get(ownerUserId);
}

export function detectExistingOrg(ownerUserId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM user_agents ua
       INNER JOIN agents a ON a.id = ua.agent_id
       WHERE ua.user_id = ? AND ua.enabled = 1 AND a.agent_type = 'custom'`
    )
    .get(ownerUserId);
  const count = Number(row?.n || 0);
  return { has_custom_agents: count > 0, custom_agent_count: count };
}

export function buildProposal(ownerUserId, row, journey) {
  const answers = journey?.answers || {};
  const strategic = parseJson(row?.strategic_profile_json, {});
  const corpus = [
    row?.purpose,
    row?.vision,
    row?.goals_short_term,
    row?.goals_long_term,
    answers.purpose,
    answers.vision,
    answers.goals_short,
    answers.goals_long,
    answers.strategic,
    answers.welcome,
    strategic.describe_company,
  ]
    .filter(Boolean)
    .join(' ');

  let profileKey =
    resolveCompanyTypeId(journey.company_type || answers.company_type || strategic.company_type || '') ||
    inferProfile(corpus);
  if (!profileKey || profileKey === 'general_ops') {
    // if empty string from resolve of empty, fall back
    if (!journey.company_type && !answers.company_type && !strategic.company_type) {
      profileKey = inferProfile(corpus);
    }
  }
  const bp = getBlueprint(profileKey);
  const template = blueprintToTemplate(bp);

  const departments =
    answers.departments && Array.isArray(answers.departments) ? answers.departments : template.departments;
  const agents = answers.agents && Array.isArray(answers.agents) ? answers.agents : template.agents;
  const agentTools = answers.tools && typeof answers.tools === 'object' ? answers.tools : null;
  const workflows =
    answers.workflows && Array.isArray(answers.workflows) ? answers.workflows : template.workflows;
  const channels =
    answers.channels && Array.isArray(answers.channels) ? answers.channels : template.channels;
  const mdFiles =
    answers.md_files && Array.isArray(answers.md_files)
      ? answers.md_files
      : (bp.sop_documents || []).map((d) => ({
          filename: d.filename,
          content: d.contentText,
        }));
  const knowledgeTables =
    answers.knowledge_tables && Array.isArray(answers.knowledge_tables)
      ? answers.knowledge_tables
      : bp.knowledge_tables || [];

  const toolsByAgent = {};
  for (const ag of agents) {
    const key = ag.id || ag.name;
    toolsByAgent[key] = agentTools?.[key] || ag.tools || ['learnings_summary', 'master_data_rag', 'notify_ceo'];
  }

  return {
    profile: bp.id || profileKey,
    profile_label: template.label,
    purpose: row?.purpose || answers.purpose || strategic.describe_company || '',
    vision: row?.vision || answers.vision || '',
    goals_short_term: row?.goals_short_term || answers.goals_short || '',
    goals_long_term: row?.goals_long_term || answers.goals_long || '',
    strategic_profile: strategic,
    departments,
    agents: agents.map((a) => ({
      ...a,
      tools: toolsByAgent[a.id || a.name] || a.tools || [],
    })),
    workflows,
    channels,
    md_files: mdFiles,
    knowledge_tables: knowledgeTables,
    sop_documents: bp.sop_documents || [],
    depth: bp.depth || 'thin',
  };
}


function resolvePlatformHelpLink(ownerUserId) {
  try {
    const db = getDb();
    const help = db
      .prepare(
        `SELECT a.id, a.name FROM agents a
         INNER JOIN user_agents ua ON ua.agent_id = a.id
         WHERE ua.user_id = ? AND ua.enabled = 1
           AND (
             a.id = 'platformhelp'
             OR COALESCE(a.openclaw_agent_id, '') = 'platformhelp'
             OR lower(COALESCE(a.name, '')) = 'platform help'
           )
         LIMIT 1`
      )
      .get(ownerUserId);
    if (!help) return null;
    return { label: help.name || "Platform Help", path: `/agents/${help.id}/chat` };
  } catch (e) {
    console.warn("[onboarding-helper] resolvePlatformHelpLink", e?.message || e);
    return null;
  }
}

function buildCard(step, journey, proposal, existingOrg, ownerUserId) {
  const idx = journey?.step_index ?? 0;
  const confirmed = !!journey?.confirmed?.[step.id];
  const base = {
    step_id: step.id,
    step_index: idx,
    title: step.title,
    hint: step.hint,
    confirmed,
    can_confirm: !confirmed && step.id !== 'done',
    can_back: idx > 0,
    can_apply: step.id === 'review' && (!existingOrg.has_custom_agents || !!journey?.override_ack),
    existing_org: existingOrg,
  };

  switch (step.id) {
    case 'welcome':
      return {
        ...base,
        body: existingOrg.has_custom_agents
          ? `You have ${existingOrg.custom_agent_count} custom agent(s). Applying a new org blueprint will override departments/agents you confirm here.`
          : 'Welcome to strategic onboarding. We will capture purpose, vision, goals, then recommend departments, agents, tools, and starter workflows.',
        actions: ['continue', 'cancel'],
      };
    case 'purpose':
      return {
        ...base,
        field: 'purpose',
        value: proposal.purpose,
        prompt: 'Describe what your organization does in one or two sentences.',
      };
    case 'vision':
      return {
        ...base,
        field: 'vision',
        value: proposal.vision,
        prompt: 'What is your north-star vision?',
      };
    case 'goals_short':
      return {
        ...base,
        field: 'goals_short',
        value: proposal.goals_short_term,
        prompt: 'List 1-3 year goals (bullets OK).',
      };
    case 'goals_long':
      return {
        ...base,
        field: 'goals_long',
        value: proposal.goals_long_term,
        prompt: 'List ~5 year goals (bullets OK).',
      };
    case 'strategic':
      return {
        ...base,
        field: 'strategic',
        value: journey.answers?.strategic || '',
        prompt: 'Industry, team size, channels (web/WhatsApp), risk appetite, content vs ops emphasis.',
        profile_hint: proposal.profile_label,
      };
    case 'departments':
      return {
        ...base,
        list: proposal.departments,
        prompt: 'Review departments, then tap Confirm & continue (or describe changes).',
      };
    case 'agents':
      return {
        ...base,
        list: proposal.agents,
        prompt: 'Review agents, then tap Confirm & continue (or describe changes).',
      };
    case 'tools':
      return {
        ...base,
        map: Object.fromEntries(proposal.agents.map((a) => [a.name, a.tools])),
        prompt: 'Review tools, then tap Confirm & continue (or describe changes).',
      };
    case 'workflows':
      return {
        ...base,
        list: proposal.workflows,
        prompt: 'Review workflows, then tap Confirm & continue (or describe changes).',
      };
    case 'channels':
      return {
        ...base,
        list: proposal.channels,
        prompt: 'Review channels, then tap Confirm & continue (or skip).',
      };
    case 'review':
      return {
        ...base,
        summary: proposal,
        override_required: existingOrg.has_custom_agents,
        override_ack: !!journey.override_ack,
        prompt: 'Review the proposal. Say "apply override" or use Apply override when ready.',
      };
    case 'done':
      return {
        ...base,
        links: [
          { label: 'Dashboard', path: '/' },
          ...( (() => { const h = resolvePlatformHelpLink(ownerUserId); return h ? [h] : []; })() ),
          { label: 'Video Tours', path: '/video-tours' },
        ],
        prompt: 'Onboarding draft applied. Explore Video Tours and Platform Help next.',
      };
    default:
      return base;
  }
}

export function persistJourney(ownerUserId, row, journey, extra = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE ceo_org_strategy SET
      purpose = COALESCE(?, purpose),
      vision = COALESCE(?, vision),
      goals_short_term = COALESCE(?, goals_short_term),
      goals_long_term = COALESCE(?, goals_long_term),
      strategic_profile_json = COALESCE(?, strategic_profile_json),
      draft_journey_json = ?,
      updated_at = ?
     WHERE owner_user_id = ?`
  ).run(
    extra.purpose ?? null,
    extra.vision ?? null,
    extra.goals_short_term ?? null,
    extra.goals_long_term ?? null,
    extra.strategic_profile_json ?? null,
    JSON.stringify(journey),
    now,
    ownerUserId
  );
  return db.prepare('SELECT * FROM ceo_org_strategy WHERE owner_user_id = ?').get(ownerUserId);
}

function appendChat(journey, role, text) {
  journey.chat_log = Array.isArray(journey.chat_log) ? journey.chat_log : [];
  journey.chat_log.push({
    role,
    text: String(text || '').slice(0, 4000),
    at: new Date().toISOString(),
  });
  if (journey.chat_log.length > 200) journey.chat_log = journey.chat_log.slice(-200);
}

function assistantReply(step, journey, proposal, existingOrg) {
  if (step.id === 'welcome') {
    return existingOrg.has_custom_agents
      ? 'Welcome. I detected custom agents in your org. Say **continue** to proceed (apply will override) or **cancel** to stop.'
      : 'Welcome to FloLah strategic onboarding. Say **continue** when ready.';
  }
  if (step.id === 'review') {
    return `Review ready (${proposal.profile_label}). Use **Acknowledge override** / **Apply override** below when ready.`;
  }
  if (step.id === 'done') {
    return 'You are done. Open Dashboard, Video Tours, or Platform Help from the links on the right (also under the user menu → Help).';
  }
  const card = buildCard(step, journey, proposal, existingOrg);
  if (card.prompt) return card.prompt;
  return `Review the card, then tap **Confirm & continue** below (or describe changes in chat).`;
}


function chatActionsFor(step, card, journey) {
  if (!step || step.id === 'done') return [];
  if (step.id === 'welcome') {
    return [{ id: 'continue', label: 'Continue' }];
  }
  if (step.id === 'review') {
    const actions = [];
    if (card?.override_required && !journey?.override_ack) {
      actions.push({ id: 'ack_override', label: 'Acknowledge override' });
    }
    if (card?.can_apply) {
      actions.push({ id: 'apply', label: 'Apply override' });
    }
    return actions;
  }
  // Answer + proposal steps: allow completing from chat
  return [{ id: 'confirm', label: 'Confirm & continue' }];
}

export function getState(ownerUserId) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  if (typeof journey.step_index !== 'number') journey.step_index = 0;
  const existingOrg = detectExistingOrg(ownerUserId);
  const proposal = buildProposal(ownerUserId, row, journey);
  const step = STEPS[journey.step_index] || STEPS[0];
  const card = buildCard(step, journey, proposal, existingOrg, ownerUserId);
  return {
    owner_user_id: ownerUserId,
    status: row.status,
    applied_at: row.applied_at,
    purpose: row.purpose,
    vision: row.vision,
    goals_short_term: row.goals_short_term,
    goals_long_term: row.goals_long_term,
    strategic_profile: parseJson(row.strategic_profile_json, {}),
    steps: STEPS,
    step_index: journey.step_index,
    current_step: step,
    journey,
    proposal,
    existing_org: existingOrg,
    card,
    chat_actions: chatActionsFor(step, card, journey),
    selectable_items: buildSelectableItems(proposal, journey),
    proposal_source: journey.proposal_source || null,
    agent_proposal_ready: Boolean(journey.proposal_source === "openclaw_onboardinghelper" || (journey.answers && ((journey.answers.agents && journey.answers.agents.length) || (journey.answers.departments && journey.answers.departments.length)))),
  };
}

export function saveDraft(ownerUserId, body = {}) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  if (body.draft_journey && typeof body.draft_journey === 'object') {
    Object.assign(journey, body.draft_journey);
  }
  if (body.answers && typeof body.answers === 'object') {
    journey.answers = { ...(journey.answers || {}), ...body.answers };
  }
  if (typeof body.step_index === 'number') {
    journey.step_index = Math.max(0, Math.min(STEPS.length - 1, body.step_index));
  }
  const strategic = body.strategic_profile || body.strategicProfile;
  persistJourney(ownerUserId, row, journey, {
    purpose: body.purpose,
    vision: body.vision,
    goals_short_term: body.goals_short_term ?? body.goalsShortTerm,
    goals_long_term: body.goals_long_term ?? body.goalsLongTerm,
    strategic_profile_json: strategic ? JSON.stringify(strategic) : undefined,
  });
  console.info('[onboarding-helper] draft saved owner=', ownerUserId, 'step=', journey.step_index);
  return getState(ownerUserId);
}

export function goToStep(ownerUserId, stepIndex) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  journey.step_index = Math.max(0, Math.min(STEPS.length - 1, Number(stepIndex) || 0));
  persistJourney(ownerUserId, row, journey);
  console.info('[onboarding-helper] goToStep owner=', ownerUserId, 'index=', journey.step_index);
  return getState(ownerUserId);
}

function captureAnswerForStep(stepId, message, journey, row) {
  const text = String(message || '').trim();
  if (!text) return;
  journey.answers = journey.answers || {};
  switch (stepId) {
    case 'purpose':
      journey.answers.purpose = text;
      row.purpose = text;
      break;
    case 'vision':
      journey.answers.vision = text;
      row.vision = text;
      break;
    case 'goals_short':
      journey.answers.goals_short = text;
      row.goals_short_term = text;
      break;
    case 'goals_long':
      journey.answers.goals_long = text;
      row.goals_long_term = text;
      break;
    case 'strategic':
      journey.answers.strategic = text;
      break;
    case 'welcome':
      journey.answers.welcome = text;
      break;
    default:
      journey.answers[stepId] = text;
  }
}

export function chatTurn(ownerUserId, message) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const existingOrg = detectExistingOrg(ownerUserId);
  const step = STEPS[journey.step_index] || STEPS[0];
  const proposal = buildProposal(ownerUserId, row, journey);
  const msg = String(message || '').trim();
  const lower = msg.toLowerCase();

  appendChat(journey, 'user', msg);

  let reply = '';
  let advanced = false;

  if (/^cancel\b/.test(lower)) {
    reply = 'Cancelled. Your draft is saved; open Onboarding anytime to continue.';
  } else if (/^continue\b|^yes\b|^proceed\b/.test(lower) && step.id === 'welcome') {
    journey.confirmed = journey.confirmed || {};
    journey.confirmed.welcome = true;
    journey.step_index = Math.min(journey.step_index + 1, STEPS.length - 1);
    advanced = true;
    reply = assistantReply(
      STEPS[journey.step_index],
      journey,
      buildProposal(ownerUserId, row, journey),
      existingOrg
    );
  } else if (/^skip\b/.test(lower)) {
    journey.step_index = Math.min(journey.step_index + 1, STEPS.length - 1);
    advanced = true;
    reply =
      'Skipped.\n\n' +
      assistantReply(
        STEPS[journey.step_index],
        journey,
        buildProposal(ownerUserId, row, journey),
        existingOrg
      );
  } else if (/^confirm\b/.test(lower)) {
    journey.confirmed = journey.confirmed || {};
    journey.confirmed[step.id] = true;
    journey.step_index = Math.min(journey.step_index + 1, STEPS.length - 1);
    advanced = true;
    reply = assistantReply(
      STEPS[journey.step_index],
      journey,
      buildProposal(ownerUserId, row, journey),
      existingOrg
    );
  } else if (/apply\s+override|override\s+apply|confirm\s+override/.test(lower)) {
    journey.override_ack = true;
    reply = 'Override acknowledged. Use **Apply override** on the review card when ready.';
  } else if (/^back\b|^go\s+back\b/.test(lower)) {
    const m = lower.match(/back\s+(?:to\s+)?([a-z_]+)/);
    if (m) {
      journey.step_index = stepIndexById(m[1]);
    } else {
      journey.step_index = Math.max(0, journey.step_index - 1);
    }
    reply = `Back to ${STEPS[journey.step_index].title}.`;
  } else if (msg) {
    const answerSteps = new Set(['purpose', 'vision', 'goals_short', 'goals_long', 'strategic']);
    captureAnswerForStep(step.id, msg, journey, row);
    if (answerSteps.has(step.id)) {
      journey.confirmed = journey.confirmed || {};
      journey.confirmed[step.id] = true;
      journey.step_index = Math.min(journey.step_index + 1, STEPS.length - 1);
      advanced = true;
      const next = STEPS[journey.step_index] || STEPS[STEPS.length - 1];
      const nextProposal = buildProposal(ownerUserId, row, journey);
      reply =
        'Got it.\n\n' + assistantReply(next, journey, nextProposal, existingOrg);
    } else if (step.id === 'welcome') {
      journey.confirmed = journey.confirmed || {};
      journey.confirmed.welcome = true;
      journey.step_index = Math.min(journey.step_index + 1, STEPS.length - 1);
      advanced = true;
      reply = assistantReply(
        STEPS[journey.step_index],
        journey,
        buildProposal(ownerUserId, row, journey),
        existingOrg
      );
    } else {
      reply =
        'Noted on the card. Reply **confirm** when it looks right, or describe another change.';
    }
  } else {
    reply = 'Send a message or say continue, confirm, skip, back, or apply override.';
  }

  appendChat(journey, 'assistant', reply);
  persistJourney(ownerUserId, row, journey, {
    purpose: row.purpose,
    vision: row.vision,
    goals_short_term: row.goals_short_term,
    goals_long_term: row.goals_long_term,
  });

  const state = getState(ownerUserId);
  return { ...state, reply, advanced };
}

export function confirmStep(ownerUserId) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const existingOrg = detectExistingOrg(ownerUserId);
  const step = STEPS[journey.step_index] || STEPS[0];
  journey.confirmed = journey.confirmed || {};
  journey.confirmed[step.id] = true;
  if (step.id !== 'done') {
    journey.step_index = Math.min(journey.step_index + 1, STEPS.length - 1);
  }
  const next = STEPS[journey.step_index] || STEPS[STEPS.length - 1];
  const reply = assistantReply(
    next,
    journey,
    buildProposal(ownerUserId, row, journey),
    existingOrg
  );
  appendChat(journey, 'assistant', reply);
  persistJourney(ownerUserId, row, journey);
  console.info('[onboarding-helper] confirmStep owner=', ownerUserId, 'step=', step.id, '->', next.id);
  return { ...getState(ownerUserId), reply, advanced: step.id !== 'done' };
}

async function applyDepartments(ownerUserId, departments) {
  ensureDepartmentsMasterData(ownerUserId);
  const table = findTableByName(ownerUserId, DEPARTMENTS_TABLE_NAME);
  if (!table) throw new Error('Departments table missing');
  const { rows } = listRows(ownerUserId, table.id, { limit: 500, offset: 0 });
  const existing = new Set(
    (rows || [])
      .map((r) => String(r.data?.[DEPARTMENTS_COLUMN] ?? '').trim().toLowerCase())
      .filter(Boolean)
  );
  let inserted = 0;
  for (const dept of departments || []) {
    const name = String(dept.name || dept).trim();
    if (!name || existing.has(name.toLowerCase())) continue;
    insertRow(ownerUserId, table.id, {
      [DEPARTMENTS_COLUMN]: name,
      [DEPARTMENTS_PURPOSE_COLUMN]: String(dept.purpose || '').trim(),
      [DEPARTMENTS_BUDGET_COLUMN]:
        dept.monthly_token_budget != null ? String(dept.monthly_token_budget) : '',
    });
    existing.add(name.toLowerCase());
    inserted += 1;
  }
  return inserted;
}


export function resetJourney(ownerUserId) {
  ensureStrategyRow(ownerUserId);
  const db = getDb();
  const now = new Date().toISOString();
  const fresh = defaultJourney();
  // Session-only reset: clears wizard draft/answers/chat. Does NOT delete departments, agents, or org setup.
  db.prepare(
    `UPDATE ceo_org_strategy SET
      purpose = NULL,
      vision = NULL,
      goals_short_term = NULL,
      goals_long_term = NULL,
      strategic_profile_json = NULL,
      draft_journey_json = ?,
      status = 'draft',
      updated_at = ?
    WHERE owner_user_id = ?`
  ).run(JSON.stringify(fresh), now, ownerUserId);
  console.info('[onboarding-helper] journey reset owner=', ownerUserId, '(session only; org setup untouched)');
  return getState(ownerUserId);
}

export async function applyProposal(ownerUserId, { confirm_override: confirmOverride, selected: selectedOverride } = {}) {
  if (!confirmOverride) {
    const err = new Error('confirm_override required - applying replaces org recommendations');
    err.status = 400;
    throw err;
  }
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const existingOrg = detectExistingOrg(ownerUserId);
  if (existingOrg.has_custom_agents && !journey.override_ack) {
    const err = new Error('Existing custom agents detected - acknowledge override in review first');
    err.status = 409;
    throw err;
  }

  const fullProposal = buildProposal(ownerUserId, row, journey);
  const selected = selectedOverride && typeof selectedOverride === 'object'
    ? selectedOverride
    : journey.selected_apply;
  const proposal = filterProposalSelection(fullProposal, selected);
  console.info('[onboarding-helper] apply start owner=', ownerUserId, 'profile=', proposal.profile);

  const deptInserted = await applyDepartments(ownerUserId, proposal.departments);
  const createdAgents = [];
  const createdAgentRows = [];
  const defaultParentId = getDb().prepare('SELECT id FROM agents WHERE is_coo = 1 LIMIT 1').get()?.id || null;
  for (const ag of proposal.agents || []) {
    try {
      let id = ag.id || undefined;
      if (!id && ag.id_pattern) {
        id = String(ag.id_pattern)
          .replace(/\{ownerSlug\}/gi, ownerSlug(ownerUserId))
          .replace(/[^a-zA-Z0-9-_]/g, '-')
          .slice(0, 40);
      }
      const templateBase = ag.workspace_template_base || ag.template_base_id || null;
      const agent = await createFullAgent({
        id,
        name: ag.name,
        role: ag.role || ag.name,
        department: ag.department || 'Operations',
        parent_id: ag.parent_id || ag.reporting_to || ag.reportingTo || defaultParentId,
        ownerUserId,
        tools: Array.isArray(ag.tools) ? ag.tools : undefined,
        template_base_id: templateBase || undefined,
        workspace_template: ag.workspace_template || undefined,
        preserveTemplateWorkspaceDocs: !!templateBase,
      });
      grantUserAgent(ownerUserId, agent.id);
      createdAgents.push(agent.id);
      createdAgentRows.push(agent);
    } catch (e) {
      console.warn('[onboarding-helper] createFullAgent failed name=', ag.name, 'err=', e?.message || e);
    }
  }
  const mdFilesWritten = writeProposalMdFiles(ownerUserId, proposal.md_files, createdAgentRows);

  journey.step_index = stepIndexById('done');
  journey.confirmed.review = true;
  journey.confirmed.done = true;
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `UPDATE ceo_org_strategy SET
      status = 'applied',
      applied_at = ?,
      draft_journey_json = ?,
      updated_at = ?
     WHERE owner_user_id = ?`
  ).run(now, JSON.stringify(journey), now, ownerUserId);

  console.info(
    '[onboarding-helper] apply done owner=',
    ownerUserId,
    'depts=',
    deptInserted,
    'agents=',
    createdAgents.length
  );

  return {
    ...getState(ownerUserId),
    applied: {
      departments_inserted: deptInserted,
      agents_created: createdAgents,
      workflows_suggested: proposal.workflows,
      channels_notes: proposal.channels,
      md_files_written: mdFilesWritten,
    },
    md_files_written: mdFilesWritten,
  };
}

function proposalKey(kind, item, index) {
  const label = typeof item === 'string' ? item : item?.id || item?.name || item?.title || index;
  return `${kind}:${String(label).trim().toLowerCase().replace(/\s+/g, '-')}`;
}

export function buildSelectableItems(proposal = {}, journey = {}) {
  const selected = journey.selected_apply || {};
  const add = (kind, items = []) => items.map((item, index) => {
    const id = proposalKey(kind, item, index);
    return { id, kind, label: typeof item === 'string' ? item : item.name || item.title || id, selected: selected[id] !== false };
  });
  return [
    ...add('department', proposal.departments),
    ...add('agent', proposal.agents),
    ...add('workflow', proposal.workflows),
    ...add('channel', proposal.channels),
    ...add('md_file', proposal.md_files),
    ...add('knowledge_table', proposal.knowledge_tables),
  ];
}

export function defaultSelectedApply(proposal = {}) {
  return Object.fromEntries(buildSelectableItems(proposal, {}).map((item) => [item.id, true]));
}

export function filterProposalSelection(proposal = {}, selected = {}) {
  const include = (kind, item, index) => selected[proposalKey(kind, item, index)] !== false;
  const hasDepartmentItems = (proposal.departments || []).length > 0;
  const selectedDepartmentNames = new Set(
    (proposal.departments || [])
      .filter((item, index) => include('department', item, index))
      .map((item) => String(typeof item === 'string' ? item : item.name || '').trim().toLowerCase())
  );
  return {
    ...proposal,
    departments: (proposal.departments || []).filter((item, index) => include('department', item, index)),
    agents: (proposal.agents || []).filter((item, index) =>
      include('agent', item, index) && (!item.department || !hasDepartmentItems || selectedDepartmentNames.has(String(item.department).trim().toLowerCase()))
    ),
    workflows: (proposal.workflows || []).filter((item, index) => include('workflow', item, index)),
    channels: (proposal.channels || []).filter((item, index) => include('channel', item, index)),
    md_files: (proposal.md_files || []).filter((item, index) => include('md_file', item, index)),
    knowledge_tables: (proposal.knowledge_tables || []).filter((item, index) =>
      include('knowledge_table', item, index)
    ),
  };
}

export function normalizeAgentProposalPayload(payload = {}) {
  const source = payload.proposal && typeof payload.proposal === 'object' ? payload.proposal : payload;
  const asArray = (value) => Array.isArray(value) ? value : [];
  return {
    departments: asArray(source.departments).map((item) => typeof item === 'string' ? { name: item } : item).filter((item) => item?.name),
    agents: asArray(source.agents).filter((item) => item?.name).map((item) => ({ ...item, tools: Array.isArray(item.tools) ? item.tools : [] })),
    tools: source.tools && typeof source.tools === 'object' ? source.tools : {},
    workflows: asArray(source.workflows),
    channels: asArray(source.channels),
    md_files: asArray(source.md_files).filter((item) => typeof item === 'string' || (item && typeof item === 'object')),
  };
}

export function writeProposalMdFiles(ownerUserId, files = [], createdAgentRows = []) {
  const written = [];
  const byName = new Map();
  for (const a of createdAgentRows || []) {
    if (a?.name) byName.set(String(a.name).toLowerCase(), a);
    if (a?.id) byName.set(String(a.id).toLowerCase(), a);
  }
  const fallbackRoot = join(process.cwd(), 'data', 'onboarding-proposals', String(ownerUserId));
  for (const [index, item] of (files || []).entries()) {
    const content = typeof item === 'string' ? item : String(item?.content || item?.markdown || '');
    const agentKey = typeof item === 'object' && item ? String(item.agent || item.agent_name || '').trim() : '';
    const agent = agentKey ? byName.get(agentKey.toLowerCase()) : null;
    const rawName =
      typeof item === 'string'
        ? `proposal-${index + 1}.md`
        : item.file || item.filename || item.name || item.path || `proposal-${index + 1}.md`;
    const rel = String(rawName).replace(/^[/\\]+/, '').replace(/\.\./g, '');
    const safeRel = rel.match(/\.(md|txt)$/i) ? rel : `${rel.replace(/[^a-zA-Z0-9._/-]/g, '-')}.md`;
    const root = agent?.tenant_workspace_path || agent?.workspace_path || fallbackRoot;
    const target = join(root, safeRel);
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
      written.push({ path: target, agent: agent?.id || null, file: safeRel });
      console.info('[onboarding-helper] wrote md', agent?.id || ownerUserId, safeRel);
    } catch (e) {
      console.warn('[onboarding-helper] md write failed', target, e?.message || e);
    }
  }
  return written;
}

export function saveAgentProposal(ownerUserId, payload = {}) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const proposal = normalizeAgentProposalPayload(payload);
  journey.answers = { ...(journey.answers || {}), ...proposal };
  journey.proposal_source = 'openclaw_onboardinghelper';
  journey.step_index = stepIndexById('review');
  journey.selected_apply = defaultSelectedApply({ ...buildProposal(ownerUserId, row, journey), md_files: proposal.md_files });
  persistJourney(ownerUserId, row, journey);
  const state = getState(ownerUserId);
  return { ok: true, saved: true, review_path: '/onboarding', proposal: state.proposal, selectable_items: state.selectable_items };
}

export function updateSelectedApply(ownerUserId, selectedApply = {}) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  journey.selected_apply = { ...(journey.selected_apply || {}), ...(selectedApply || {}) };
  persistJourney(ownerUserId, row, journey);
  return getState(ownerUserId);
}
