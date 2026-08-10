/**
 * Default Master Data for every CEO:
 * - departments table (same presets as frontend DepartmentPicker)
 *
 * Platform Help + Flolah User Guide are seeded into OpenSearch under
 * PLATFORM_OWNER_ID via ensurePlatformHelpInOpenSearch (not per-CEO).
 *
 * Called on CEO register and on backend startup backfill.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  createTable,
  ensureTableColumns,
  findTableByName,
  insertRow,
  listRows,
} from './master-data.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

export const DEPARTMENTS_TABLE_NAME = 'departments';
export const DEPARTMENTS_COLUMN = 'name';
export const DEPARTMENTS_PURPOSE_COLUMN = 'purpose';
export const DEPARTMENTS_BUDGET_COLUMN = 'monthly_token_budget';
export const DEPARTMENTS_COLUMNS = [
  DEPARTMENTS_COLUMN,
  DEPARTMENTS_PURPOSE_COLUMN,
  DEPARTMENTS_BUDGET_COLUMN,
];

/** Seed departments: name + purpose. Monthly token budget is left for the CEO to set. */
export const DEPARTMENT_PRESET_ROWS = [
  { name: 'Executive', purpose: 'Company direction, priorities, approvals and escalations.' },
  { name: 'Research', purpose: 'Market, technical and competitive research; briefs and summaries.' },
  { name: 'Finance', purpose: 'Expenses, invoices, budgets and financial reporting.' },
  { name: 'Social', purpose: 'Social content creation, scheduling and community engagement.' },
  { name: 'Engineering', purpose: 'Build, automate and maintain workflows, integrations and code.' },
  { name: 'Operations', purpose: 'Day-to-day execution, coordination and process follow-through.' },
  { name: 'Job Pipeline', purpose: 'Sourcing, screening and tracking of job or candidate pipelines.' },
];

export const DEPARTMENT_PRESETS = DEPARTMENT_PRESET_ROWS.map((d) => d.name);

export const FLOLAH_GUIDE_TITLE = 'Flolah User Guide';
export const FLOLAH_GUIDE_FILENAME = 'README.md';

/** Title prefix for Platform Help RAG documents. */
export const PLATFORM_HELP_TITLE_PREFIX = 'Flolah Help —';
/** Legacy title prefix (pre-rename); removed on refresh. */
export const LEGACY_PLATFORM_HELP_TITLE_PREFIX = 'Flowlah Help —';
export const LEGACY_USER_GUIDE_TITLE = 'Flowlah User Guide';

/** Logical help files under knowledgebase/platform-help/ (filename → doc title). */
export const PLATFORM_HELP_DOCUMENTS = Object.freeze([
  { filename: 'README.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Index` },
  { filename: '01-getting-started.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Getting Started` },
  { filename: '02-navigation-and-chrome.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Navigation` },
  { filename: '03-dashboard-agents-chat.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Dashboard Agents Chat` },
  { filename: '04-kanban-standups-broadcast.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Kanban Standups Broadcast` },
  { filename: '05-master-data-rag.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Master Data RAG` },
  { filename: '06-workflows-building.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Workflows Building` },
  { filename: '07-workflow-nodes-reference.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Workflow Nodes Reference` },
  { filename: '08-mcp-integrations.md', title: `${PLATFORM_HELP_TITLE_PREFIX}MCP Integrations` },
  { filename: '09-a2a-agent-exchange.md', title: `${PLATFORM_HELP_TITLE_PREFIX}A2A AgentExchange` },
  { filename: '10-policies-guardrails.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Policies Guardrails` },
  { filename: '10-job-applicant-pipeline.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Job Applicant Pipeline` },
  { filename: '11-content-tools-scripts-profile.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Content Tools Scripts Profile` },
  { filename: '12-troubleshooting.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Troubleshooting` },
  { filename: '13-workflow-autonomous-certify.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Workflow Autonomous Certify` },
  { filename: '14-workflow-dynamic-values.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Workflow Dynamic Values` },
  { filename: '15-api-keys-vault.md', title: `${PLATFORM_HELP_TITLE_PREFIX}API Keys Vault` },
  { filename: '16-connectors-openconnector.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Connectors OpenConnector` },
  { filename: '17-desktop-windows-download.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Desktop Windows Download` },
  {
    filename: '18-agent-budgets-and-org-members.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Agent Budgets Org Members`,
  },
  {
    filename: '19-scheduled-jobs-and-crons.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Scheduled Jobs Crons Retention`,
  },
  {
    filename: '20-ibkr-monthly-trading.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}IBKR Monthly Trading`,
  },
  {
    filename: '21-external-tools-and-apis.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}External Tools And APIs`,
  },
  {
    filename: '22-browser-session-and-recipes.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Browser Session Recipes`,
  },
  {
    filename: '23-avatars-virtual-room.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Avatars Virtual Rooms`,
  },
  {
    filename: '24-agent-channels.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Agent Channels Slack WhatsApp`,
  },
  {
    filename: '25-speech-and-published-scenes.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Speech Published Scenes`,
  },
  {
    filename: '26-content-explorer.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Content Explorer`,
  },
  {
    filename: '27-onboarding-helper.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Onboarding Helper`,
  },
  {
    filename: '28-scheduled-goals.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Scheduled Goals Recurring Prompts`,
  },
  {
    filename: '29-company-setup.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Company Setup First Run Wizard`,
  },
  {
    filename: '30-content-creator-ops.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Content Creator Ops Publish Community`,
  },
  {
    filename: '31-mcp-connectors-oauth.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}MCP Connectors OAuth Facebook`,
  },
  {
    filename: '32-business-core-crm-erp.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Business Core CRM ERP Maker Checker`,
  },
  {
    filename: '33-ip-whitelists.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}IP Whitelists Package Firewall`,
  },
  {
    filename: '34-tokens-management.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Tokens Management External Packages`,
  },
  {
    filename: '35-update-company-details.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Update Company Details company_memory`,
  },
  {
    filename: '36-operational-effectiveness.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Operational Effectiveness OEI`,
  },
  {
    filename: '37-company-pnl.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Company PnL Design Roadmap`,
  },
  {
    filename: '38-maker-checker-coordination.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}CRM ERP Maker Checker Coordination`,
  },
  {
    filename: '39-erpnext-help-tier-a.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}ERPNext Help Tier A`,
  },
  {
    filename: '40-twenty-crm-help-tier-a.md',
    title: `${PLATFORM_HELP_TITLE_PREFIX}Twenty CRM Help Tier A`,
  },
]);

/** Resolve repo README.md (local: agent-os/README.md; Docker: /opt/agent-os/README.md). */
export function resolveDefaultReadmePath() {
  const candidates = [
    process.env.AGENT_OS_README_PATH,
    join(REPO_ROOT, 'README.md'),
    join(__dirname, '..', '..', 'README.md'), // backend/README.md fallback
    '/opt/agent-os/README.md',
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Resolve knowledgebase/platform-help directory. */
export function resolvePlatformHelpDir() {
  const candidates = [
    process.env.AGENT_OS_PLATFORM_HELP_DIR,
    join(REPO_ROOT, 'knowledgebase', 'platform-help'),
    '/opt/agent-os/knowledgebase/platform-help',
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function readDefaultReadmeContent() {
  const path = resolveDefaultReadmePath();
  if (!path) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Ensure the CEO has a departments master-data table with preset rows when empty/new.
 */
export function ensureDepartmentsMasterData(ownerUserId) {
  let table = findTableByName(ownerUserId, DEPARTMENTS_TABLE_NAME);
  let created = false;
  if (!table) {
    table = createTable(ownerUserId, {
      name: DEPARTMENTS_TABLE_NAME,
      columns: DEPARTMENTS_COLUMNS,
      description: 'Org departments (name, purpose, monthly token budget) for agent onboarding',
    });
    created = true;
  }
  let addedColumns = [];
  if (!created) {
    try {
      const res = ensureTableColumns(ownerUserId, table.id, DEPARTMENTS_COLUMNS);
      table = res.table || table;
      addedColumns = res.added || [];
      if (addedColumns.length) {
        console.log(
          '[master-data] departments table upgraded with columns',
          addedColumns.join(', '),
          'owner=',
          ownerUserId
        );
      }
    } catch (e) {
      console.warn('[master-data] departments column upgrade failed:', e?.message || e);
    }
  }
  const existingNames = new Set();
  if (!created && (table.row_count || 0) > 0) {
    const { rows } = listRows(ownerUserId, table.id, { limit: 500, offset: 0 });
    for (const r of rows || []) {
      const data = r.data || {};
      const n = String(data.name ?? data.Name ?? data.department ?? '').trim().toLowerCase();
      if (n) existingNames.add(n);
    }
  }
  let inserted = 0;
  if (created || (table.row_count || 0) === 0 || existingNames.size === 0) {
    for (const preset of DEPARTMENT_PRESET_ROWS) {
      if (existingNames.has(preset.name.toLowerCase())) continue;
      insertRow(ownerUserId, table.id, {
        [DEPARTMENTS_COLUMN]: preset.name,
        [DEPARTMENTS_PURPOSE_COLUMN]: preset.purpose,
        [DEPARTMENTS_BUDGET_COLUMN]: '',
      });
      inserted += 1;
      existingNames.add(preset.name.toLowerCase());
    }
    table = findTableByName(ownerUserId, DEPARTMENTS_TABLE_NAME) || table;
  }
  return { table, created, inserted, addedColumns };
}

/** Departments (name → purpose / monthly token budget) from the CEO's master-data table. */
export function listDepartmentsForOwner(ownerUserId) {
  const table = findTableByName(ownerUserId, DEPARTMENTS_TABLE_NAME);
  if (!table) return [];
  const out = [];
  let offset = 0;
  for (;;) {
    const page = listRows(ownerUserId, table.id, { limit: 50, offset });
    const rows = page.rows || [];
    for (const r of rows) {
      const data = r.data || {};
      const name = String(data.name ?? data.Name ?? data.department ?? '').trim();
      if (!name) continue;
      const budgetRaw = String(data[DEPARTMENTS_BUDGET_COLUMN] ?? '').replace(/[,\s]/g, '');
      const budget = budgetRaw && Number.isFinite(Number(budgetRaw)) ? Number(budgetRaw) : null;
      out.push({
        id: r.id,
        name,
        purpose: String(data[DEPARTMENTS_PURPOSE_COLUMN] ?? '').trim(),
        monthly_token_budget: budget,
      });
    }
    offset += rows.length;
    if (!rows.length || offset >= (page.total ?? offset)) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Upload/refresh repo README.md as the CEO's default RAG document.
 * Moved to platform OpenSearch (ensurePlatformHelpInOpenSearch); no longer per-CEO.
 */
export async function ensureDefaultReadmeDocument(_ownerUserId, _opts = {}) {
  return {
    document: null,
    created: false,
    updated: false,
    skipped: 'moved_to_platform_opensearch',
  };
}

/**
 * Upload/refresh Platform Help markdown set for Master Data RAG (Platform Help agent).
 * Moved to platform OpenSearch (ensurePlatformHelpInOpenSearch); no longer per-CEO.
 */
export async function ensurePlatformHelpDocuments(_ownerUserId, _opts = {}) {
  return {
    docs: [],
    created: 0,
    updated: 0,
    skipped: 'moved_to_platform_opensearch',
  };
}

/** Departments only for one CEO (platform help lives in OpenSearch under PLATFORM_OWNER_ID). */
export async function ensureCeoDefaultMasterData(ownerUserId, opts = {}) {
  const departments = ensureDepartmentsMasterData(ownerUserId);
  const guide = await ensureDefaultReadmeDocument(ownerUserId, opts);
  const platformHelp = await ensurePlatformHelpDocuments(ownerUserId, opts);
  return { departments, guide, platformHelp };
}

/**
 * Backfill all CEO users. Returns counts for logging (help counts always zero).
 */
export async function ensureCeoDefaultMasterDataForAllCeos(listCeoIds, opts = {}) {
  const ids = Array.isArray(listCeoIds) ? listCeoIds : [];
  let deptCreated = 0;
  let deptSeeded = 0;
  for (const id of ids) {
    try {
      const { departments } = await ensureCeoDefaultMasterData(id, opts);
      if (departments.created) deptCreated += 1;
      if (departments.inserted) deptSeeded += 1;
    } catch (e) {
      console.warn(`[ceo-default-master-data] ${id}:`, e.message);
    }
  }
  return {
    deptCreated,
    deptSeeded,
    guidesCreated: 0,
    guidesUpdated: 0,
    guidesSkipped: 0,
    helpCreated: 0,
    helpUpdated: 0,
    ceos: ids.length,
  };
}
