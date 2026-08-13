/**
 * Seed Social Researcher + Business Discovery AI employees for the Flolah
 * Exchange publisher CEO, then publish Flolah listings (not auto-hired on register).
 *
 * Usage: node scripts/seed-social-research-agents.js
 */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

import { initDb, getDb } from '../src/db/schema.js';
import { createFullAgent } from '../src/services/create-full-agent.js';
import { setAgentToolGrants } from '../src/services/openclaw-agent-tools.js';
import { grantUserAgent } from '../src/services/users.js';
import { publishAgentToExchange } from '../src/services/agent-a2a-publish.js';
import {
  ensureTenantOpenClawAgent,
  forcePushTemplateDocs,
  tenantWorkspacePath,
} from '../src/services/openclaw-tenant.js';
import { SOCIAL_RESEARCH_TOOL_NAMES, seedSocialResearchToolsIfMissing } from '../src/db/seed-social-research-tools.js';

initDb();

const SOCIAL_TOOLS = [
  ...SOCIAL_RESEARCH_TOOL_NAMES.filter((n) => n !== 'business_discover'),
  'brave_web_search',
  'summarize_url',
  'learnings_summary',
  'notify_ceo',
  'kanban_move_status',
  'browse_session_status',
  'browse_task_start',
  'browse_task_status',
];

const DISCOVERY_TOOLS = [
  ...SOCIAL_RESEARCH_TOOL_NAMES,
  'brave_web_search',
  'learnings_summary',
  'notify_ceo',
  'kanban_create_task',
  'kanban_move_status',
  'master_data_list_tables',
  'master_data_list_rows',
  'master_data_insert_row',
];

const DEFS = [
  {
    id: 'socialresearcher',
    name: 'Social Researcher',
    role: 'Public social research (Instagram, X, LinkedIn, Facebook)',
    department: 'Research',
    template_base_id: 'socialresearcher',
    tools: SOCIAL_TOOLS,
    description:
      'Analyse public Instagram, X, LinkedIn and Facebook. Instagram/X return hydrated posts[] (images/text); Meta Graph is owned Pages only. Example: “Analyse Nike’s Instagram and X for the last 30 days.”',
  },
  {
    id: 'businessdiscovery',
    name: 'Business Discovery',
    role: 'Local business discovery and lead enrichment',
    department: 'Research',
    template_base_id: 'businessdiscovery',
    tools: DISCOVERY_TOOLS,
    description:
      'Find businesses in a locality with Google Places API (New), enrich website/Instagram/LinkedIn, skip Knowledge duplicates, and Kanban-handoff to CRM or the CEO. Example: “Find dental clinics within 3 km of Tampines with rating above 4.2.”',
  },
];

export function resolveFlolahExchangePublisherUserId() {
  const db = getDb();
  const envId = String(process.env.FLOLAH_EXCHANGE_PUBLISHER_USER_ID || '').trim();
  if (envId) {
    const row = db
      .prepare(`SELECT id FROM platform_users WHERE id = ? AND role = 'ceo' AND enabled = 1`)
      .get(envId);
    if (row?.id) return row.id;
    console.warn('[seed-social-research] FLOLAH_EXCHANGE_PUBLISHER_USER_ID not an enabled CEO: %s', envId);
  }
  const ceo = db
    .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1 ORDER BY created_at LIMIT 1`)
    .get();
  return ceo?.id || null;
}

function publisherCooId(ownerUserId) {
  const row = getDb()
    .prepare(
      `SELECT a.id FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
       WHERE a.is_coo = 1
       LIMIT 1`
    )
    .get(ownerUserId);
  if (row?.id) return row.id;
  const any = getDb().prepare(`SELECT id FROM agents WHERE is_coo = 1 LIMIT 1`).get();
  return any?.id || null;
}

function findOwnedAgent(ownerUserId, logicalId) {
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT * FROM agents WHERE owner_user_id = ? AND (id = ? OR openclaw_agent_id = ?) LIMIT 1`
      )
      .get(ownerUserId, logicalId, logicalId) ||
    db.prepare(`SELECT * FROM agents WHERE id = ? AND owner_user_id = ?`).get(logicalId, ownerUserId)
  );
}

async function ensureAgent(ownerUserId, def) {
  const existing = findOwnedAgent(ownerUserId, def.id);
  const parentId = publisherCooId(ownerUserId);
  if (existing) {
    getDb()
      .prepare(
        `UPDATE agents SET name = ?, role = ?, department = ?, parent_id = COALESCE(?, parent_id)
         WHERE id = ?`
      )
      .run(def.name, def.role, def.department, parentId, existing.id);
    grantUserAgent(ownerUserId, existing.id);
    try {
      setAgentToolGrants(existing, def.tools);
    } catch (e) {
      console.warn('[seed-social-research] grants', existing.id, e.message);
    }
    try {
      const ensured = ensureTenantOpenClawAgent(
        { ...existing, template_base_id: def.template_base_id },
        ownerUserId
      );
      const ws = ensured.workspacePath || tenantWorkspacePath(ownerUserId, def.template_base_id);
      if (existsSync(join(__dirname, '..', '..', 'openclaw-workspace-templates', def.template_base_id))) {
        forcePushTemplateDocs(def.template_base_id, ws, { forceIdentity: true });
      }
    } catch (e) {
      console.warn('[seed-social-research] workspace push', existing.id, e.message);
    }
    return getDb().prepare('SELECT * FROM agents WHERE id = ?').get(existing.id);
  }

  const idTaken = getDb().prepare('SELECT id, owner_user_id FROM agents WHERE id = ?').get(def.id);
  const created = await createFullAgent({
    id: idTaken ? undefined : def.id,
    name: def.name,
    role: def.role,
    department: def.department,
    parent_id: parentId,
    ownerUserId,
    tools: def.tools,
    template_base_id: def.template_base_id,
    preserveTemplateWorkspaceDocs: true,
    source_kind: 'hired',
  });
  try {
    const ws = created.tenant_workspace_path || created.workspace_path;
    if (ws) forcePushTemplateDocs(def.template_base_id, ws, { forceIdentity: true });
  } catch (e) {
    console.warn('[seed-social-research] template push after create', e.message);
  }
  return created;
}

export async function seedSocialResearchExchangeAgents() {
  seedSocialResearchToolsIfMissing();
  const owner = resolveFlolahExchangePublisherUserId();
  if (!owner) {
    console.warn('[seed-social-research] no enabled CEO — skip Exchange publish');
    return { ok: false, skipped: true, reason: 'no_ceo' };
  }
  const published = [];
  for (const def of DEFS) {
    const agent = await ensureAgent(owner, def);
    const pub = publishAgentToExchange(owner, agent.id, {
      visibility: 'flolah',
      name: def.name,
      description: def.description,
    });
    published.push({ agent_id: agent.id, publish_id: pub?.id, name: def.name });
    console.info(
      '[seed-social-research] published %s agent=%s listing=%s owner=%s',
      def.name,
      agent.id,
      pub?.id,
      owner
    );
  }
  return { ok: true, owner, published };
}

if (process.argv[1]?.includes('seed-social-research-agents')) {
  seedSocialResearchExchangeAgents()
    .then((r) => {
      console.log('OK', JSON.stringify(r, null, 2));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
