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
  resolveCompanyIndustryIdentity,
  policyTextForStyle,
  hasDedicatedCompanyTemplate,
} from './company-blueprints/index.js';
import { createTable, findTableByName, insertRow, uploadDocument, clearTableRows } from './master-data.js';
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
  if (body.crm_provider != null) {
    const c = String(body.crm_provider).trim().toLowerCase() || 'none';
    // twenty | erpnext = platform CRM (embed + prefab; ERPNext uses Sales/CRM modules)
    if (['none', 'twenty', 'erpnext', 'hubspot', 'zoho'].includes(c)) strategic.crm_provider = c;
  }
  if (body.erp_provider != null) {
    const e = String(body.erp_provider).trim().toLowerCase() || 'none';
    if (['none', 'erpnext', 'xero'].includes(e)) strategic.erp_provider = e;
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
  const identity = resolveCompanyIndustryIdentity(strategic, {
    memoryIndustry: strategic.industry || null,
  });
  const companyType = identity.company_type;
  const bp = resolveSelectedBlueprint(strategic, journey);
  const typeLabel = identity.company_type_label || bp.label || companyType;

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
  const identity = resolveCompanyIndustryIdentity(strategic, {
    memoryIndustry: strategic.industry || null,
  });
  const companyType = identity.company_type;
  const bp = resolveSelectedBlueprint(strategic, journey);
  const typeLabel = identity.company_type_label || bp.label || companyType;
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

  // Video content studio: ensure golden templates + W-Reasoning (idempotent; does not revoke other packs)
  let videoContent = null;
  try {
    const bpId = String(blueprint?.id || blueprint?.industry || '').toLowerCase();
    if (bpId === 'video_content' || (blueprint?.aliases || []).includes('video_studio')) {
      const { installVideoContentForOwner } = await import('./prefab-video-agents.js');
      videoContent = await installVideoContentForOwner(ownerUserId, { includeStubWorkflows: false });
      extras.video_content = {
        agents: videoContent?.agents || [],
        workflows: videoContent?.workflows?.results || [],
      };
      console.info(
        '[company-setup] video_content installed owner=%s agents=%s',
        ownerUserId,
        (videoContent?.agents || []).join(',')
      );
    }
  } catch (e) {
    console.warn('[company-setup] video_content install (non-fatal):', e?.message || e);
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

  // Optional CRM/ERP (Business Core) — never required; does not fail company setup.
  // Prefab AI employees join the org only for platform Twenty / ERPNext.
  let businessCore = null;
  try {
    const crmProvider = String(strategicDone.crm_provider || 'none').trim().toLowerCase() || 'none';
    const erpProvider = String(strategicDone.erp_provider || 'none').trim().toLowerCase() || 'none';
    const { updateBusinessProviders, getBusinessProfile } = await import('./company-business-profile.js');
    updateBusinessProviders(ownerUserId, {
      crm_provider: crmProvider,
      erp_provider: erpProvider,
    });
    const user = await import('./users.js').then((m) => m.getUserById(ownerUserId));
    const displayName = strategicDone.company_name || user?.business_name || user?.name;
    businessCore = { profile: getBusinessProfile(ownerUserId) };

    if (crmProvider === 'twenty') {
      const { ensureTwentyWorkspaceForCompany } = await import('./twenty-crm.js');
      const { ensurePrefabCrmAgents } = await import('./prefab-crm-agents.js');
      const twenty = await ensureTwentyWorkspaceForCompany(ownerUserId, { displayName });
      const prefab = await ensurePrefabCrmAgents(ownerUserId);
      businessCore = { ...businessCore, profile: getBusinessProfile(ownerUserId), twenty, prefab };
      console.info(
        '[company-setup] business core CRM twenty owner=%s workspace=%s prefab=%s',
        ownerUserId,
        twenty?.workspace_id,
        (prefab?.agents || []).join(',')
      );
    } else if (crmProvider === 'erpnext') {
      const { ensureErpnextCompanyForOwner } = await import('./erpnext-erp.js');
      const { ensurePrefabCrmAgents } = await import('./prefab-crm-agents.js');
      const erpnextCrm = await ensureErpnextCompanyForOwner(ownerUserId, { displayName });
      const prefab = await ensurePrefabCrmAgents(ownerUserId);
      businessCore = {
        ...businessCore,
        profile: getBusinessProfile(ownerUserId),
        erpnext: erpnextCrm,
        prefab,
      };
      console.info(
        '[company-setup] business core CRM erpnext owner=%s company=%s prefab=%s',
        ownerUserId,
        erpnextCrm?.company_id,
        (prefab?.agents || []).join(',')
      );
    } else {
      const { revokePrefabCrmAgentsFromOrg } = await import('./prefab-crm-agents.js');
      const prefab = revokePrefabCrmAgentsFromOrg(ownerUserId);
      businessCore = { ...businessCore, profile: getBusinessProfile(ownerUserId), prefab };
    }

    if (erpProvider === 'erpnext') {
      const { ensureErpnextCompanyForOwner } = await import('./erpnext-erp.js');
      const { ensurePrefabErpAgents } = await import('./prefab-erp-agents.js');
      const erpnext = await ensureErpnextCompanyForOwner(ownerUserId, { displayName });
      const prefab_erp = await ensurePrefabErpAgents(ownerUserId);
      businessCore = {
        ...businessCore,
        profile: getBusinessProfile(ownerUserId),
        erpnext,
        prefab_erp,
      };
      console.info(
        '[company-setup] business core ERP erpnext owner=%s company=%s prefab=%s',
        ownerUserId,
        erpnext?.company_id,
        (prefab_erp?.agents || []).join(',')
      );
    } else {
      const { revokePrefabErpAgentsFromOrg } = await import('./prefab-erp-agents.js');
      const prefab_erp = revokePrefabErpAgentsFromOrg(ownerUserId);
      businessCore = {
        ...businessCore,
        profile: getBusinessProfile(ownerUserId),
        prefab_erp,
      };
    }
  } catch (e) {
    console.warn('[company-setup] business core provision (non-fatal):', e?.message || e);
  }

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
      business_core: businessCore,
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

/** Phrase required on POST reseed when any target knowledge table already exists. */
export const COMPANY_KNOWLEDGE_OVERWRITE_CONFIRM = 'OVERWRITE_COMPANY_KNOWLEDGE';

/**
 * Resolve which industry blueprint drives knowledge tables for this CEO.
 * Legacy accounts (pre–company-setup wizard) often have status=applied but no company_type —
 * defaults to general_ops unless industry_id / blueprint_id is passed.
 */
function resolveKnowledgeBlueprint(ownerUserId, { industry_id, blueprint_id } = {}) {
  const row = ensureStrategyRow(ownerUserId);
  const strategic = getStrategic(row);
  const industry = resolveCompanyTypeId(
    industry_id ||
      strategic.company_type_card ||
      strategic.company_type ||
      strategic.blueprint_id ||
      'general_ops'
  );
  const bpId =
    (blueprint_id && String(blueprint_id).trim()) ||
    strategic.blueprint_id ||
    getDefaultBlueprintIdForIndustry(industry);
  const blueprint = getBlueprint(bpId) || getBlueprint(getDefaultBlueprintIdForIndustry(industry));
  return { row, strategic, industry, blueprint };
}

function expectedKnowledgeTables(blueprint) {
  const fromPack = Array.isArray(blueprint?.knowledge_tables) ? blueprint.knowledge_tables : [];
  const hasMemory = fromPack.some((t) => String(t?.name || '').toLowerCase() === 'company_memory');
  const list = fromPack.map((t) => ({
    name: t.name,
    description: t.description || '',
    columns: t.columns || [],
    seed_row_count: Array.isArray(t.seed_rows) ? t.seed_rows.length : 0,
    source: 'blueprint',
  }));
  if (!hasMemory) {
    list.unshift({
      name: 'company_memory',
      description: 'Shared company memory — mission, DNA, decisions, lessons.',
      columns: ['item', 'detail'],
      seed_row_count: null,
      source: 'company_memory',
    });
  }
  return list;
}

/**
 * Preview company-setup knowledge tables for Knowledge UI reseed control.
 * Owner-scoped only.
 */
export function previewCompanySetupKnowledge(ownerUserId, opts = {}) {
  const { row, strategic, industry, blueprint } = resolveKnowledgeBlueprint(ownerUserId, opts);
  const expected = expectedKnowledgeTables(blueprint);
  const tables = expected.map((exp) => {
    const existing = findTableByName(ownerUserId, exp.name);
    return {
      name: exp.name,
      description: exp.description,
      columns: exp.columns,
      seed_row_count: exp.seed_row_count,
      source: exp.source,
      exists: !!existing,
      table_id: existing?.id || null,
      row_count: existing?.row_count ?? 0,
    };
  });
  const existingCount = tables.filter((t) => t.exists).length;
  const sopCount = Array.isArray(blueprint?.sop_documents) ? blueprint.sop_documents.length : 0;
  return {
    owner_user_id: ownerUserId,
    setup_status: row?.status || null,
    setup_gate: getStrategic(row).setup_gate || null,
    industry_id: industry,
    blueprint_id: blueprint?.id || null,
    blueprint_name: blueprint?.name || blueprint?.label || null,
    blueprint_depth: blueprint?.depth || null,
    company_name: strategic.company_name || null,
    company_type: strategic.company_type_card || strategic.company_type || null,
    pack_knowledge_table_count: (blueprint?.knowledge_tables || []).length,
    sop_document_count: sopCount,
    tables,
    existing_count: existingCount,
    missing_count: tables.length - existingCount,
    requires_overwrite_confirm: existingCount > 0,
    overwrite_confirm_phrase: COMPANY_KNOWLEDGE_OVERWRITE_CONFIRM,
    company_types: listCompanyTypeCards(),
    note:
      existingCount === 0
        ? 'No pack knowledge tables yet (common for accounts created before Company Setup). Reseed will create them.'
        : 'Some knowledge tables already exist. Confirm overwrite to clear their rows and re-seed metadata.',
  };
}

/**
 * Seed (or overwrite) company-setup knowledge tables for a CEO.
 * Default: create missing tables only (safe for legacy CEOs).
 * To clear existing rows and re-seed: confirm=OVERWRITE_COMPANY_KNOWLEDGE.
 * @param {object} opts
 * @param {string} [opts.confirm] - OVERWRITE_COMPANY_KNOWLEDGE when overwriting existing tables
 * @param {boolean} [opts.confirm_overwrite]
 * @param {boolean} [opts.seed_sops=true]
 * @param {string} [opts.industry_id]
 * @param {string} [opts.blueprint_id]
 */
export async function reseedCompanySetupKnowledge(ownerUserId, opts = {}) {
  const preview = previewCompanySetupKnowledge(ownerUserId, opts);
  const wantsOverwrite =
    String(opts.confirm || '').trim() === COMPANY_KNOWLEDGE_OVERWRITE_CONFIRM ||
    opts.confirm_overwrite === true;
  if (wantsOverwrite && !preview.requires_overwrite_confirm) {
    // no existing tables — treat as normal seed
  }
  if (wantsOverwrite === false && preview.missing_count === 0 && preview.existing_count > 0) {
    // Nothing to create and user did not ask to overwrite
    return {
      ok: true,
      owner_user_id: ownerUserId,
      blueprint_id: preview.blueprint_id,
      industry_id: preview.industry_id,
      overwrite: false,
      tables_created: [],
      tables_overwritten: [],
      tables_seeded: (preview.tables || []).map((t) => ({
        name: t.name,
        rows: 0,
        skipped: 'exists_no_overwrite',
      })),
      sop_documents: [],
      errors: [],
      message:
        'All pack knowledge tables already exist. Confirm overwrite to clear rows and re-seed, or pick another industry pack.',
      preview,
    };
  }

  const { strategic, blueprint } = resolveKnowledgeBlueprint(ownerUserId, opts);
  const overwrite = wantsOverwrite && preview.requires_overwrite_confirm;
  const created = [];
  const overwritten = [];
  const seeded = [];
  const errors = [];

  // blueprint pack tables
  for (const tbl of blueprint.knowledge_tables || []) {
    try {
      let table = findTableByName(ownerUserId, tbl.name);
      if (table && !overwrite) {
        seeded.push({ name: tbl.name, rows: 0, skipped: 'exists_no_overwrite' });
        continue;
      }
      if (table && overwrite) {
        const cleared = clearTableRows(ownerUserId, table.id);
        overwritten.push({ name: tbl.name, deleted_rows: cleared.deleted_rows });
      } else if (!table) {
        table = createTable(ownerUserId, {
          name: tbl.name,
          description: tbl.description || '',
          columns: tbl.columns || [],
        });
        created.push(table.name);
      }
      let rows = 0;
      for (const seed of tbl.seed_rows || []) {
        try {
          insertRow(ownerUserId, table.id, seed);
          rows += 1;
        } catch (e) {
          errors.push({ table: tbl.name, error: e?.message || String(e) });
        }
      }
      seeded.push({ name: tbl.name, rows });
    } catch (e) {
      errors.push({ table: tbl.name, error: e?.message || String(e) });
    }
  }

  // company_memory always
  try {
    let mem = findTableByName(ownerUserId, 'company_memory');
    if (mem && !overwrite) {
      seeded.push({ name: 'company_memory', rows: 0, skipped: 'exists_no_overwrite' });
    } else {
      if (mem && overwrite) {
        const cleared = clearTableRows(ownerUserId, mem.id);
        overwritten.push({ name: 'company_memory', deleted_rows: cleared.deleted_rows });
      }
      const hadBefore = !!mem;
      const memorySeed = await seedCompanyMemory(ownerUserId, strategic);
      if (memorySeed?.table && !hadBefore) created.push('company_memory');
      seeded.push({ name: 'company_memory', rows: memorySeed?.rows || 0 });
    }
  } catch (e) {
    errors.push({ table: 'company_memory', error: e?.message || String(e) });
  }

  const docs = [];
  const seedSops = opts.seed_sops !== false;
  if (seedSops) {
    for (const sop of blueprint.sop_documents || []) {
      try {
        const doc = await uploadDocument(ownerUserId, {
          title: sop.title,
          filename: sop.filename || 'sop.md',
          mimeType: 'text/markdown',
          contentText: sop.contentText || '',
          source: 'company_setup_reseed',
          tags: ['sop', 'company-setup', blueprint.id, 'reseed'],
        });
        docs.push(doc?.id || sop.title);
      } catch (e) {
        errors.push({ sop: sop.title, error: e?.message || String(e) });
      }
    }
  }

  console.info(
    '[company-setup] knowledge reseed owner=%s blueprint=%s created=%s overwritten=%s sops=%s errors=%s',
    ownerUserId,
    blueprint?.id,
    created.length,
    overwritten.length,
    docs.length,
    errors.length
  );

  return {
    ok: errors.length === 0,
    owner_user_id: ownerUserId,
    blueprint_id: blueprint?.id,
    industry_id: preview.industry_id,
    overwrite,
    tables_created: created,
    tables_overwritten: overwritten,
    tables_seeded: seeded,
    sop_documents: docs,
    errors,
    preview: previewCompanySetupKnowledge(ownerUserId, opts),
  };
}
