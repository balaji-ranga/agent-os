/**
 * Re-publish ContentMedia API org as a full Day0+Day1 industry blueprint.
 * Usage (backend container):
 *   node scripts/republish-content-ops-blueprint.js
 * Env:
 *   SOURCE_OWNER_USER_ID=ceo-content-api-phase01-057515
 *   BLUEPRINT_NAME=...
 *   SET_DEFAULT=1
 */
import { initDb } from '../src/db/schema.js';
import {
  snapshotOwnerAsBlueprintPayloadAsync,
  validateContentBlueprintPayload,
} from '../src/services/company-blueprint-publish.js';
import { publishBlueprintFromPayload } from '../src/services/company-blueprints/index.js';

const OWNER =
  process.env.SOURCE_OWNER_USER_ID ||
  process.env.OWNER_USER_ID ||
  'ceo-content-api-phase01-057515';

initDb();

const snap = await snapshotOwnerAsBlueprintPayloadAsync(OWNER);
const validation = validateContentBlueprintPayload(snap.payload, {
  expectedCompanyHint: snap.company_name,
});

console.log(
  JSON.stringify(
    {
      owner: OWNER,
      company: snap.company_name,
      operate_gate: snap.operate_gate,
      setup_gate: snap.setup_gate,
      agents: snap.payload?.agents?.length,
      departments: snap.payload?.departments?.length,
      knowledge_tables: snap.payload?.knowledge_tables?.map((t) => t.name),
      workflow_templates: snap.payload?.workflow_templates?.map((w) => w.template_key),
      goal_templates: snap.payload?.goal_templates?.map((g) => g.title),
      agents_md: snap.payload?.agents_md?.map((a) => a.agent_name),
      policy_chars: (snap.payload?.policy_text || '').length,
      operate_loops: snap.payload?.operate_model_snapshot?.loops?.length,
      day0_day1: snap.payload?.day0_day1,
      validation: { ok: validation.ok, issues: validation.issues, checks: validation.checks?.filter((c) => !c.ok) },
    },
    null,
    2
  )
);

if (process.env.DRY_RUN === '1') {
  console.log('DRY_RUN=1 — not publishing');
  process.exit(validation.ok ? 0 : 2);
}

const name =
  process.env.BLUEPRINT_NAME ||
  `${snap.company_name || 'Content ops'} (Day0+Day1 API publish)`;
const setDefault = process.env.SET_DEFAULT !== '0';

const published = publishBlueprintFromPayload(
  {
    industry_id: process.env.INDUSTRY_ID || snap.industry || 'content_creator',
    name,
    description: snap.payload?.description || '',
    payload: snap.payload,
    source_owner_user_id: OWNER,
    source_company_name: snap.company_name,
    published_by: process.env.PUBLISHED_BY || 'admin-script',
    set_default: setDefault,
    id: process.env.BLUEPRINT_ID || null,
  },
  { id: 'admin-script', name: 'republish-content-ops-blueprint' }
);

const reval = validateContentBlueprintPayload(published, {
  expectedCompanyHint: snap.company_name,
});

console.log(
  JSON.stringify(
    {
      published_id: published?.id,
      industry: published?.industry,
      is_default: published?.is_default,
      workflow_templates: published?.workflow_templates?.length,
      goal_templates: published?.goal_templates?.length,
      agents_md: published?.agents_md?.length,
      validation_ok: reval.ok,
      validation_issues: reval.issues,
    },
    null,
    2
  )
);

process.exit(reval.ok ? 0 : 2);
