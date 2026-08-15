/**
 * Publish Balaji Ranganathan (ceo-bala / BalajiDemoCompany) as a demo industry blueprint,
 * write system pack JSON, and export zip (no secrets).
 *
 * Usage (backend container):
 *   node scripts/publish-balaji-demo-blueprint.js
 * Env:
 *   SOURCE_OWNER_USER_ID=ceo-bala
 *   BLUEPRINT_ID=demo_balaji_ranganathan
 *   OUT_DIR=/tmp/balaji-demo-bp
 *   SET_DEFAULT=0
 *   DRY_RUN=1
 *   FROM_PACK_FILE=1  — publish existing packs/<id>.json (no live CEO snapshot)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { initDb } from '../src/db/schema.js';
import { snapshotOwnerAsBlueprintPayloadAsync, sanitizeBlueprintSecrets } from '../src/services/company-blueprint-publish.js';
import {
  publishBlueprintFromPayload,
  buildCompanyBlueprintExportZip,
  invalidateBlueprintCache,
  findResidualLiveSecrets,
  cloneAndSanitizeBlueprint,
} from '../src/services/company-blueprints/index.js';

const OWNER = process.env.SOURCE_OWNER_USER_ID || 'ceo-bala';
const BLUEPRINT_ID = process.env.BLUEPRINT_ID || 'demo_balaji_ranganathan';
const INDUSTRY = process.env.INDUSTRY_ID || 'demo_balaji_ranganathan';
const OUT_DIR = process.env.OUT_DIR || '/tmp/balaji-demo-bp';
const SET_DEFAULT = process.env.SET_DEFAULT === '1';
const DRY = process.env.DRY_RUN === '1';
const FROM_PACK_FILE = process.env.FROM_PACK_FILE === '1';
// Optional: also write pack/zip into source tree (e.g. .../company-blueprints)
const SOURCE_ROOT =
  process.env.SOURCE_BLUEPRINT_ROOT ||
  join(process.cwd(), 'src/services/company-blueprints');

/** Keep product-demo workflows only (drop smoke, certify, chatops, one-off ids). */
function keepWorkflow(w) {
  const key = String(w.template_key || w.id || w.name || '').toLowerCase();
  if (
    /test|smoke|sse-|chatops|certify-ibkr|custom-script|hello-world|brain-mcp|agent-exchange|live-org|wf-agent-exchange|schema-name|testtool|mrg[a-z0-9]+-|^\d/.test(
      key
    )
  ) {
    // keep deliberately named demos even if ids have suffixes
    if (
      /^(erp-mc|crm-mc|ibkr-|monthly-trading|template-job|sample-job|summarize-inbound|avatar-|masterdata-rag|hacker-news|async-a2a-callback|demoemail|brave-byok)/.test(
        key
      ) ||
      /ibkr-maker-checker|ibkr-position-poller|monthly-trading-w|template-job-applicant|sample-job-discovery|content-publish|crm-mc|erp-mc|masterdata-rag-brain-demo|hacker-news-connector-demo|wf-async-a2a-callback-demo|demoemail|wf-balaji-brave/.test(
        key
      )
    ) {
      return true;
    }
    return false;
  }
  return (
    /^(erp-mc|crm-mc)/.test(key) ||
    /ibkr|monthly-trading|job-applicant|job-discovery|inbound-media|avatar-|masterdata-rag|hacker-news|a2a-callback-demo|brave-byok|demoemail/.test(
      key
    )
  );
}

function portableAgent(a) {
  return {
    name: a.name,
    role: a.role || a.name,
    department: a.department || 'Operations',
    tools: Array.isArray(a.tools) ? a.tools : [],
  };
}

initDb();
invalidateBlueprintCache();

const scrubSnap = { cleared: 0, scrubbed: 0 };
let payload;
let company;

if (FROM_PACK_FILE) {
  const packFile = join(SOURCE_ROOT, 'packs', `${BLUEPRINT_ID}.json`);
  if (!existsSync(packFile)) {
    console.error('FROM_PACK_FILE=1 but missing', packFile);
    process.exit(2);
  }
  payload = JSON.parse(readFileSync(packFile, 'utf8'));
  company = payload.source_company_name || 'BalajiDemoCompany';
  sanitizeBlueprintSecrets(payload, scrubSnap);
  console.info('[publish-balaji-demo] FROM_PACK_FILE=%s', packFile);
} else {
  const snap = await snapshotOwnerAsBlueprintPayloadAsync(OWNER);
  company = snap.company_name || 'BalajiDemoCompany';
  payload = { ...(snap.payload || {}) };
  sanitizeBlueprintSecrets(payload, scrubSnap);
  payload.workflow_templates = (payload.workflow_templates || []).filter(keepWorkflow);
  payload.agents = (payload.agents || []).map(portableAgent);
}
// Prefer label that shows as demo
payload.id = BLUEPRINT_ID;
payload.industry = INDUSTRY;
payload.name = process.env.BLUEPRINT_NAME || `Flolah demo — ${company} (Balaji Ranganathan)`;
payload.label = payload.name;
payload.description =
  process.env.BLUEPRINT_DESCRIPTION ||
  'Demo company snapshot from Balaji Ranganathan: CRM/ERP Maker–Checker, trading/IBKR workflows, specialty agents (MarketWatcher, Vedic Astrology, Weather), goals, and connector stubs (no secrets). Use for clean redeploy demos and Company setup deep pack.';
payload.depth = 'deep';
payload.source = 'system';
payload.is_default = false;
payload.aliases = ['balaji_demo', 'balaji_ranganathan_demo', 'flolah_demo_company', 'demo_company'];
payload.source_owner_user_id = OWNER;
payload.source_company_name = company;
payload.demo = true;
payload.demo_owner_name = 'Balaji Ranganathan';

// Final clone scrub after filtering (defense in depth)
const { value: cleanPayload, stats: scrubStats } = cloneAndSanitizeBlueprint(payload);
Object.assign(payload, cleanPayload);
const residual = findResidualLiveSecrets(payload);
if (residual.length) {
  console.error('REJECTED residual live secret patterns', residual.join(','));
  process.exit(3);
}
console.info(
  '[publish-balaji-demo] secrets cleared_snapshot=%s cleared_final=%s scrubbed=%s residual=none',
  scrubSnap.cleared,
  scrubStats.cleared,
  scrubStats.scrubbed + scrubSnap.scrubbed
);

// Slim systems_recommended
payload.systems_recommended = payload.systems_recommended || [
  { id: 'workspace', label: 'AI Employees', path: '/workspace' },
  { id: 'workflows', label: 'Workflows', path: '/agent-workflows' },
  { id: 'crm', label: 'CRM (Business Core)', path: '/work' },
  { id: 'erp', label: 'ERP (Business Core)', path: '/work' },
  { id: 'knowledge', label: 'Knowledge', path: '/master-data' },
];

const summary = {
  owner: OWNER,
  company,
  agents: payload.agents.map((a) => a.name),
  departments: (payload.departments || []).length,
  workflow_templates: (payload.workflow_templates || []).map((w) => ({
    key: w.template_key,
    nodes: (w.graph?.nodes || []).length,
  })),
  goal_templates: (payload.goal_templates || []).map((g) => g.title),
  knowledge_tables: (payload.knowledge_tables || []).map((t) => t.name),
  agents_md: (payload.agents_md || []).length,
  policy_chars: (payload.policy_text || '').length,
  connectors: {
    mcp_oauth: payload.connectors?.mcp_oauth?.length || 0,
    openconnector: !!payload.connectors?.openconnector?.linked,
  },
};

console.log('SUMMARY', JSON.stringify(summary, null, 2));

if (DRY) {
  console.log('DRY_RUN=1 — not publishing/writing');
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });

const published = publishBlueprintFromPayload(
  {
    industry_id: INDUSTRY,
    name: payload.name,
    description: payload.description,
    payload,
    source_owner_user_id: OWNER,
    source_company_name: company,
    published_by: process.env.PUBLISHED_BY || 'publish-balaji-demo-blueprint',
    set_default: SET_DEFAULT,
    id: BLUEPRINT_ID,
  },
  { id: 'admin-script', name: 'publish-balaji-demo-blueprint' }
);

// System pack shape (same payload, source system)
const pack = {
  ...payload,
  id: BLUEPRINT_ID,
  industry: INDUSTRY,
  source: 'system',
  is_default: false,
  depth: 'deep',
};

const packPath = join(OUT_DIR, `${BLUEPRINT_ID}.json`);
writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n');

const { zip, filename, meta } = buildCompanyBlueprintExportZip(BLUEPRINT_ID);
const zipPath = join(OUT_DIR, filename);
writeFileSync(zipPath, zip);

// Also refresh in-repo packs/ + exports/ when writable (Docker build context / laptop checkout)
try {
  const packsDir = join(SOURCE_ROOT, 'packs');
  const exportsDir = join(SOURCE_ROOT, 'exports');
  mkdirSync(packsDir, { recursive: true });
  mkdirSync(exportsDir, { recursive: true });
  writeFileSync(join(packsDir, `${BLUEPRINT_ID}.json`), JSON.stringify(pack, null, 2) + '\n');
  writeFileSync(join(exportsDir, filename), zip);
  writeFileSync(
    join(exportsDir, `${BLUEPRINT_ID}.manifest.json`),
    JSON.stringify(
      {
        published_id: published?.id,
        secrets_scrubbed: true,
        secrets_cleared: (scrubSnap.cleared || 0) + (scrubStats.cleared || 0),
        zip_bytes: zip.length,
        coverage: meta.coverage,
        summary,
        refreshed_at: new Date().toISOString(),
      },
      null,
      2
    ) + '\n'
  );
  console.info('[publish-balaji-demo] wrote source packs+exports under', SOURCE_ROOT);
} catch (e) {
  console.warn('[publish-balaji-demo] source-tree write skipped:', e?.message || e);
}

const manifesto = {
  published_id: published?.id,
  pack_path: packPath,
  zip_path: zipPath,
  zip_bytes: zip.length,
  coverage: meta.coverage,
  secrets_scrubbed: true,
  secrets_cleared: (scrubSnap.cleared || 0) + (scrubStats.cleared || 0),
  secrets_residual: residual,
  summary,
};
writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifesto, null, 2) + '\n');
console.log('PUBLISHED', JSON.stringify(manifesto, null, 2));
process.exit(0);