/**
 * Company setup gate + funnel state (Phase C).
 * CEO-owner scoped; stores extras on ceo_org_strategy.strategic_profile_json + journey.
 */
import { getDb } from '../db/schema.js';
import {
  ensureStrategyRow,
  parseJson,
  persistJourney,
  getState as getOnboardingState,
  buildProposal,
  defaultJourney,
  detectExistingOrg,
  applyProposal,
  defaultSelectedApply,
} from './onboarding-helper.js';
import {
  getBlueprint,
  listCompanyTypeCards,
  listBlueprintsForIndustry,
  getDefaultBlueprintIdForIndustry,
  inferCompanyTypeFromText,
  resolveCompanyTypeId,
  policyTextForStyle,
  hasDedicatedCompanyTemplate,
} from './company-blueprints/index.js';
import { createTable, findTableByName, insertRow, uploadDocument } from './master-data.js';
import { upsertCeoGuardrails, mergeUniversalSafetyPolicy, ensureUniversalSafetyGuardrails } from './ceo-guardrails.js';
import { updateUserProfile } from './users.js';
import {
  shouldUseLlmOrgDesign,
  designCompanyOrgWithLlm,
  refineCompanyOrgWithLlm,
} from './company-llm-design.js';
import {
  searchConnectorApps,
  provisionOpenConnectorForUser,
} from './openconnector.js';

const SYSTEMS_CATALOG = [
  { id: 'gmail', label: 'Gmail / Email', path: '/connectors' },
  { id: 'slack', label: 'Slack', path: null, note: 'Configure under each AI employee → Channels' },
  { id: 'notion', label: 'Notion', path: '/connectors' },
  { id: 'github', label: 'GitHub', path: '/connectors' },
  { id: 'jira', label: 'Jira', path: '/connectors' },
  { id: 'google_drive', label: 'Google Drive', path: '/connectors' },
  { id: 'hubspot', label: 'HubSpot', path: '/connectors' },
  { id: 'm365', label: 'Microsoft 365', path: '/connectors' },
  { id: 'browser_session', label: 'Browser Session (social sites)', path: '/browser-session' },
  { id: 'replicate', label: 'Video / image (Replicate BYOK)', path: '/api-keys' },
  { id: 'aws', label: 'AWS', path: '/connectors' },
  { id: 'azure', label: 'Azure', path: '/connectors' },
];

/** Featured checklist shown first (browse more via OpenConnector search). */
export const SYSTEMS_TOP10_IDS = [
  'browser_session',
  'replicate',
  'gmail',
  'slack',
  'notion',
  'google_drive',
  'github',
  'jira',
  'm365',
  'hubspot',
];

export const ORG_DNA_PRESETS = [
  { id: 'fast_startup', label: 'Fast-moving startup', seed: 'Low ceremony; short feedback loops; broader delegation; notify on spend/risk.' },
  { id: 'cost_conscious', label: 'Cost-conscious', seed: 'Tighter budgets; justify spend; batch work; escalate cost risks.' },
  { id: 'enterprise', label: 'Enterprise governance', seed: 'Approvals default on; audit-friendly reporting; formal escalation.' },
  { id: 'creative_agency', label: 'Creative agency', seed: 'Brand voice weight high; review gates on publish; idea diversity.' },
  { id: 'customer_obsessed', label: 'Customer-obsessed', seed: 'Customer risk escalates fast; reply norms priority.' },
  { id: 'data_driven', label: 'Data-driven', seed: 'Metrics-first reporting; weekly summary cadence; experiment notes.' },
];


function resolveSelectedBlueprint(strategic, journey = {}) {
  const industry = resolveCompanyTypeId(
    strategic.company_type_card ||
      strategic.company_type ||
      journey.company_type_card ||
      journey.company_type ||
      'general_ops'
  );
  const candidates = [
    strategic.blueprint_id,
    journey.blueprint_id,
    strategic.company_type_card,
    strategic.company_type,
    journey.company_type_card,
    journey.company_type,
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean);

  for (const id of candidates) {
    const bp = getBlueprint(id);
    if (!bp?.id) continue;
    const bpIndustry = resolveCompanyTypeId(bp.industry || bp.id);
    if (
      bpIndustry === industry ||
      bp.id === industry ||
      (Array.isArray(bp.aliases) && bp.aliases.includes(industry))
    ) {
      return bp;
    }
  }
  return getBlueprint(getDefaultBlueprintIdForIndustry(industry));
}

function blueprintMatchesIndustry(blueprintId, industryId) {
  if (!blueprintId || !industryId) return false;
  const bp = getBlueprint(blueprintId);
  if (!bp?.id) return false;
  const industry = resolveCompanyTypeId(industryId);
  const bpIndustry = resolveCompanyTypeId(bp.industry || bp.id);
  return (
    bpIndustry === industry ||
    bp.id === industry ||
    (Array.isArray(bp.aliases) && bp.aliases.includes(industry))
  );
}

function systemsTop10() {
  const order = new Map(SYSTEMS_TOP10_IDS.map((id, i) => [id, i]));
  return SYSTEMS_CATALOG.filter((s) => order.has(s.id)).sort(
    (a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99)
  );
}


function getStrategic(row) {
  return parseJson(row?.strategic_profile_json, {});
}

function writeStrategic(ownerUserId, row, journey, strategic) {
  persistJourney(ownerUserId, row, journey, {
    strategic_profile_json: JSON.stringify(strategic),
  });
}

export function getSetupGate(ownerUserId) {
  const row = ensureStrategyRow(ownerUserId);
  const strategic = getStrategic(row);
  const existingOrg = detectExistingOrg(ownerUserId);
  let gate = strategic.setup_gate || null;
  // Default only for truly new CEOs; never trap existing orgs.
  if (!gate) {
    if (row.status === 'applied') gate = 'completed';
    else if (existingOrg.has_custom_agents) gate = 'skipped';
    else gate = 'pending';
  }
  return {
    owner_user_id: ownerUserId,
    setup_gate: gate,
    status: row.status,
    company_type: strategic.company_type || null,
    company_name: strategic.company_name || null,
    company_type_card: strategic.company_type_card || null,
    mission: strategic.mission || null,
    org_dna: strategic.org_dna || null,
    management_style: strategic.management_style || null,
    systems: strategic.systems || [],
    existing_org: existingOrg,
    needs_gate: gate === 'pending',
    company_types: listCompanyTypeCards(),
    systems_catalog: SYSTEMS_CATALOG,
    systems_top: systemsTop10(),
    org_dna_presets: ORG_DNA_PRESETS,
  };
}

export function skipCompanySetup(ownerUserId) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const strategic = getStrategic(row);
  strategic.setup_gate = 'skipped';
  writeStrategic(ownerUserId, row, journey, strategic);
  console.info('[company-setup] skip gate owner=', ownerUserId);
  return getSetupGate(ownerUserId);
}

export function beginCreateCompany(ownerUserId) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const strategic = getStrategic(row);
  strategic.setup_gate = 'in_progress';
  strategic.funnel_step = 'type';
  writeStrategic(ownerUserId, row, journey, strategic);
  console.info('[company-setup] begin create owner=', ownerUserId);
  return getFunnelState(ownerUserId);
}

/**
 * Save funnel draft fields and refresh proposal from blueprint.
 */
export function saveFunnelDraft(ownerUserId, body = {}) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const strategic = getStrategic(row);

  if (body.funnel_step) strategic.funnel_step = String(body.funnel_step);
  if (body.company_type != null) {
    const cardId = String(body.company_type).trim();
    strategic.company_type_card = cardId;
    strategic.company_type = resolveCompanyTypeId(cardId);
    journey.answers = journey.answers || {};
    journey.company_type = strategic.company_type;
    journey.company_type_card = cardId;
  }

  if (body.blueprint_id != null && String(body.blueprint_id).trim()) {
    const bid = String(body.blueprint_id).trim();
    strategic.blueprint_id = bid;
    journey.blueprint_id = bid;
    const bpSel = getBlueprint(bid);
    if (bpSel?.industry) {
      strategic.company_type = resolveCompanyTypeId(bpSel.industry);
      journey.company_type = strategic.company_type;
      if (!strategic.company_type_card) {
        strategic.company_type_card = strategic.company_type;
        journey.company_type_card = strategic.company_type;
      }
    }
  } else if (body.company_type != null) {
    // Align blueprint to industry when missing OR mismatched (e.g. stale general_ops under content_creator)
    const industry = strategic.company_type || resolveCompanyTypeId(body.company_type);
    if (!blueprintMatchesIndustry(strategic.blueprint_id || journey.blueprint_id, industry)) {
      strategic.blueprint_id = getDefaultBlueprintIdForIndustry(industry);
      journey.blueprint_id = strategic.blueprint_id;
      console.info(
        '[company-setup] aligned blueprint_id=',
        strategic.blueprint_id,
        'to industry=',
        industry
      );
    }
  }

if (body.mission != null) {
    strategic.mission = String(body.mission).trim().slice(0, 2000);
    journey.answers = journey.answers || {};
    journey.answers.mission = strategic.mission;
  }
  if (body.org_dna != null) {
    const dna = String(body.org_dna).trim();
    if (ORG_DNA_PRESETS.some((d) => d.id === dna)) {
      strategic.org_dna = dna;
    }
  }
  if (body.org_dna_notes != null) {
    strategic.org_dna_notes = String(body.org_dna_notes).trim().slice(0, 1000);
  }
  if (body.describe_company) {
    strategic.describe_company = String(body.describe_company).slice(0, 2000);
    if (!body.company_type) {
      strategic.company_type = inferCompanyTypeFromText(body.describe_company);
      journey.company_type = strategic.company_type;
    }
    journey.answers = journey.answers || {};
    journey.answers.purpose = strategic.describe_company;
  }
  if (body.company_name != null) {
    strategic.company_name = String(body.company_name).trim().slice(0, 200);
    try {
      if (strategic.company_name) {
        updateUserProfile(ownerUserId, { business_name: strategic.company_name });
      }
    } catch (e) {
      console.warn('[company-setup] business_name update', e?.message || e);
    }
  }
  if (body.headcount != null) strategic.headcount = String(body.headcount);
  if (body.country != null) strategic.country = String(body.country).slice(0, 120);
  if (body.industry != null) strategic.industry = String(body.industry).slice(0, 120);
  if (Array.isArray(body.systems)) {
    strategic.systems = body.systems.map((s) => String(s).slice(0, 64)).slice(0, 40);
  }
  if (body.management_style != null) {
    const ms = String(body.management_style);
    if (['suggest', 'after_approval', 'autonomous'].includes(ms)) {
      strategic.management_style = ms;
    }
  }
  if (body.setup_gate) strategic.setup_gate = String(body.setup_gate);

  // Seed blueprint pack proposal only when there is no design yet (or explicit reset).
  // CRITICAL: never wipe LLM design on later funnel steps (preview?systems?review).
  // Always resolve via industry-aligned selection (never trust a mismatched blueprint_id alone).
  const bp = resolveSelectedBlueprint(strategic, journey);
  if (!strategic.blueprint_id || !blueprintMatchesIndustry(strategic.blueprint_id, strategic.company_type)) {
    strategic.blueprint_id = bp.id;
    journey.blueprint_id = bp.id;
  }
  journey.answers = journey.answers || {};
  const designed =
    journey.answers?.design_source === 'llm' ||
    journey.answers?.design_source === 'template' ||
    journey.answers?.design_source === 'template_fallback';
  const keepProposal =
    body.reset_proposal === true
      ? false
      : designed ||
        (body.keep_proposal === true &&
          !!journey.answers?.design_source &&
          journey.answers.design_source !== 'template_pending');
  if (!keepProposal) {
    journey.answers.departments = bp.departments;
    journey.answers.agents = bp.agents;
    journey.answers.workflows = bp.workflows;
    journey.answers.channels = bp.channels;
    journey.answers.md_files = (bp.sop_documents || []).map((d) => ({
      filename: d.filename,
      content: d.contentText,
      agent: null,
    }));
    journey.answers.knowledge_tables = bp.knowledge_tables || [];
    journey.answers.sop_documents = bp.sop_documents || [];
    journey.answers.systems_recommended = bp.systems_recommended || [];
    journey.answers.design_source = hasDedicatedCompanyTemplate(strategic.company_type)
      ? 'template'
      : 'template_pending';
    journey.selected_apply = defaultSelectedApply({
      departments: bp.departments,
      agents: bp.agents,
      workflows: bp.workflows,
      channels: bp.channels,
      md_files: journey.answers.md_files,
      knowledge_tables: bp.knowledge_tables,
    });
  }

  if (body.purpose != null) {
    journey.answers.purpose = String(body.purpose);
  }

  writeStrategic(ownerUserId, row, journey, {
    ...strategic,
    purpose_seed: journey.answers.purpose || strategic.describe_company || '',
  });

  // Also set purpose column for strategy row
  const row2 = ensureStrategyRow(ownerUserId);
  const journey2 = parseJson(row2.draft_journey_json, defaultJourney());
  if (journey.answers.purpose) {
    persistJourney(ownerUserId, row2, journey2, {
      purpose: journey.answers.purpose,
      strategic_profile_json: JSON.stringify(getStrategic(ensureStrategyRow(ownerUserId))),
    });
  }

  console.info(
    '[company-setup] draft saved owner=',
    ownerUserId,
    'type=',
    strategic.company_type,
    'step=',
    strategic.funnel_step
  );
  return getFunnelState(ownerUserId);
}

export function getFunnelState(ownerUserId) {
  const gate = getSetupGate(ownerUserId);
  const onboarding = getOnboardingState(ownerUserId);
  const strategic = onboarding.strategic_profile || {};
  const companyType = strategic.company_type || 'general_ops';
  const blueprint = resolveSelectedBlueprint(strategic, onboarding.journey || {});
  const industryBlueprints = listBlueprintsForIndustry(strategic.company_type_card || companyType);
  const proposal = onboarding.proposal || buildProposal(ownerUserId, ensureStrategyRow(ownerUserId), onboarding.journey);

  // Enrich proposal with blueprint knowledge for UI preview
  const enriched = {
    ...proposal,
    profile: blueprint.id || companyType,
    profile_label: blueprint.label,
    knowledge_tables: proposal.knowledge_tables || blueprint.knowledge_tables || [],
    sop_documents: proposal.sop_documents || blueprint.sop_documents || [],
    systems_recommended: blueprint.systems_recommended || [],
    depth: blueprint.depth,
  };

  return {
    ...gate,
    funnel_step: strategic.funnel_step || 'welcome',
    strategic_profile: strategic,
    proposal: enriched,
    blueprint: {
      id: blueprint.id,
      label: blueprint.label,
      description: blueprint.description,
      depth: blueprint.depth,
      departments: blueprint.departments,
      agents: blueprint.agents,
    },
    org_tree: buildOrgTreePreview(blueprint, enriched),
    selectable_items: onboarding.selectable_items,
    journey: onboarding.journey,
    management_style: strategic.management_style || 'after_approval',
    policy_preview: policyTextForStyle(blueprint, strategic.management_style || 'after_approval'),
    design_source: onboarding.journey?.answers?.design_source || strategic.design_source || null,
    design_model: onboarding.journey?.answers?.design_model || null,
    design_chat: Array.isArray(strategic.design_chat) ? strategic.design_chat : [],
    mission: strategic.mission || '',
    org_dna: strategic.org_dna || null,
    org_dna_notes: strategic.org_dna_notes || '',
    company_type_card: strategic.company_type_card || strategic.company_type || null,
    blueprint_id: strategic.blueprint_id || blueprint.id,
    industry_blueprints: industryBlueprints,
  };
}

function buildOrgTreePreview(blueprint, proposal = null) {
  const depts = proposal?.departments || blueprint.departments || [];
  const agents = proposal?.agents || blueprint.agents || [];
  return {
    root: { label: 'You — CEO' },
    departments: depts.map((d) => ({
      name: d.name,
      purpose: d.purpose,
      employees: agents
        .filter((a) => String(a.department || '') === String(d.name))
        .map((a) => ({ name: a.name, role: a.role })),
    })),
  };
}

/**
 * Apply company blueprint (departments, AI employees, knowledge, SOPs, policy).
 */

/**
 * Design departments + AI employees: dedicated blueprint OR LLM when no pack.
 */
export async function designCompanyOrg(ownerUserId) {
  const row = ensureStrategyRow(ownerUserId);
  let journey = parseJson(row.draft_journey_json, defaultJourney());
  const strategic = getStrategic(row);
  const companyType = resolveCompanyTypeId(strategic.company_type || journey.company_type || 'general_ops');
  const bp = resolveSelectedBlueprint(strategic, journey);
  const typeCards = listCompanyTypeCards();
  const card = typeCards.find((c) => c.id === strategic.company_type_card || c.id === strategic.company_type || c.id === companyType || c.maps_to === companyType);
  const typeLabel = card?.label || bp.label || companyType;

  const useLlm = shouldUseLlmOrgDesign(companyType, {
    describe: strategic.describe_company || journey.answers?.purpose || '',
    industry: strategic.industry || typeLabel || '',
  });

  let design;
  if (useLlm) {
    design = await designCompanyOrgWithLlm(ownerUserId, {
      company_name: strategic.company_name || '',
      company_type: companyType,
      company_type_label: typeLabel,
      describe_company: strategic.describe_company || journey.answers?.purpose || '',
      industry: strategic.industry || typeLabel || '',
      country: strategic.country || '',
      headcount: strategic.headcount || '',
      mission: strategic.mission || '',
      org_dna: strategic.org_dna || '',
      org_dna_notes: strategic.org_dna_notes || '',
    });
  } else {
    design = {
      departments: bp.departments,
      agents: bp.agents,
      workflows: bp.workflows || [],
      channels: bp.channels || [],
      design_source: 'template',
    };
  }

  journey = parseJson(ensureStrategyRow(ownerUserId).draft_journey_json, defaultJourney());
  journey.answers = journey.answers || {};
  journey.answers.departments = design.departments;
  journey.answers.agents = design.agents;
  journey.answers.workflows = design.workflows;
  journey.answers.channels = design.channels;
  journey.answers.design_source = design.design_source;
  journey.answers.design_model = design.model_used || null;
  if (design.design_error) journey.answers.design_error = design.design_error;
  // Keep pack SOPs/knowledge only for dedicated templates
  if (design.design_source === 'template' || design.design_source === 'template_fallback') {
    journey.answers.md_files = (bp.sop_documents || []).map((d) => ({
      filename: d.filename,
      content: d.contentText,
      agent: null,
    }));
    journey.answers.knowledge_tables = bp.knowledge_tables || [];
    journey.answers.sop_documents = bp.sop_documents || [];
  } else {
    journey.answers.md_files = journey.answers.md_files || [];
    journey.answers.knowledge_tables = [];
    journey.answers.sop_documents = [];
  }
  journey.selected_apply = defaultSelectedApply({
    departments: design.departments,
    agents: design.agents,
    workflows: design.workflows,
    channels: design.channels,
    md_files: journey.answers.md_files,
    knowledge_tables: journey.answers.knowledge_tables,
  });
  strategic.funnel_step = strategic.funnel_step || 'preview';
  strategic.design_source = design.design_source;
  writeStrategic(ownerUserId, ensureStrategyRow(ownerUserId), journey, strategic);

  console.info(
    '[company-setup] design owner=',
    ownerUserId,
    'source=',
    design.design_source,
    'type=',
    companyType,
    'blueprint=',
    bp?.id,
    'agents=',
    design.agents?.length
  );
  const state = getFunnelState(ownerUserId);
  return {
    ...state,
    design_source: design.design_source,
    design_model: design.model_used || null,
    design_error: design.design_error || null,
  };
}

/**
 * Persist a full org design onto journey answers + selected_apply.
 */
function applyDesignToJourney(ownerUserId, design, { keepSops = false } = {}) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const strategic = getStrategic(row);
  const companyType = resolveCompanyTypeId(strategic.company_type || journey.company_type || 'general_ops');
  const bp = resolveSelectedBlueprint(strategic, journey);

  journey.answers = journey.answers || {};
  journey.answers.departments = design.departments;
  journey.answers.agents = design.agents;
  journey.answers.workflows = design.workflows || [];
  journey.answers.channels = design.channels || [];
  journey.answers.design_source = design.design_source;
  journey.answers.design_model = design.model_used || null;
  if (design.design_error) journey.answers.design_error = design.design_error;
  else delete journey.answers.design_error;

  const preservePack =
    keepSops &&
    (design.design_source === 'template' ||
      design.design_source === 'template_fallback' ||
      design.design_source === 'llm_refine' ||
      design.design_source === 'llm_refine_unchanged');
  if (design.design_source === 'template' || design.design_source === 'template_fallback') {
    journey.answers.md_files = (bp.sop_documents || []).map((d) => ({
      filename: d.filename,
      content: d.contentText,
      agent: null,
    }));
    journey.answers.knowledge_tables = bp.knowledge_tables || [];
    journey.answers.sop_documents = bp.sop_documents || [];
  } else if (!preservePack) {
    // Pure LLM redesign of structure: clear pack SOPs only on first LLM design without prior
    if (!journey.answers.knowledge_tables?.length) {
      journey.answers.md_files = journey.answers.md_files || [];
      journey.answers.knowledge_tables = journey.answers.knowledge_tables || [];
      journey.answers.sop_documents = journey.answers.sop_documents || [];
    }
  }
  // When refining a template pack, keep knowledge/SOPs from blueprint if still empty
  if (
    (design.design_source === 'llm_refine' || design.design_source === 'llm_refine_unchanged') &&
    !(journey.answers.knowledge_tables || []).length &&
    (bp.knowledge_tables || []).length
  ) {
    journey.answers.knowledge_tables = bp.knowledge_tables || [];
    journey.answers.sop_documents = bp.sop_documents || [];
    journey.answers.md_files = (bp.sop_documents || []).map((d) => ({
      filename: d.filename,
      content: d.contentText,
      agent: null,
    }));
  }

  journey.selected_apply = defaultSelectedApply({
    departments: design.departments,
    agents: design.agents,
    workflows: design.workflows || [],
    channels: design.channels || [],
    md_files: journey.answers.md_files,
    knowledge_tables: journey.answers.knowledge_tables,
  });
  strategic.design_source = design.design_source;
  writeStrategic(ownerUserId, ensureStrategyRow(ownerUserId), journey, strategic);
}

/**
 * LLM chat refine on the org design step — updates departments/agents from CEO message.
 */
export async function designChatRefine(ownerUserId, { message } = {}) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const strategic = getStrategic(row);
  const companyType = resolveCompanyTypeId(strategic.company_type || journey.company_type || 'general_ops');
  const bp = resolveSelectedBlueprint(strategic, journey);
  const typeCards = listCompanyTypeCards();
  const card = typeCards.find(
    (c) =>
      c.id === strategic.company_type_card ||
      c.id === strategic.company_type ||
      c.id === companyType ||
      c.maps_to === companyType
  );
  const typeLabel = card?.label || bp.label || companyType;
  const answers = journey.answers || {};
  const history = Array.isArray(strategic.design_chat) ? strategic.design_chat : [];

  const design = await refineCompanyOrgWithLlm(ownerUserId, {
    company_name: strategic.company_name || '',
    company_type: companyType,
    company_type_label: typeLabel,
    mission: strategic.mission || '',
    org_dna: strategic.org_dna || '',
    org_dna_notes: strategic.org_dna_notes || '',
    describe_company: strategic.describe_company || answers.purpose || '',
    industry: strategic.industry || typeLabel || '',
    message,
    current: {
      departments: answers.departments || bp.departments,
      agents: answers.agents || bp.agents,
      workflows: answers.workflows || bp.workflows || [],
      channels: answers.channels || bp.channels || [],
    },
    history,
  });

  applyDesignToJourney(ownerUserId, design, { keepSops: true });

  const userLine = String(message || '').trim().slice(0, 2000);
  const nextChat = [
    ...history,
    { role: 'user', content: userLine, at: new Date().toISOString() },
    {
      role: 'assistant',
      content: design.reply || 'Updated.',
      at: new Date().toISOString(),
      design_source: design.design_source,
    },
  ].slice(-12);

  const row2 = ensureStrategyRow(ownerUserId);
  const journey2 = parseJson(row2.draft_journey_json, defaultJourney());
  const strategic2 = getStrategic(row2);
  strategic2.design_chat = nextChat;
  writeStrategic(ownerUserId, row2, journey2, strategic2);

  console.info(
    '[company-setup] design-chat owner=',
    ownerUserId,
    'source=',
    design.design_source,
    'agents=',
    design.agents?.length
  );

  const state = getFunnelState(ownerUserId);
  return {
    ...state,
    design_source: design.design_source,
    design_model: design.model_used || null,
    design_error: design.design_error || null,
    design_chat: nextChat,
    chat_reply: design.reply,
  };
}

/** Social / local keywords when OpenConnector has no Meta apps or CEO has no token yet. */
const LOCAL_CONNECTOR_ALIASES = [
  { keys: ['facebook', 'fb', 'meta'], id: 'browser_session', label: 'Facebook (via Browser Session)', path: '/browser-session' },
  { keys: ['instagram', 'ig'], id: 'browser_session', label: 'Instagram (via Browser Session)', path: '/browser-session' },
  { keys: ['linkedin'], id: 'browser_session', label: 'LinkedIn (via Browser Session)', path: '/browser-session' },
  { keys: ['youtube', 'yt'], id: 'browser_session', label: 'YouTube (via Browser Session)', path: '/browser-session' },
  { keys: ['tiktok'], id: 'browser_session', label: 'TikTok (via Browser Session)', path: '/browser-session' },
  { keys: ['twitter', 'x.com', ' x '], id: 'browser_session', label: 'X / Twitter (via Browser Session)', path: '/browser-session' },
  { keys: ['replicate', 'video', 'image gen'], id: 'replicate', label: 'Video / image (Replicate BYOK)', path: '/api-keys' },
];

function localConnectorMatches(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const s of SYSTEMS_CATALOG) {
    const hay = `${s.id} ${s.label}`.toLowerCase();
    if (hay.includes(q) || q.includes(String(s.id).toLowerCase())) {
      hits.push({
        id: s.id,
        oc_id: null,
        label: s.label,
        path: s.path || '/connectors',
        source: 'catalog',
        connected: false,
        note: s.note || null,
      });
    }
  }
  for (const row of LOCAL_CONNECTOR_ALIASES) {
    if (row.keys.some((k) => q.includes(k.trim()) || k.trim().includes(q))) {
      if (!hits.find((h) => h.id === row.id && h.label === row.label)) {
        hits.push({
          id: row.id,
          oc_id: null,
          label: row.label,
          path: row.path,
          source: 'platform_alias',
          connected: false,
          note: 'Social sites use Browser Session (not a native OpenConnector OAuth app in Phase C).',
        });
      }
    }
  }
  return hits;
}

export async function searchSetupConnectors(ownerUserId, query = '') {
  const q = String(query || '').trim();
  if (!q) {
    return { apps: [], query: '', source: 'empty' };
  }

  const merged = new Map();
  const add = (app) => {
    if (!app?.id && !app?.label) return;
    const key = String(app.id || app.label).toLowerCase();
    if (!merged.has(key)) merged.set(key, app);
  };

  for (const hit of localConnectorMatches(q)) add(hit);

  let ocSource = null;
  let ocError = null;
  try {
    // First-time CEOs often have no OC runtime token; provision with admin when possible.
    try {
      await provisionOpenConnectorForUser({ id: ownerUserId }, { ensureConnections: false });
    } catch (provErr) {
      console.warn('[company-setup] openconnector provision for search', provErr?.message || provErr);
    }
    const result = await searchConnectorApps(ownerUserId, q);
    ocSource = result.source || 'openconnector';
    for (const a of result.apps || []) {
      add({
        id: `oc:${a.id || a.app_id || a.name}`,
        oc_id: a.id || a.app_id || '',
        label: a.name || a.app_name || a.id || 'Connector',
        path: '/connectors',
        source: 'openconnector',
        connected: !!a.connected,
      });
    }
  } catch (e) {
    ocError = e?.message || String(e);
    console.warn('[company-setup] connector search OpenConnector failed', ocError);
  }

  const apps = [...merged.values()].slice(0, 30);
  // Prefer local/catalog hits over hard empty error for social keywords like facebook
  if (apps.length) {
    return {
      apps,
      query: q,
      source: ocSource || 'local',
      warning: ocError || undefined,
    };
  }
  return {
    apps: [],
    query: q,
    source: 'error',
    error:
      ocError ||
      'No matching systems. Try Browser Session for social sites, or open Connectors after linking OpenConnector.',
  };
}

export async function applyCompanySetup(ownerUserId, { confirm_override: confirmOverride, selected } = {}) {
  const row = ensureStrategyRow(ownerUserId);
  const strategic = getStrategic(row);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const companyType = resolveCompanyTypeId(strategic.company_type || 'general_ops');
  const blueprint = resolveSelectedBlueprint(strategic, journey);

  // Refresh strategy without wiping LLM/template design answers
  saveFunnelDraft(ownerUserId, {
    company_type: companyType,
    funnel_step: 'review',
    management_style: strategic.management_style || 'after_approval',
    keep_proposal: true,
  });

  const existingOrg = detectExistingOrg(ownerUserId);
  if (existingOrg.has_custom_agents) {
    journey.override_ack = true;
    persistJourney(ownerUserId, ensureStrategyRow(ownerUserId), {
      ...parseJson(ensureStrategyRow(ownerUserId).draft_journey_json, defaultJourney()),
      override_ack: true,
    });
  }

  const applied = await applyProposal(ownerUserId, {
    confirm_override: confirmOverride !== false,
    selected,
  });

  // Knowledge tables + SOPs + policy after agents
  const extras = await applyBlueprintExtras(ownerUserId, blueprint, strategic, selected);
  let memorySeed = { table: null, rows: 0 };
  try {
    memorySeed = await seedCompanyMemory(ownerUserId, { ...strategic, ...getStrategic(ensureStrategyRow(ownerUserId)) });
    extras.company_memory = memorySeed;
  } catch (e) {
    console.warn('[company-setup] company memory seed', e?.message || e);
  }

  const style = strategic.management_style || 'after_approval';
  try {
    const stylePolicy = policyTextForStyle(blueprint, style) || '';
    const dna = ORG_DNA_PRESETS.find((d) => d.id === strategic.org_dna);
    const parts = [];
    if (strategic.mission) {
      parts.push(`## Company mission\n${strategic.mission}\n\nEvery AI employee evaluates decisions against this mission.`);
    }
    if (dna) {
      parts.push(`## Organization DNA: ${dna.label}\n${dna.seed}`);
    }
    if (strategic.org_dna_notes) {
      parts.push(`## Operating notes\n${strategic.org_dna_notes}`);
    }
    // Prefer policy text published with this blueprint (Day 0 from working company)
    if (blueprint?.policy_text) {
      parts.push(blueprint.policy_text);
    } else if (blueprint?.policy_templates?.published_from_company) {
      parts.push(blueprint.policy_templates.published_from_company);
    } else {
      parts.push(stylePolicy);
    }
    let policy = parts.filter(Boolean).join('\n\n');
    // Always merge universal safety for every blueprint (no abusive/sexual/discriminatory content).
    policy = mergeUniversalSafetyPolicy(policy);
    upsertCeoGuardrails(ownerUserId, { policyText: policy, enabled: true, mergeSafety: false });
    console.info('[company-setup] policy seeded style=', style, 'dna=', strategic.org_dna, 'owner=', ownerUserId, 'chars=', policy.length);
    ensureUniversalSafetyGuardrails(ownerUserId);
  } catch (e) {
    console.warn('[company-setup] policy seed failed', e?.message || e);
  }

  // Mark gate completed
  const rowDone = ensureStrategyRow(ownerUserId);
  const journeyDone = parseJson(rowDone.draft_journey_json, defaultJourney());
  const strategicDone = getStrategic(rowDone);
  strategicDone.setup_gate = 'completed';
  strategicDone.funnel_step = 'done';
  // Phase D: after form, operating model is pending
  if (!strategicDone.operate_gate || strategicDone.operate_gate === 'blocked_need_company') {
    strategicDone.operate_gate = 'pending';
  }
  writeStrategic(ownerUserId, rowDone, journeyDone, strategicDone);

  const day1 = buildDay1Briefing(ownerUserId, strategicDone, applied, extras);

  console.info(
    '[company-setup] apply done owner=',
    ownerUserId,
    'type=',
    companyType,
    'depts=',
    applied?.applied?.departments_inserted,
    'agents=',
    applied?.applied?.agents_created?.length
  );

  return {
    ...getFunnelState(ownerUserId),
    applied: {
      ...(applied.applied || {}),
      ...extras,
    },
    day1,
  };
}

function selectedIncludes(selected, kind, name) {
  if (!selected || typeof selected !== 'object') return true;
  const key = `${kind}:${String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')}`;
  // also allow loose match
  for (const [k, v] of Object.entries(selected)) {
    if (k.startsWith(`${kind}:`) && k.includes(String(name || '').trim().toLowerCase().replace(/\s+/g, '-'))) {
      return v !== false;
    }
  }
  if (selected[key] === false) return false;
  return true;
}


async function seedCompanyMemory(ownerUserId, strategic) {
  const rows = [];
  if (strategic.mission) rows.push({ item: 'Mission', detail: strategic.mission });
  const dna = ORG_DNA_PRESETS.find((d) => d.id === strategic.org_dna);
  if (dna) rows.push({ item: 'Organization DNA', detail: `${dna.label}: ${dna.seed}` });
  if (strategic.org_dna_notes) rows.push({ item: 'DNA notes', detail: strategic.org_dna_notes });
  if (strategic.company_name) rows.push({ item: 'Company', detail: strategic.company_name });
  if (strategic.company_type_card || strategic.company_type) {
    rows.push({ item: 'Industry type', detail: String(strategic.company_type_card || strategic.company_type) });
  }
  rows.push({
    item: 'Build around CEO',
    detail: 'Human owner sets mission and DNA; AI executives and employees report outcomes via Home, Kanban, and notify_ceo.',
  });
  if (!rows.length) return { table: null, rows: 0 };
  try {
    let table = findTableByName(ownerUserId, 'company_memory');
    if (!table) {
      table = createTable(ownerUserId, {
        name: 'company_memory',
        description: 'Shared company memory ? mission, DNA, decisions, lessons (not per-employee-only memory).',
        columns: ['item', 'detail'],
      });
    }
    let n = 0;
    for (const seed of rows) {
      try {
        insertRow(ownerUserId, table.id, seed);
        n += 1;
      } catch (e) {
        console.warn('[company-setup] company_memory row', e?.message || e);
      }
    }
    return { table: table.name, rows: n };
  } catch (e) {
    console.warn('[company-setup] company_memory table', e?.message || e);
    return { table: null, rows: 0, error: e?.message || String(e) };
  }
}

async function applyBlueprintExtras(ownerUserId, blueprint, strategic, selected) {
  const tablesCreated = [];
  const rowsInserted = [];
  const docs = [];

  for (const tbl of blueprint.knowledge_tables || []) {
    if (!selectedIncludes(selected, 'knowledge_table', tbl.name) && selected && Object.keys(selected).length) {
      // if we never registered knowledge_table keys, always create for deep packs
    }
    try {
      let table = findTableByName(ownerUserId, tbl.name);
      if (!table) {
        table = createTable(ownerUserId, {
          name: tbl.name,
          description: tbl.description || '',
          columns: tbl.columns || [],
        });
        tablesCreated.push(table.name);
      }
      for (const seed of tbl.seed_rows || []) {
        try {
          insertRow(ownerUserId, table.id, seed);
          rowsInserted.push(tbl.name);
        } catch (e) {
          console.warn('[company-setup] seed row', tbl.name, e?.message || e);
        }
      }
    } catch (e) {
      console.warn('[company-setup] knowledge table', tbl.name, e?.message || e);
    }
  }

  for (const sop of blueprint.sop_documents || []) {
    try {
      const doc = await uploadDocument(ownerUserId, {
        title: sop.title,
        filename: sop.filename || 'sop.md',
        mimeType: 'text/markdown',
        contentText: sop.contentText || '',
        source: 'company_setup',
        tags: ['sop', 'company-setup', blueprint.id],
      });
      docs.push(doc?.id || sop.title);
    } catch (e) {
      console.warn('[company-setup] SOP doc skip (OpenSearch?)', sop.title, e?.message || e);
    }
  }

  return {
    knowledge_tables_created: tablesCreated,
    knowledge_rows_seeded: rowsInserted.length,
    sop_documents: docs,
    systems_selected: strategic.systems || [],
  };
}

function buildDay1Briefing(ownerUserId, strategic, applied, extras) {
  const db = getDb();
  let openKanban = 0;
  try {
    const r = db
      .prepare(
        `SELECT COUNT(*) AS n FROM kanban_tasks WHERE owner_user_id = ? AND status NOT IN ('done','completed','cancelled','archived')`
      )
      .get(ownerUserId);
    openKanban = Number(r?.n || 0);
  } catch {
    /* optional */
  }
  const agentsCreated = applied?.applied?.agents_created?.length || 0;
  const companyName = strategic.company_name || 'Your company';
  const nextSteps = [];
  for (const s of strategic.systems || []) {
    const hit = SYSTEMS_CATALOG.find((c) => c.id === s);
    if (hit) nextSteps.push(hit);
  }
  const bp = getBlueprint(strategic.company_type || 'general_ops');
  for (const rec of bp.systems_recommended || []) {
    if (!nextSteps.find((n) => n.id === rec.id)) nextSteps.push(rec);
  }

  const missionLine = strategic.mission ? ` Mission: ${strategic.mission}` : '';
  return {
    greeting_company: companyName,
    mission: strategic.mission || null,
    message: `${companyName} is staffed with ${agentsCreated} new AI employee(s). Open work on Kanban: ${openKanban}.${missionLine}`,
    next_steps: nextSteps.slice(0, 8),
    links: [
      { label: 'How we run (Operate)', path: '/company-operate' },
      { label: 'Home', path: '/' },
      { label: 'My Org', path: '/org' },
      { label: 'AI Employees', path: '/workspace' },
      { label: 'Knowledge', path: '/master-data' },
      { label: 'Policies', path: '/policies' },
    ],
    knowledge_tables: extras?.knowledge_tables_created || [],
  };
}


export function listIndustryBlueprintsForOwner(ownerUserId, industryId) {
  const row = ensureStrategyRow(ownerUserId);
  const strategic = getStrategic(row);
  const id = industryId || strategic.company_type_card || strategic.company_type || 'general_ops';
  return {
    industry_id: id,
    blueprints: listBlueprintsForIndustry(id),
    selected_blueprint_id: strategic.blueprint_id || getDefaultBlueprintIdForIndustry(resolveCompanyTypeId(id)),
  };
}
