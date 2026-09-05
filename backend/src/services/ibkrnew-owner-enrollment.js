import { createHash } from 'node:crypto';
import { getDb } from '../db/schema.js';
import { createFullAgent } from './create-full-agent.js';
import {
  getIbkrNewAgentTemplateBlueprints,
  getIbkrNewWorkflowBlueprints,
} from './ibkrnew-blueprints.js';
import { ensureIbkrNewDefaults } from './ibkrnew-event-trader.js';
import { syncOrgContextForCeo } from './org-context.js';
import { setAgentToolGrants, syncAllowlistsFile } from './openclaw-agent-tools.js';
import { ensureTenantOpenClawAgent, forcePushTemplateDocs } from './openclaw-tenant.js';
import { getUiNavHidden, setUiNavHidden } from './ui-nav-prefs.js';
import { grantUserAgent } from './users.js';

const FEATURE_NAV_IDS = new Set([
  'ibkrnew0',
  'ibkrnew0-strategy',
  'ibkrnew0-summary',
  'ibkrnew0-live',
]);

function ownerSuffix(ownerUserId) {
  return createHash('sha256').update(String(ownerUserId)).digest('hex').slice(0, 10);
}

function logicalAgentId(templateBaseId, ownerUserId) {
  const base = String(templateBaseId)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${base}-${ownerSuffix(ownerUserId)}`;
}

function findOwnerCoo(db, ownerUserId) {
  return db.prepare(
    `SELECT a.id
       FROM agents a
       JOIN user_agents ua ON ua.agent_id = a.id
      WHERE ua.user_id = ? AND ua.enabled = 1 AND a.is_coo = 1
      ORDER BY a.id
      LIMIT 1`
  ).get(ownerUserId)?.id || null;
}

function assertEligibleOwner(db, ownerUserId) {
  const owner = db.prepare(
    `SELECT id, name, role, enabled FROM platform_users WHERE id = ?`
  ).get(ownerUserId);
  if (!owner) throw Object.assign(new Error('Owner user was not found'), { status: 404 });
  if (owner.role !== 'ceo') throw Object.assign(new Error('IBKRNew enrollment requires a CEO owner'), { status: 400 });
  if (!owner.enabled) throw Object.assign(new Error('IBKRNew enrollment requires an enabled owner'), { status: 400 });
  return owner;
}

/**
 * Idempotently enable the complete IBKRNew0 paper feature for one CEO owner.
 * The operation does not create a bridge token, store an IBKR account number,
 * enable paper order submission, or enable live trading.
 */
export async function enrollIbkrNewOwner(ownerUserId) {
  const ownerId = String(ownerUserId || '').trim();
  if (!ownerId) throw Object.assign(new Error('owner_user_id is required'), { status: 400 });

  const db = getDb();
  const owner = assertEligibleOwner(db, ownerId);
  const configs = ensureIbkrNewDefaults(ownerId);

  db.prepare(`UPDATE ibkrnew_reaction_registry SET enabled = 1 WHERE owner_user_id = ?`).run(ownerId);

  const workflowsByAgent = new Map(
    getIbkrNewWorkflowBlueprints().map((workflow) => [workflow.agent_name, workflow])
  );
  const templates = getIbkrNewAgentTemplateBlueprints();
  const cooId = findOwnerCoo(db, ownerId);
  const provisioned = [];

  for (const template of templates) {
    const workflow = workflowsByAgent.get(template.agent_name);
    let agent = db.prepare(
      `SELECT * FROM agents
        WHERE owner_user_id = ? AND (template_base_id = ? OR name = ?)
        ORDER BY CASE WHEN template_base_id = ? THEN 0 ELSE 1 END, id
        LIMIT 1`
    ).get(ownerId, template.template_base_id, template.agent_name, template.template_base_id);

    let created = false;
    if (!agent) {
      agent = await createFullAgent({
        id: logicalAgentId(template.template_base_id, ownerId),
        name: template.agent_name,
        role: workflow?.responsibility || 'IBKRNew event-driven trading specialist',
        department: 'Trading',
        parent_id: cooId,
        ownerUserId: ownerId,
        tools: [],
        source_kind: 'ibkrnew',
        source_publish_id: 'IBKRNew0',
        template_base_id: template.template_base_id,
        workspace_template: template.workspace_template,
      });
      created = true;
    } else {
      grantUserAgent(ownerId, agent.id);
    }

    const ensured = ensureTenantOpenClawAgent(agent, ownerId);
    setAgentToolGrants(agent, []);
    forcePushTemplateDocs(template.template_base_id, ensured.workspacePath, { forceIdentity: true });
    provisioned.push({
      id: agent.id,
      name: agent.name,
      created,
      template_base_id: template.template_base_id,
      openclaw_agent_id: ensured.openclawAgentId,
    });
  }

  syncAllowlistsFile();
  await syncOrgContextForCeo(ownerId);

  const visibleNav = getUiNavHidden(ownerId).filter((id) => !FEATURE_NAV_IDS.has(id));
  setUiNavHidden(ownerId, visibleNav);

  const configKinds = Object.keys(configs).sort();
  const reactionCount = db.prepare(
    `SELECT COUNT(*) count FROM ibkrnew_reaction_registry WHERE owner_user_id = ? AND enabled = 1`
  ).get(ownerId).count;
  const grantCount = db.prepare(
    `SELECT COUNT(*) count
       FROM user_agents ua
       JOIN agents a ON a.id = ua.agent_id
      WHERE ua.user_id = ? AND ua.enabled = 1 AND a.owner_user_id = ? AND a.source_kind = 'ibkrnew'`
  ).get(ownerId, ownerId).count;

  if (configKinds.length !== 5 || reactionCount !== 6 || grantCount !== 6 || provisioned.length !== 6) {
    throw new Error('IBKRNew enrollment verification failed');
  }

  return {
    owner: { id: owner.id, name: owner.name },
    feature: 'IBKRNew0',
    environment: 'paper',
    config_kinds: configKinds,
    enabled_workflows: reactionCount,
    enabled_agents: grantCount,
    agents: provisioned,
    navigation_visible: true,
    bridge_created: false,
    execution_enabled: false,
    live_trading_enabled: false,
  };
}
