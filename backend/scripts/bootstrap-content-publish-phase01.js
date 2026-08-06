/**
 * Phase 0+1 bootstrap: new CEO + content_creator company + Meta Graph MCP registry + content-publish-social workflow.
 *
 * Facebook App ID/Secret: set on Connectors → MCPs (connector-level), not required in .env.
 *
 * Run on VPS (preferred, owns production DB):
 *   docker compose exec -T backend node scripts/bootstrap-content-publish-phase01.js
 *
 * Env overrides:
 *   CM_API_EMAIL, CM_API_PASS, CM_API_NAME, CM_API_COMPANY
 *   WORKFLOW_SEED_OWNER_ID (skip user create; only seed workflow for that owner)
 *   SKIP_COMPANY_APPLY=1
 *   CONTENT_LINKEDIN_OC_ACTION_ID, CONTENT_LINKEDIN_OC_APP_ID
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '../../deploy/.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { registerCeoUser, getUserById, listAgentsForUser } from '../src/services/users.js';
import { createSession } from '../src/services/auth/session.js';
import { saveFunnelDraft, applyCompanySetup } from '../src/services/company-setup.js';
import { getAgentToolGrants } from '../src/services/openclaw-agent-tools.js';
import { seedMetaGraphMcp, META_GRAPH_MCP_ID } from './seed-meta-graph-mcp.js';
import {
  seedContentPublishSocialWorkflow,
  WORKFLOW_ID,
} from './seed-content-publish-social-workflow.js';

initDb();

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const email = process.env.CM_API_EMAIL || `content.api.phase01.${stamp}@example.com`;
const password =
  process.env.CM_API_PASS ||
  `ContentApi-${stamp}-${crypto.randomBytes(4).toString('hex')}!`;
const name = process.env.CM_API_NAME || 'Content API Publish CEO';
const company = process.env.CM_API_COMPANY || 'Content Media API Studio';

const WORKFLOW_TOOLS = [
  'agent_workflow_list',
  'agent_workflow_trigger',
  'agent_workflow_runs',
  'agent_workflow_enquire',
];

function grantWorkflowToolsToPublishAgents(ownerUserId) {
  const db = getDb();
  const agents = listAgentsForUser(ownerUserId).filter((a) => {
    const n = String(a.name || '').toLowerCase();
    return n.includes('channel publisher') || n.includes('publisher') || n === 'coo';
  });
  const ins = db.prepare(
    'INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)'
  );
  const out = [];
  for (const a of agents) {
    let added = 0;
    for (const t of WORKFLOW_TOOLS) {
      const r = ins.run(a.id, t);
      if (r.changes) added += 1;
    }
    out.push({
      id: a.id,
      name: a.name,
      tools_added: added,
      grants: getAgentToolGrants(a.id).length,
    });
    console.info('[bootstrap-phase01] workflow tools granted', {
      agentId: a.id,
      name: a.name,
      toolsAdded: added,
    });
  }
  return out;
}

async function ensureCeo() {
  if (process.env.WORKFLOW_SEED_OWNER_ID) {
    const u = getUserById(process.env.WORKFLOW_SEED_OWNER_ID);
    if (!u) throw new Error(`WORKFLOW_SEED_OWNER_ID not found: ${process.env.WORKFLOW_SEED_OWNER_ID}`);
    return { user: u, created: false, password: null };
  }
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM platform_users WHERE lower(email) = lower(?)')
    .get(email);
  if (existing) {
    return { user: getUserById(existing.id), created: false, password: null };
  }
  const user = await registerCeoUser({
    email,
    password,
    name,
    region: 'global',
    mobile: '',
    // platform_industries catalog — blueprint id is set in company setup, not here
    industry: 'personal',
    business_name: company,
    ceo_db_mode: 'tenant',
    mfa_policy: 'off',
  });
  return { user, created: true, password };
}

async function formCompany(ownerUserId) {
  if (process.env.SKIP_COMPANY_APPLY === '1') {
    console.info('[bootstrap-phase01] SKIP_COMPANY_APPLY=1');
    return { skipped: true };
  }
  saveFunnelDraft(ownerUserId, {
    company_name: company,
    company_type: 'content_creator',
    blueprint_id: 'content_creator',
    funnel_step: 'review',
    management_style: 'after_approval',
    mission:
      'Publish approved social content via Meta Graph MCP (Facebook) and OpenConnector (LinkedIn); browser only as emergency fallback.',
    describe_company:
      'Content media studio focused on Facebook Page and LinkedIn text posts via certified publish workflow content-publish-social.',
    org_dna: 'execution',
  });
  return applyCompanySetup(ownerUserId, { confirm_override: true });
}

async function main() {
  console.info('[bootstrap-phase01] start', { email, company });

  try {
    const mcp = await seedMetaGraphMcp();
    console.info('[bootstrap-phase01] meta graph mcp', {
      id: META_GRAPH_MCP_ID,
      status: mcp?.status,
      url: mcp?.url,
    });
  } catch (e) {
    console.warn('[bootstrap-phase01] seedMetaGraphMcp', e?.message || e);
  }

  const { user, created, password: plainPass } = await ensureCeo();
  const ownerUserId = user.id;
  console.info('[bootstrap-phase01] ceo', { id: ownerUserId, email: user.email, created });

  let companyResult = null;
  try {
    companyResult = await formCompany(ownerUserId);
    console.info('[bootstrap-phase01] company apply', {
      skipped: companyResult?.skipped || false,
      agents: companyResult?.applied?.agents_created?.length ?? null,
      status: companyResult?.status || companyResult?.strategy?.status || null,
    });
  } catch (e) {
    console.error('[bootstrap-phase01] company apply failed', e?.message || e);
    throw e;
  }

  const publishers = grantWorkflowToolsToPublishAgents(ownerUserId);

  const wf = seedContentPublishSocialWorkflow(ownerUserId, { publish: true });
  console.info('[bootstrap-phase01] workflow', {
    id: WORKFLOW_ID,
    owner: ownerUserId,
    status: wf?.status || null,
    published_version: wf?.published_version ?? wf?.version ?? null,
  });

  createSession(ownerUserId);

  const out = {
    ok: true,
    phase: '0+1',
    ceo: {
      id: ownerUserId,
      email: user.email,
      name: user.name,
      created,
      password: plainPass || (created ? password : '(existing user — password not rotated)'),
    },
    company,
    workflow_id: WORKFLOW_ID,
    agents_with_workflow_tools: publishers,
    login: 'https://login.flolah.cloud/login',
    oauth_note:
      'App ID/Secret stay on Connectors → MCPs for mcp-meta-graph (platform admin). This CEO only completes OAuth Connect.',
    next_ui_steps: [
      'Platform admin (once): Connectors → MCPs → Facebook/Meta Graph → set App ID + App Secret (not .env)',
      'As this CEO: Connectors → MCPs → Connect Facebook OAuth',
      'Smoke MCP: list_my_pages then create_page_post with page_id',
      'Optional LinkedIn: OpenConnector LinkedIn connected; pin CONTENT_LINKEDIN_OC_ACTION_ID if needed',
      'Workflows → content-publish-social manual run { platform, body, page_id }',
    ],
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});