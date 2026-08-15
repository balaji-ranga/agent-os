/**
 * Publish Meridian College (Education demo CEO) as demo_education.
 * Scrubs secrets. Does **not** regenerate BrightBox golden standard/business-core packs.
 *
 * Usage (backend container):
 *   node scripts/publish-education-demo-blueprint.js
 * Env:
 *   SOURCE_OWNER_USER_ID=ceo-meridian-college-f101c7
 *   BLUEPRINT_ID=demo_education
 *   OUT_DIR=/tmp/edu-demo-bp
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

const OWNER = process.env.SOURCE_OWNER_USER_ID || 'ceo-meridian-college-f101c7';
const BLUEPRINT_ID = process.env.BLUEPRINT_ID || 'demo_education';
const INDUSTRY = process.env.INDUSTRY_ID || 'demo_education';
const OUT_DIR = process.env.OUT_DIR || '/tmp/edu-demo-bp';
const SET_DEFAULT = process.env.SET_DEFAULT === '1';
const DRY = process.env.DRY_RUN === '1';
const FROM_PACK_FILE = process.env.FROM_PACK_FILE === '1';
const SOURCE_ROOT =
  process.env.SOURCE_BLUEPRINT_ROOT || join(process.cwd(), 'src/services/company-blueprints');

function keepWorkflow(w) {
  const key = String(w.template_key || w.id || w.name || '').toLowerCase();
  if (/smoke|sse-|chatops|certify|hello-world|brain-mcp|agent-exchange|live-org|testtool|ibkr|video-|monthly-trading/.test(key)) {
    if (/^(erp-mc|crm-mc)/.test(key) || /summarize-inbound|maker|checker/.test(key)) return true;
    return false;
  }
  return (
    /^(erp-mc|crm-mc)/.test(key) ||
    /inbound-media|summarize-inbound|maker|checker/.test(key)
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
  company = payload.source_company_name || 'Meridian College';
  sanitizeBlueprintSecrets(payload, scrubSnap);
  console.info('[publish-education-demo] FROM_PACK_FILE=%s', packFile);
} else {
  const snap = await snapshotOwnerAsBlueprintPayloadAsync(OWNER);
  company = snap.company_name || 'Meridian College';
  payload = { ...(snap.payload || {}) };
  sanitizeBlueprintSecrets(payload, scrubSnap);
  payload.workflow_templates = (payload.workflow_templates || []).filter(keepWorkflow);
  payload.agents = (payload.agents || []).map(portableAgent);
}

payload.id = BLUEPRINT_ID;
payload.industry = INDUSTRY;
payload.name = process.env.BLUEPRINT_NAME || `Flolah demo — ${company} (Education)`;
payload.label = payload.name;
payload.description =
  process.env.BLUEPRINT_DESCRIPTION ||
  'Demo company snapshot from Meridian College: Education industry card, Twenty CRM + ERPNext Maker–Checker, COO WhatsApp PA (text + TTS), thought inbox and consultant-brief scheduled goals, Knowledge tables (no secrets). Thin Education card still maps to general_ops. Do not regenerate standard/business-core from this pack.';
payload.depth = 'deep';
payload.source = 'system';
payload.is_default = false;
payload.aliases = ['education_demo', 'meridian_college', 'demo_meridian', 'flolah_education_demo'];
payload.companion_packs = [];
payload.source_owner_user_id = OWNER;
payload.source_company_name = company;
payload.demo = true;
payload.demo_owner_name = 'Meridian College CEO';

const { value: cleanPayload, stats: scrubStats } = cloneAndSanitizeBlueprint(payload);
Object.assign(payload, cleanPayload);
const residual = findResidualLiveSecrets(payload);
if (residual.length) {
  console.error('REJECTED residual live secret patterns', residual.join(','));
  process.exit(3);
}
console.info(
  '[publish-education-demo] secrets cleared_snapshot=%s cleared_final=%s scrubbed=%s residual=none',
  scrubSnap.cleared,
  scrubStats.cleared,
  scrubStats.scrubbed + scrubSnap.scrubbed
);

payload.systems_recommended = payload.systems_recommended || [
  { id: 'workspace', label: 'AI Employees', path: '/workspace' },
  { id: 'workflows', label: 'Workflows', path: '/agent-workflows' },
  { id: 'crm', label: 'CRM (Business Core)', path: '/work' },
  { id: 'erp', label: 'ERP (Business Core)', path: '/work' },
  { id: 'knowledge', label: 'Knowledge', path: '/master-data' },
  { id: 'channels', label: 'Agent channels', path: '/agent-channels' },
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
    published_by: process.env.PUBLISHED_BY || 'publish-education-demo-blueprint',
    set_default: SET_DEFAULT,
    id: BLUEPRINT_ID,
  },
  { id: 'admin-script', name: 'publish-education-demo-blueprint' }
);

const pack = {
  ...payload,
  id: BLUEPRINT_ID,
  industry: INDUSTRY,
  source: 'system',
  is_default: false,
  depth: 'deep',
};

const packPath = join(OUT_DIR, `${BLUEPRINT_ID}.json`);
writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`);

const { zip, filename, meta } = buildCompanyBlueprintExportZip(BLUEPRINT_ID);
const zipPath = join(OUT_DIR, filename);
writeFileSync(zipPath, zip);

try {
  const packsDir = join(SOURCE_ROOT, 'packs');
  const exportsDir = join(SOURCE_ROOT, 'exports');
  mkdirSync(packsDir, { recursive: true });
  mkdirSync(exportsDir, { recursive: true });
  writeFileSync(join(packsDir, `${BLUEPRINT_ID}.json`), `${JSON.stringify(pack, null, 2)}\n`);
  writeFileSync(join(exportsDir, filename), zip);
  writeFileSync(
    join(exportsDir, `${BLUEPRINT_ID}.manifest.json`),
    `${JSON.stringify(
      {
        published_id: published?.id,
        secrets_scrubbed: true,
        secrets_cleared: (scrubSnap.cleared || 0) + (scrubStats.cleared || 0),
        zip_bytes: zip.length,
        coverage: meta.coverage,
        summary,
        refreshed_at: new Date().toISOString(),
        note: 'Do not regenerate company-blueprints/standard/business-core from this owner. BrightBox remains golden.',
      },
      null,
      2
    )}\n`
  );
  console.info('[publish-education-demo] wrote source packs+exports under', SOURCE_ROOT);
} catch (e) {
  console.warn('[publish-education-demo] source-tree write skipped:', e?.message || e);
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
writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifesto, null, 2)}\n`);
console.log('PUBLISHED', JSON.stringify(manifesto, null, 2));
process.exit(0);
