/**
 * Snapshot / publish / export company blueprint zip with coverage (source of truth; no VPS hotfixes).
 * Usage (backend container):
 *   node scripts/validate-company-blueprint-export.mjs
 * Env: SOURCE_OWNER_USER_ID, DRY_RUN=1, OUT_ZIP=/tmp/bp.zip
 */
import { writeFileSync } from 'fs';
import { initDb, getDb } from '../src/db/schema.js';
import {
  snapshotOwnerAsBlueprintPayloadAsync,
  validateContentBlueprintPayload,
} from '../src/services/company-blueprint-publish.js';
import {
  publishBlueprintFromPayload,
  buildCompanyBlueprintExportZip,
} from '../src/services/company-blueprints/index.js';

initDb();
const db = getDb();

const published = db
  .prepare(
    `SELECT id, industry_id, name, source_owner_user_id, source_company_name, length(payload_json) as n, updated_at
     FROM company_industry_blueprints WHERE published=1 ORDER BY updated_at DESC LIMIT 15`
  )
  .all();
console.log('published_blueprints', JSON.stringify(published, null, 2));

const OWNER =
  process.env.SOURCE_OWNER_USER_ID ||
  published.find((p) => p.source_owner_user_id)?.source_owner_user_id ||
  'ceo-content-api-phase01-057515';

console.log('snapshot_owner', OWNER);
const snap = await snapshotOwnerAsBlueprintPayloadAsync(OWNER);
const validation = validateContentBlueprintPayload(snap.payload, {
  expectedCompanyHint: snap.company_name,
});

const summary = {
  owner: OWNER,
  company: snap.company_name,
  agents: (snap.payload?.agents || []).map((a) => ({
    name: a.name,
    department: a.department,
    tools: (a.tools || []).length,
  })),
  departments: snap.payload?.departments?.length,
  org: {
    departments: snap.payload?.org?.departments?.length,
    agent_department_map: snap.payload?.org?.agent_department_map?.length,
  },
  knowledge_tables: (snap.payload?.knowledge_tables || []).map((t) => t.name),
  policy_chars: (snap.payload?.policy_text || '').length,
  connectors: {
    mcp_oauth: snap.payload?.connectors?.mcp_oauth?.length || 0,
    ceo_mcp_servers: snap.payload?.connectors?.ceo_mcp_servers?.length || 0,
    openconnector: snap.payload?.connectors?.openconnector || null,
  },
  workflow_templates: (snap.payload?.workflow_templates || []).map((w) => ({
    key: w.template_key,
    nodes: (w.graph?.nodes || []).length,
    edges: (w.graph?.edges || []).length,
  })),
  goal_templates: (snap.payload?.goal_templates || []).map((g) => g.title),
  agents_md: (snap.payload?.agents_md || []).map((m) => ({
    agent_name: m.agent_name,
    file_keys: m.file_keys || Object.keys(m.files || {}),
    tools: (m.tools || []).length,
    ops_source: m.ops_source,
    has_ops: !!(m.files && m.files.ops),
  })),
  day0_day1: snap.payload?.day0_day1,
  validation: {
    ok: validation.ok,
    issues: validation.issues,
    failed_checks: (validation.checks || []).filter((c) => !c.ok),
  },
};
console.log('SNAPSHOT', JSON.stringify(summary, null, 2));

if (process.env.DRY_RUN === '1') {
  process.exit(validation.ok ? 0 : 2);
}

const publishedBp = publishBlueprintFromPayload(
  {
    industry_id: process.env.INDUSTRY_ID || snap.industry || 'content_creator',
    name:
      process.env.BLUEPRINT_NAME ||
      `${snap.company_name || 'Content ops'} (Day0+Day1 full publish)`,
    description: snap.payload?.description || '',
    payload: snap.payload,
    source_owner_user_id: OWNER,
    source_company_name: snap.company_name,
    published_by: 'validate-company-blueprint-export',
    set_default: process.env.SET_DEFAULT !== '0',
    id: process.env.BLUEPRINT_ID || null,
  },
  { id: 'admin-validate', name: 'validate-company-blueprint-export' }
);

console.log(
  'PUBLISHED',
  JSON.stringify(
    {
      id: publishedBp?.id,
      agents_md: publishedBp?.agents_md?.length,
      workflow_templates: publishedBp?.workflow_templates?.length,
      connectors: !!publishedBp?.connectors,
    },
    null,
    2
  )
);

const { zip, filename, meta } = buildCompanyBlueprintExportZip(publishedBp.id);
const outPath = process.env.OUT_ZIP || `/tmp/${filename}`;
writeFileSync(outPath, zip);
console.log(
  'ZIP',
  JSON.stringify(
    {
      filename,
      outPath,
      bytes: zip.length,
      coverage: meta.coverage,
      export_format: meta.export_format,
    },
    null,
    2
  )
);

process.exit(validation.ok ? 0 : 2);
