/**
 * Versioned, owner-scoped demo seed packs.
 *
 * The install ledger is the deletion boundary: cleanup only touches exact IDs
 * recorded for this pack and always includes owner_user_id in local deletes.
 * External CRM/ERP records are tagged and recorded by provider ID/name.
 */
import { createHash, randomBytes, randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { getDb } from '../db/schema.js';
import { getUserById, registerCeoUser } from './users.js';
import { hashPassword } from './auth/password.js';
import { ensureBuiltInRoles } from './org-permissions.js';
import { saveFunnelDraft } from './company-setup.js';
import { updateBusinessProviders, getBusinessProfile } from './company-business-profile.js';
import { createFullAgent } from './create-full-agent.js';
import { deleteAgentCascade } from './agent-delete.js';
import { setAgentBudget } from './agent-budgets.js';
import {
  createDefinition,
  deleteDefinition,
  getDefinition,
  publishDefinition,
  setPaused,
} from './agent-workflow-store.js';
import { createObjective, ensureCompanyObjectiveTables } from './company-objectives.js';
import { getActionFamilyPolicies, upsertActionFamilyPolicies } from './action-policy.js';
import {
  createTable,
  deleteTable,
  findTableByName,
  insertRow,
} from './master-data.js';

const here = dirname(fileURLToPath(import.meta.url));
const PACK_PATH = join(here, 'demo-seed-packs', 'northstar-industrial.v1.json');
const PACK = JSON.parse(readFileSync(PACK_PATH, 'utf8'));
const PACK_ID = PACK.pack_id;

function db() { return getDb(); }
function stableHash(value, length = 10) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}
function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}
function rowId(ownerUserId, kind, key) {
  return `demo-ns-${stableHash(ownerUserId, 8)}-${kind}-${String(key).toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`.slice(0, 118);
}
function externalId(value) {
  return value?.id || value?.name || value?.data?.id || value?.data?.name || null;
}
function tableExists(name) {
  return Boolean(db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

export function getNorthstarIndustrialDemoPack() {
  return structuredClone(PACK);
}

export function validateDemoSeedPack(pack = PACK) {
  const errors = [];
  if (pack?.schema_version !== 1) errors.push('schema_version must be 1');
  if (!pack?.pack_id || !pack?.marker) errors.push('pack_id and marker are required');
  const unique = (items, label) => {
    const keys = (items || []).map((item) => String(item.key || ''));
    for (const key of keys) if (!key) errors.push(`${label} contains an empty key`);
    if (new Set(keys).size !== keys.length) errors.push(`${label} keys must be unique`);
    return new Set(keys);
  };
  const agentKeys = unique(pack.agents, 'agents');
  const objectiveKeys = unique(pack.objectives, 'objectives');
  unique(pack.workflows, 'workflows');
  for (const objective of pack.objectives || []) {
    if (objective.parent && !objectiveKeys.has(objective.parent)) errors.push(`unknown objective parent ${objective.parent}`);
    unique(objective.key_results, `objective ${objective.key} key_results`);
  }
  for (const workflow of pack.workflows || []) {
    if (!objectiveKeys.has(workflow.objective)) errors.push(`workflow ${workflow.key} has unknown objective`);
    for (const agent of workflow.agents || []) if (!agentKeys.has(agent)) errors.push(`workflow ${workflow.key} has unknown agent ${agent}`);
    const objective = (pack.objectives || []).find((item) => item.key === workflow.objective);
    const krKeys = new Set((objective?.key_results || []).map((item) => item.key));
    for (const kr of workflow.key_results || []) if (!krKeys.has(kr)) errors.push(`workflow ${workflow.key} has unknown key result ${kr}`);
  }
  const modes = new Map((pack.policies || []).map((item) => [item.family, item.mode]));
  if ([...modes.values()].includes('approval_required')) errors.push('demo policy must not require human approval');
  if (modes.get('financial_destructive') !== 'prohibited') errors.push('financial_destructive must remain prohibited');
  const budget = (pack.agents || []).reduce((sum, item) => sum + Number(item.monthly_token_budget || 0), 0);
  if (errors.length) throw Object.assign(new Error(`Invalid demo seed pack: ${errors.join('; ')}`), { errors });
  return {
    ok: true,
    pack_id: pack.pack_id,
    pack_version: pack.pack_version,
    agents: pack.agents.length,
    people: pack.people.length,
    objectives: pack.objectives.length,
    workflows: pack.workflows.length,
    monthly_token_budget: budget,
  };
}

export function ensureDemoSeedPackSchema() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS demo_seed_pack_installs (
      owner_user_id TEXT NOT NULL,
      pack_id TEXT NOT NULL,
      pack_version TEXT NOT NULL,
      install_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'seeding',
      resources_json TEXT NOT NULL DEFAULT '{}',
      last_error TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY(owner_user_id, pack_id)
    );
    CREATE INDEX IF NOT EXISTS idx_demo_seed_pack_installs_pack
      ON demo_seed_pack_installs(pack_id, status);
  `);
}

export function getDemoSeedPackInstall(ownerUserId, packId = PACK_ID) {
  ensureDemoSeedPackSchema();
  const row = db().prepare('SELECT * FROM demo_seed_pack_installs WHERE owner_user_id=? AND pack_id=?').get(ownerUserId, packId);
  return row ? { ...row, resources: parseJson(row.resources_json, {}) } : null;
}

function saveInstall(ownerUserId, installId, status, resources, lastError = '') {
  ensureDemoSeedPackSchema();
  db().prepare(`INSERT INTO demo_seed_pack_installs
    (owner_user_id,pack_id,pack_version,install_id,status,resources_json,last_error,updated_at)
    VALUES(?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(owner_user_id,pack_id) DO UPDATE SET
      pack_version=excluded.pack_version,install_id=excluded.install_id,status=excluded.status,
      resources_json=excluded.resources_json,last_error=excluded.last_error,updated_at=datetime('now')`)
    .run(ownerUserId, PACK_ID, PACK.pack_version, installId, status, JSON.stringify(resources), String(lastError || '').slice(0, 2000));
}

export function planDemoSeedPack({ ownerUserId = '', includeExternal = true } = {}) {
  const validation = validateDemoSeedPack(PACK);
  const owner = String(ownerUserId || '').trim();
  return {
    mode: 'preview',
    ...validation,
    owner_user_id: owner || null,
    dedicated_owner_recommended: true,
    external_business_core: Boolean(includeExternal),
    resources: {
      company: 1,
      human_users: PACK.people.length,
      ai_agents: PACK.agents.length,
      objective_records: PACK.objectives.length,
      workflows: PACK.workflows.length,
      knowledge_tables: 7,
      crm_companies: PACK.crm.companies.length,
      crm_people: 20,
      crm_opportunities: PACK.crm.opportunities.length,
      erp_customers: PACK.erp.customers.length,
      erp_suppliers: PACK.erp.suppliers.length,
      erp_items: PACK.erp.items.length,
      erp_draft_invoices: 3,
    },
    cleanup_boundary: 'exact install ledger IDs + owner_user_id; CEO account and provider workspaces are retained',
    whatsapp: 'configuration is documented; QR/device pairing remains a user action',
  };
}

function workflowGraph(ownerUserId, workflow, agentIds) {
  const nodes = [{
    id: 'trigger', type: 'trigger', position: { x: 40, y: 120 },
    data: { label: 'Objective event or CEO request', triggerModes: ['manual', 'chat'], chatPhrase: `run ${workflow.key}`, scheduleCron: '', inputSchema: null },
  }];
  for (const [index, agentKey] of workflow.agents.entries()) {
    const id = agentIds[agentKey];
    nodes.push({
      id: `agent-${index + 1}`, type: 'agent', position: { x: 300 + index * 300, y: 120 },
      data: {
        label: `${PACK.agents.find((item) => item.key === agentKey)?.name || agentKey} · step ${index + 1}`,
        agentId: id, agent_id: id, agentName: PACK.agents.find((item) => item.key === agentKey)?.name || agentKey,
        prompt: `${PACK.marker}\nObjective-linked workflow: ${workflow.name}.\nWork only on synthetic demo records. Review the prior step and execute your role for: {{input}}. Record evidence for objective ${workflow.objective} and key results ${workflow.key_results.join(', ')}. Do not perform payments, destructive deletes, or security changes.`,
        inputBindings: [{ id: 'prompt', mode: 'dynamic', sourceNodeId: index ? `agent-${index}` : 'trigger', sourceOutputKey: index ? 'reply' : 'text' }],
      },
    });
  }
  const edges = workflow.agents.map((_, index) => ({ id: `e${index + 1}`, source: index ? `agent-${index}` : 'trigger', target: `agent-${index + 1}` }));
  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } };
}

function syntheticTables() {
  const accounts = PACK.crm.companies.map((name, index) => ({ account_id: `NS-ACC-${String(index + 1).padStart(3, '0')}`, name, segment: index < 4 ? 'Strategic' : 'Growth', status: 'active', pack_marker: PACK.marker }));
  const contacts = Array.from({ length: 20 }, (_, index) => ({ contact_id: `NS-CON-${String(index + 1).padStart(3, '0')}`, name: `Demo Contact ${index + 1}`, email: `contact${index + 1}@northstar-demo.example`, account: PACK.crm.companies[index % PACK.crm.companies.length], role: index % 3 === 0 ? 'Decision maker' : 'Operations stakeholder', pack_marker: PACK.marker }));
  const opportunities = PACK.crm.opportunities.map((amount, index) => ({ opportunity_id: `NS-OPP-${String(index + 1).padStart(3, '0')}`, name: `${PACK.crm.companies[index]} supply programme`, account: PACK.crm.companies[index], stage: ['QUALIFIED', 'MEETING', 'PROPOSAL'][index % 3], amount_sgd: String(amount), probability: String([0.45, 0.6, 0.75][index % 3]), pack_marker: PACK.marker }));
  const invoices = [
    { invoice_id: 'NS-INV-1001', customer: 'GreenGrid Hotels', total_sgd: '80000', paid_sgd: '50000', outstanding_sgd: '30000', status: 'partly_paid', pack_marker: PACK.marker },
    { invoice_id: 'NS-INV-1002', customer: 'Apex Marine Services', total_sgd: '36000', paid_sgd: '36000', outstanding_sgd: '0', status: 'paid', pack_marker: PACK.marker },
    { invoice_id: 'NS-INV-1003', customer: 'MetroBuild Engineering', total_sgd: '30000', paid_sgd: '5000', outstanding_sgd: '25000', status: 'overdue', pack_marker: PACK.marker },
  ];
  const metrics = [
    { period: 'FY2026', metric: 'Revenue', baseline: '1800000', current: '1520000', target: '2400000', unit: 'SGD', source: 'ERP seed ledger' },
    { period: 'FY2026', metric: 'Gross margin', baseline: '31', current: '33.2', target: '35', unit: '%', source: 'ERP seed ledger' },
    { period: 'Q3 2026', metric: 'Qualified pipeline', baseline: '720000', current: '1180000', target: '1600000', unit: 'SGD', source: 'CRM seed ledger' },
    { period: 'Q3 2026', metric: 'DSO', baseline: '44', current: '41', target: '38', unit: 'days', source: 'ERP seed ledger' },
    { period: 'Q3 2026', metric: 'OTIF', baseline: '93.5', current: '95.1', target: '96', unit: '%', source: 'ERP seed ledger' },
  ].map((row) => ({ ...row, pack_marker: PACK.marker }));
  return [
    ['demo_northstar_crm_accounts', 'Synthetic CRM account evidence for the OKR demo', accounts],
    ['demo_northstar_crm_contacts', 'Synthetic CRM contact evidence; reserved example addresses only', contacts],
    ['demo_northstar_crm_opportunities', 'Synthetic CRM pipeline evidence', opportunities],
    ['demo_northstar_erp_customers', 'Synthetic ERP customers', PACK.erp.customers.map((name, index) => ({ customer_id: `NS-CUS-${index + 1}`, name, currency: 'SGD', pack_marker: PACK.marker }))],
    ['demo_northstar_erp_suppliers', 'Synthetic ERP suppliers', PACK.erp.suppliers.map((name, index) => ({ supplier_id: `NS-SUP-${index + 1}`, name, currency: 'SGD', pack_marker: PACK.marker }))],
    ['demo_northstar_erp_invoices', 'Synthetic invoice and collection evidence', invoices],
    ['demo_northstar_okr_measurements', 'Seeded OKR measurement snapshots with provenance', metrics],
  ];
}

function seedPeople(ownerUserId, resources) {
  const roleIds = ensureBuiltInRoles(ownerUserId);
  for (const person of PACK.people) {
    const id = rowId(ownerUserId, 'person', person.key);
    const emailOwner = db().prepare('SELECT id,owner_user_id FROM platform_users WHERE lower(email)=lower(?)').get(person.email);
    if (emailOwner && emailOwner.id !== id) throw new Error(`Synthetic employee email belongs to another record: ${person.email}`);
    const existing = db().prepare("SELECT id,owner_user_id FROM platform_users WHERE id=? AND role='org_user'").get(id);
    if (existing && existing.owner_user_id !== ownerUserId) throw new Error(`Cross-owner employee collision: ${id}`);
    if (!existing) {
      db().prepare(`INSERT INTO platform_users
        (id,email,password_hash,name,role,enabled,owner_user_id,org_role_id,department,parent_id,specialty,purpose)
        VALUES(?,?,?,?,'org_user',0,?,?,?,?,?,?)`)
        .run(id, person.email, hashPassword(randomBytes(32).toString('hex')), person.name, ownerUserId, roleIds.member, person.department, ownerUserId, person.specialty, `${PACK.marker} ${person.purpose}`);
    }
    resources.people.push(id);
  }
}

async function seedAgents(ownerUserId, resources) {
  const agentIds = {};
  for (const spec of PACK.agents) {
    const id = rowId(ownerUserId, 'agent', spec.key);
    const existing = db().prepare('SELECT * FROM agents WHERE id=?').get(id);
    if (existing && existing.owner_user_id !== ownerUserId) throw new Error(`Cross-owner agent collision: ${id}`);
    if (!existing) {
      await createFullAgent({
        id, ownerUserId, name: spec.name, role: `${spec.role} ${PACK.marker}`,
        department: spec.department, monthly_token_budget: spec.monthly_token_budget,
        error_budget_pct: spec.error_budget_pct, source_kind: 'demo_seed_pack', source_publish_id: PACK_ID,
      });
    } else {
      setAgentBudget(ownerUserId, id, { monthly_token_budget: spec.monthly_token_budget, error_budget_pct: spec.error_budget_pct });
    }
    agentIds[spec.key] = id;
    resources.agents.push(id);
  }
  return agentIds;
}

function objectiveInput(ownerUserId, spec, agentIds) {
  const objectiveId = rowId(ownerUserId, 'objective', spec.key);
  const related = PACK.workflows.filter((workflow) => workflow.objective === spec.key);
  return {
    ...spec,
    id: objectiveId,
    parent_objective_id: spec.parent ? rowId(ownerUserId, 'objective', spec.parent) : null,
    currency: PACK.company.currency,
    authority: { internal_research: 'autonomous', reversible_internal_writes: 'autonomous', external_communications: 'autonomous', destructive_financial: 'prohibited', pack_marker: PACK.marker },
    constraints: ['Operate only on pack-tagged synthetic records.', 'Do not execute payments, destructive deletes, trades, or security changes.', 'Respect every configured agent token and error budget.'],
    key_results: (spec.key_results || []).map((kr, index) => ({ ...kr, id: rowId(ownerUserId, 'kr', `${spec.key}-${kr.key}`), owner_label: PACK.agents[index % PACK.agents.length].name })),
    initiatives: related.map((workflow, index) => ({
      id: rowId(ownerUserId, 'initiative', workflow.key),
      name: workflow.name, owner_label: PACK.agents.find((item) => item.key === workflow.agents[0])?.name || 'COO',
      cadence: workflow.cadence, budget_amount: 0,
      prompt: `${PACK.marker} Run workflow ${workflow.name} and attach evidence to ${spec.period_label}.`,
      authority: { workflow_id: rowId(ownerUserId, 'workflow', workflow.key), mode: 'autonomous' },
      goals: [{
        id: rowId(ownerUserId, 'goal', workflow.key),
        goal_type: workflow.cadence === 'manual' ? 'adhoc' : 'scheduled',
        title: workflow.name, prompt: `${PACK.marker} Execute ${workflow.name} against synthetic demo records and update objective evidence.`,
        owner_label: PACK.agents.find((item) => item.key === workflow.agents[0])?.name || 'COO',
        agent_id: agentIds[workflow.agents[0]], cadence: workflow.cadence === 'weekly' ? 'weekly' : 'weekdays',
        weekday: workflow.cadence === 'weekly' ? 1 : null, time_local: `0${8 + (index % 2)}:00`.slice(-5), timezone: 'Asia/Singapore',
        linked_key_result_ids: workflow.key_results.map((key) => rowId(ownerUserId, 'kr', `${spec.key}-${key}`)),
        authority: { workflow_id: rowId(ownerUserId, 'workflow', workflow.key), mode: 'autonomous' },
        approval_required: false, enabled: spec.status === 'active',
      }],
    })),
  };
}

function seedObjectives(ownerUserId, agentIds, resources) {
  ensureCompanyObjectiveTables();
  const ordered = [...PACK.objectives].sort((a, b) => Number(Boolean(a.parent)) - Number(Boolean(b.parent)));
  for (const spec of ordered) {
    const id = rowId(ownerUserId, 'objective', spec.key);
    const existing = db().prepare('SELECT id,owner_user_id FROM company_objectives WHERE id=?').get(id);
    if (existing && existing.owner_user_id !== ownerUserId) throw new Error(`Cross-owner objective collision: ${id}`);
    if (!existing) createObjective(ownerUserId, objectiveInput(ownerUserId, spec, agentIds), ownerUserId);
    resources.objectives.push(id);
  }
}

function seedWorkflows(ownerUserId, agentIds, resources) {
  for (const workflow of PACK.workflows) {
    const id = rowId(ownerUserId, 'workflow', workflow.key);
    const existing = getDefinition(id, ownerUserId);
    if (!existing) {
      createDefinition({
        id, ownerUserId, actor: { id: ownerUserId, name: 'Demo seed pack' },
        name: workflow.name,
        description: `${PACK.marker} Contributes to ${workflow.objective}: ${workflow.key_results.join(', ')}.`,
        graph: workflowGraph(ownerUserId, workflow, agentIds),
        trigger_modes: ['manual', 'chat'], chat_trigger_phrase: `run ${workflow.key}`,
        variables: { demo_pack_id: PACK_ID, objective_key: workflow.objective, key_result_keys: workflow.key_results },
      });
      publishDefinition(id, ownerUserId, { id: ownerUserId, name: 'Demo seed pack' });
      setPaused(id, ownerUserId, false, { id: ownerUserId, name: 'Demo seed pack' });
    }
    resources.workflows.push(id);
  }
}

function seedKnowledge(ownerUserId, resources) {
  for (const [name, description, rows] of syntheticTables()) {
    const existing = findTableByName(ownerUserId, name);
    if (existing) throw new Error(`Pack-owned table already exists without a clean install ledger: ${name}`);
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const table = createTable(ownerUserId, { name, description: `${PACK.marker} ${description}`, columns });
    for (const row of rows) insertRow(ownerUserId, table.id, row);
    resources.master_tables.push(table.id);
  }
}

async function provisionBusinessCore(ownerUserId, resources) {
  updateBusinessProviders(ownerUserId, { crm_provider: 'twenty', erp_provider: 'erpnext' });
  const errors = [];
  let crmFallbackReason = null;
  try {
    const crm = await import('./twenty-crm.js');
    await crm.ensureTwentyWorkspaceForCompany(ownerUserId, { displayName: PACK.company.name });
    const companies = [];
    for (const [index, name] of PACK.crm.companies.entries()) {
      const result = await crm.crmCreateCompany(ownerUserId, { name: `${name} ${PACK.marker}`, domainUrl: `ns-demo-${index + 1}.example`, employees: 50 + index * 10, idempotency_key: `${resources.install_id}:crm-company:${index}` });
      const company = result?.company || result?.data || {};
      const id = externalId(company);
      if (id) { companies.push(id); resources.external.crm.companies.push(id); }
    }
    for (let index = 0; index < 20; index += 1) {
      const result = await crm.crmCreatePerson(ownerUserId, { name: `Demo Contact ${index + 1}`, email: `contact${index + 1}@northstar-demo.example`, companyId: companies[index % companies.length], idempotency_key: `${resources.install_id}:crm-person:${index}` });
      const id = externalId(result?.person || result?.data || {});
      if (id) resources.external.crm.people.push(id);
    }
    for (const [index, amount] of PACK.crm.opportunities.entries()) {
      const result = await crm.crmCreateOpportunity(ownerUserId, { name: `${PACK.crm.companies[index]} supply programme ${PACK.marker}`, amount, currencyCode: 'SGD', stage: ['QUALIFIED', 'MEETING', 'PROPOSAL'][index % 3], companyId: companies[index], idempotency_key: `${resources.install_id}:crm-opportunity:${index}` });
      const id = externalId(result?.opportunity || result?.deal || {});
      if (id) resources.external.crm.opportunities.push(id);
    }
    resources.external.crm_backend = 'twenty';
  } catch (error) {
    crmFallbackReason = String(error?.message || error);
  }
  try {
    const erp = await import('./erpnext-erp.js');
    if (crmFallbackReason) {
      updateBusinessProviders(ownerUserId, { crm_provider: 'erpnext', erp_provider: 'erpnext' });
    }
    await erp.ensureErpnextCompanyForOwner(ownerUserId, { displayName: PACK.company.name });
    const customerNames = new Map();
    for (const name of PACK.erp.customers) {
      try {
        const result = await erp.erpCreateCustomer(ownerUserId, { customer_name: `${name} ${PACK.marker}`, customer_type: 'Company' });
        const id = externalId(result);
        if (id) {
          customerNames.set(name, id);
          resources.external.erp.push({ doctype: 'Customer', name: id });
        }
      } catch (error) { if (!/already exists/i.test(String(error?.message || error))) throw error; }
    }
    if (crmFallbackReason) {
      try {
        for (const name of PACK.crm.companies) {
          if (customerNames.has(name)) continue;
          const result = await erp.erpCreateCustomer(ownerUserId, {
            customer_name: `${name} ${PACK.marker}`,
            customer_type: 'Company',
          });
          const id = externalId(result);
          if (id) {
            customerNames.set(name, id);
            resources.external.erp.push({ doctype: 'Customer', name: id });
          }
        }
        for (let index = 0; index < 20; index += 1) {
          const companyName = PACK.crm.companies[index % PACK.crm.companies.length];
          const result = await erp.erpCreateContact(ownerUserId, {
            first_name: 'Demo',
            last_name: `Contact ${index + 1}`,
            email_id: `contact${index + 1}@northstar-demo.example`,
            links: [{ link_doctype: 'Customer', link_name: customerNames.get(companyName) }],
          });
          const id = externalId(result);
          if (id) resources.external.erp.push({ doctype: 'Contact', name: id });
        }
        for (const [index, amount] of PACK.crm.opportunities.entries()) {
          const companyName = PACK.crm.companies[index];
          const result = await erp.erpCreateOpportunity(ownerUserId, {
            opportunity_from: 'Customer',
            party_name: customerNames.get(companyName),
            status: 'Open',
            probability: [25, 50, 75][index % 3],
            opportunity_amount: amount,
            currency: PACK.company.currency,
            title: `${companyName} supply programme ${PACK.marker}`,
          });
          const id = externalId(result);
          if (id) resources.external.erp.push({ doctype: 'Opportunity', name: id });
        }
        resources.external.crm_backend = 'erpnext';
        resources.external_warnings = [
          ...(resources.external_warnings || []),
          `Twenty CRM was unavailable (${crmFallbackReason}); the live CRM mirror was seeded in ERPNext Sales CRM instead.`,
        ];
      } catch (fallbackError) {
        errors.push(`CRM: Twenty unavailable (${crmFallbackReason}); ERPNext CRM fallback failed: ${fallbackError?.message || fallbackError}`);
      }
    }
    // ERPNext sites created from minimal images may not contain the standard Supplier
    // Group fixture. Resolve a site-provided group, or create the conventional root
    // once as provider foundation. The root is deliberately not pack-owned and is
    // retained by cleanup, just like the Company and provider workspace.
    const supplierGroupResult = await erp.erpList(ownerUserId, 'Supplier Group', {
      limit: 100,
      fields: ['name', 'is_group'],
    });
    let supplierGroup = (supplierGroupResult?.data || []).find((row) => !Number(row?.is_group))?.name
      || supplierGroupResult?.data?.[0]?.name;
    if (!supplierGroup) {
      const createdGroup = await erp.erpCreate(ownerUserId, 'Supplier Group', {
        supplier_group_name: 'All Supplier Groups',
        is_group: 1,
      });
      supplierGroup = externalId(createdGroup);
    }
    if (!supplierGroup) throw new Error('Unable to resolve or initialize an ERPNext Supplier Group');
    for (const name of PACK.erp.suppliers) {
      try {
        const result = await erp.erpCreate(ownerUserId, 'Supplier', { supplier_name: `${name} ${PACK.marker}`, supplier_group: supplierGroup, supplier_type: 'Company' });
        const id = externalId(result); if (id) resources.external.erp.push({ doctype: 'Supplier', name: id });
      } catch (error) { if (!/already exists/i.test(String(error?.message || error))) throw error; }
    }
    for (const [code, name] of PACK.erp.items) {
      try {
        const result = await erp.erpCreateItem(ownerUserId, { item_code: code, item_name: `${name} ${PACK.marker}`, item_group: 'Products', stock_uom: 'Nos', is_stock_item: 0 });
        const id = externalId(result); if (id) resources.external.erp.push({ doctype: 'Item', name: id });
      } catch (error) { if (!/already exists/i.test(String(error?.message || error))) throw error; }
    }
    for (let index = 0; index < 3; index += 1) {
      const result = await erp.erpCreateSalesInvoice(ownerUserId, { customer: `${PACK.erp.customers[index]} ${PACK.marker}`, remarks: `${PACK.marker} synthetic draft only`, items: [{ item_code: PACK.erp.items[index][0], qty: index + 1, rate: PACK.erp.items[index][2] }] });
      const id = externalId(result); if (id) resources.external.erp.push({ doctype: 'Sales Invoice', name: id });
    }
  } catch (error) {
    errors.push(`ERP: ${error?.message || error}`);
  }
  return errors;
}

export async function seedDemoSeedPack({ ownerUserId, includeExternal = true, allowExistingOwner = false } = {}) {
  validateDemoSeedPack(PACK);
  const owner = String(ownerUserId || '').trim();
  const user = getUserById(owner);
  if (!user || user.role !== 'ceo') throw new Error('A valid CEO owner_user_id is required');
  if (!allowExistingOwner && !String(user.email || '').endsWith('@northstar-demo.example')) {
    throw new Error('Refusing to seed a non-demo CEO without allowExistingOwner=true');
  }
  const current = getDemoSeedPackInstall(owner);
  if (current?.status === 'installed') return { ok: true, idempotent: true, install: current, plan: planDemoSeedPack({ ownerUserId: owner, includeExternal }) };
  if (current) throw new Error(`Existing ${current.status} install must be cleaned before seeding`);

  const installId = `dsp-${randomUUID()}`;
  const resources = {
    install_id: installId, marker: PACK.marker, owner_created: false,
    people: [], agents: [], objectives: [], workflows: [], master_tables: [],
    external: { crm: { companies: [], people: [], opportunities: [] }, crm_backend: null, erp: [] },
    previous: {
      user_profile: db().prepare('SELECT business_name,country,region,industry,industry_other FROM platform_users WHERE id=?').get(owner) || null,
      strategic: db().prepare('SELECT * FROM ceo_org_strategy WHERE owner_user_id=?').get(owner) || null,
      business_profile: getBusinessProfile(owner),
      action_policies: getActionFamilyPolicies(owner).map(({ family, mode }) => ({ family, mode })),
    },
  };
  saveInstall(owner, installId, 'seeding', resources);
  try {
    saveFunnelDraft(owner, {
      company_name: PACK.company.name, company_type: 'general_ops', funnel_step: 'done', management_style: PACK.company.management_style,
      crm_provider: PACK.company.crm_provider, erp_provider: PACK.company.erp_provider, org_dna: 'data_driven', country: PACK.company.country,
      region: PACK.company.region, industry: PACK.company.industry, mission: PACK.company.mission,
      describe_company: `${PACK.marker} Singapore B2B industrial distribution demo.`, setup_gate: 'completed',
    });
    seedPeople(owner, resources); saveInstall(owner, installId, 'seeding', resources);
    const agentIds = await seedAgents(owner, resources); saveInstall(owner, installId, 'seeding', resources);
    seedWorkflows(owner, agentIds, resources); saveInstall(owner, installId, 'seeding', resources);
    seedObjectives(owner, agentIds, resources); saveInstall(owner, installId, 'seeding', resources);
    seedKnowledge(owner, resources); saveInstall(owner, installId, 'seeding', resources);
    upsertActionFamilyPolicies(owner, PACK.policies);
    resources.external_errors = includeExternal ? await provisionBusinessCore(owner, resources) : ['External Business Core provisioning skipped by option'];
    saveInstall(owner, installId, 'installed', resources);
    return { ok: true, idempotent: false, install: getDemoSeedPackInstall(owner), plan: planDemoSeedPack({ ownerUserId: owner, includeExternal }) };
  } catch (error) {
    saveInstall(owner, installId, 'failed', resources, error?.message || error);
    throw error;
  }
}

async function cleanupExternal(ownerUserId, resources, errors) {
  try {
    const crm = await import('./twenty-crm.js');
    const cleanCrm = async (kind, fn) => {
      const pending = [];
      for (const id of [...(resources.external?.crm?.[kind] || [])].reverse()) {
        try { await fn(ownerUserId, { id, confirm: true }); }
        catch (error) {
          if (!/not found|already deleted|404/i.test(String(error?.message || error))) {
            pending.unshift(id);
            errors.push(`CRM cleanup ${kind}/${id}: ${error?.message || error}`);
          }
        }
      }
      resources.external.crm[kind] = pending;
    };
    await cleanCrm('opportunities', crm.crmDeleteOpportunity);
    await cleanCrm('people', crm.crmDeletePerson);
    await cleanCrm('companies', crm.crmDeleteCompany);
  } catch (error) { errors.push(`CRM cleanup: ${error?.message || error}`); }
  try {
    const { erpDelete } = await import('./erpnext-erp.js');
    const pending = [];
    for (const resource of [...(resources.external?.erp || [])].reverse()) {
      try { await erpDelete(ownerUserId, resource.doctype, resource.name); }
      catch (error) {
        if (!/not found|does not exist|404/i.test(String(error?.message || error))) {
          pending.unshift(resource);
          errors.push(`ERP cleanup ${resource.doctype}/${resource.name}: ${error?.message || error}`);
        }
      }
    }
    resources.external.erp = pending;
  } catch (error) { errors.push(`ERP cleanup: ${error?.message || error}`); }
}

function cleanupObjectives(ownerUserId, objectiveIds) {
  if (!objectiveIds?.length || !tableExists('company_objectives')) return;
  const marks = objectiveIds.map(() => '?').join(',');
  const args = [ownerUserId, ...objectiveIds];
  if (tableExists('company_initiative_scheduled_goals') && tableExists('scheduled_goals')) {
    const schedules = db().prepare(`SELECT scheduled_goal_id FROM company_initiative_scheduled_goals WHERE owner_user_id=? AND objective_id IN (${marks})`).all(...args).map((row) => row.scheduled_goal_id);
    if (schedules.length) {
      const sm = schedules.map(() => '?').join(',');
      if (tableExists('scheduled_goal_runs')) db().prepare(`DELETE FROM scheduled_goal_runs WHERE owner_user_id=? AND goal_id IN (${sm})`).run(ownerUserId, ...schedules);
      db().prepare(`DELETE FROM scheduled_goals WHERE owner_user_id=? AND id IN (${sm})`).run(ownerUserId, ...schedules);
    }
  }
  const tables = [
    'company_objective_approvals', 'company_objective_measurements', 'company_revenue_evidence',
    'company_objective_goal_runs', 'company_initiative_scheduled_goals', 'company_initiative_goals',
    'company_initiatives', 'company_key_results', 'company_objective_versions',
  ];
  for (const table of tables) if (tableExists(table)) db().prepare(`DELETE FROM ${table} WHERE owner_user_id=? AND objective_id IN (${marks})`).run(...args);
  db().prepare(`DELETE FROM company_objectives WHERE owner_user_id=? AND id IN (${marks})`).run(...args);
}

function restorePrevious(ownerUserId, previous = {}) {
  const userProfile = previous.user_profile;
  if (userProfile) {
    db().prepare(`UPDATE platform_users SET business_name=?,country=?,region=?,industry=?,industry_other=?,updated_at=datetime('now') WHERE id=?`)
      .run(userProfile.business_name || '', userProfile.country || '', userProfile.region || '', userProfile.industry || '', userProfile.industry_other || '', ownerUserId);
  }
  if (tableExists('action_family_policies')) {
    db().prepare('DELETE FROM action_family_policies WHERE owner_user_id=?').run(ownerUserId);
    upsertActionFamilyPolicies(ownerUserId, previous.action_policies || []);
  }
  const strategic = previous.strategic;
  if (strategic && tableExists('ceo_org_strategy')) {
    const cols = db().prepare('PRAGMA table_info(ceo_org_strategy)').all().map((row) => row.name).filter((name) => Object.hasOwn(strategic, name));
    db().prepare('DELETE FROM ceo_org_strategy WHERE owner_user_id=?').run(ownerUserId);
    db().prepare(`INSERT INTO ceo_org_strategy (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((name) => strategic[name]));
  } else if (tableExists('ceo_org_strategy')) {
    db().prepare('DELETE FROM ceo_org_strategy WHERE owner_user_id=?').run(ownerUserId);
  }
  const profile = previous.business_profile;
  if (profile) updateBusinessProviders(ownerUserId, { crm_provider: profile.crm_provider || 'none', erp_provider: profile.erp_provider || 'none' });
}

export async function cleanupDemoSeedPack({ ownerUserId, includeExternal = true, confirmOwnerUserId } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner || String(confirmOwnerUserId || '').trim() !== owner) throw new Error('cleanup requires confirmOwnerUserId equal to ownerUserId');
  const install = getDemoSeedPackInstall(owner);
  if (!install) return { ok: true, idempotent: true, cleaned: {}, errors: [] };
  const resources = install.resources || {};
  if (resources.marker !== PACK.marker) throw new Error('Install marker mismatch; refusing cleanup');
  const errors = [];
  saveInstall(owner, install.install_id, 'cleaning', resources);
  if (includeExternal) await cleanupExternal(owner, resources, errors);
  for (const tableId of [...(resources.master_tables || [])].reverse()) {
    try { deleteTable(owner, tableId); } catch (error) { if (!/not found/i.test(String(error?.message || error))) errors.push(`table ${tableId}: ${error?.message || error}`); }
  }
  cleanupObjectives(owner, resources.objectives || []);
  for (const id of [...(resources.workflows || [])].reverse()) {
    try { deleteDefinition(id, owner, { id: owner, name: 'Demo seed cleanup' }); } catch (error) { errors.push(`workflow ${id}: ${error?.message || error}`); }
  }
  for (const id of [...(resources.agents || [])].reverse()) {
    try {
      const row = db().prepare('SELECT owner_user_id,source_publish_id FROM agents WHERE id=?').get(id);
      if (row && (row.owner_user_id !== owner || row.source_publish_id !== PACK_ID)) throw new Error('ownership/pack marker mismatch');
      if (tableExists('agent_ops_budgets')) db().prepare('DELETE FROM agent_ops_budgets WHERE owner_user_id=? AND member_key=?').run(owner, id);
      if (row) deleteAgentCascade(db(), id, { deletedBy: `demo-seed-cleanup:${owner}` });
    } catch (error) { errors.push(`agent ${id}: ${error?.message || error}`); }
  }
  for (const id of resources.people || []) {
    db().prepare("DELETE FROM platform_users WHERE id=? AND owner_user_id=? AND role='org_user' AND purpose LIKE ?").run(id, owner, `${PACK.marker}%`);
  }
  restorePrevious(owner, resources.previous || {});
  if (errors.length) {
    saveInstall(owner, install.install_id, 'cleanup_partial', resources, errors.join('; '));
  } else {
    db().prepare('DELETE FROM demo_seed_pack_installs WHERE owner_user_id=? AND pack_id=?').run(owner, PACK_ID);
  }
  return {
    ok: errors.length === 0,
    cleaned: { people: resources.people?.length || 0, agents: resources.agents?.length || 0, objectives: resources.objectives?.length || 0, workflows: resources.workflows?.length || 0, master_tables: resources.master_tables?.length || 0 },
    retained: ['CEO account', 'Twenty workspace', 'ERPNext company', 'provider credentials and .env files'],
    errors,
  };
}

export async function reseedDemoSeedPack(options = {}) {
  await cleanupDemoSeedPack({ ...options, confirmOwnerUserId: options.ownerUserId });
  return seedDemoSeedPack(options);
}

export async function ensureDemoCeo({ email = 'maya.tan@northstar-demo.example', name = 'Maya Tan' } = {}) {
  const normalized = String(email || '').trim().toLowerCase();
  let row = db().prepare('SELECT * FROM platform_users WHERE lower(email)=?').get(normalized);
  if (row) {
    if (row.role !== 'ceo') throw new Error('Demo owner email exists but is not a CEO');
    return { user: getUserById(row.id), created: false };
  }
  const password = `N0rthstar!${randomBytes(20).toString('base64url')}aA1`;
  const user = await registerCeoUser({
    email: normalized, password, name, country: 'SG', region: 'SG-01', industry: 'others',
    industry_other: PACK.company.industry, business_name: PACK.company.name,
    llm_provider: 'platform_decided', require_terms_accept: false,
  });
  return { user, created: true, credential_note: 'A random password was generated and intentionally not persisted; use Admin View as user or password reset.' };
}
