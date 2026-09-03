/**
 * Action-level grants for generic OpenConnector execution.
 *
 * Agents still receive the single connector_execute_action content tool, while
 * this registry limits which provider actions they may execute and supplies an
 * explicit Action Control classification for each action. Agents without any
 * action-level rows retain the existing broad connector behaviour for backward
 * compatibility; once an agent has one row, its connector access is allowlist-only.
 */
import { getDb } from '../db/schema.js';
import { resolveAgentFromOpenClawCallerId } from './openclaw-tenant.js';

export const GMAIL_OPERATIONS_CONNECTOR_ACTIONS = Object.freeze([
  { action_id: 'gmail.search_threads', risk_tier: 'R0', action_family: 'read' },
  { action_id: 'gmail.list_threads', risk_tier: 'R0', action_family: 'read' },
  { action_id: 'gmail.fetch_emails', risk_tier: 'R0', action_family: 'read' },
  { action_id: 'gmail.get_message', risk_tier: 'R0', action_family: 'read' },
  { action_id: 'gmail.fetch_message_by_message_id', risk_tier: 'R0', action_family: 'read' },
  { action_id: 'gmail.get_thread', risk_tier: 'R0', action_family: 'read' },
  { action_id: 'gmail.list_drafts', risk_tier: 'R0', action_family: 'read' },
  { action_id: 'gmail.get_draft', risk_tier: 'R0', action_family: 'read' },
  { action_id: 'gmail.create_draft', risk_tier: 'R1', action_family: 'write_internal' },
  { action_id: 'gmail.create_email_draft', risk_tier: 'R1', action_family: 'write_internal' },
  { action_id: 'gmail.update_draft', risk_tier: 'R1', action_family: 'write_internal' },
]);

export function ensureConnectorActionGrantTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS connector_action_registry (
      action_id TEXT PRIMARY KEY,
      risk_tier TEXT NOT NULL,
      action_family TEXT NOT NULL,
      description TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS agent_connector_action_grants (
      agent_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (agent_id, action_id),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (action_id) REFERENCES connector_action_registry(action_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_connector_actions_agent
      ON agent_connector_action_grants(agent_id);
    CREATE TABLE IF NOT EXISTS agent_connector_action_scopes (
      agent_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'allowlist',
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );
  `);
}

export function classifyConnectorAction(action = {}) {
  const id = String(action.id || action.action_id || '').trim();
  const operation = id.split('.').pop().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  // Classify the stable operation id, not prose descriptions. Descriptions often
  // mention side effects an action explicitly excludes (for example, a search
  // action saying "Trash is excluded"), which must not inflate its risk tier.
  if (/^(untrash|restore)(_|$)/.test(operation)) {
    return { risk_tier: 'R1', action_family: 'write_internal' };
  }
  if (/^(get|list|search|find|fetch|read|lookup|inspect|download)(_|$)|^settings_get(_|$)/.test(operation)) {
    return { risk_tier: 'R0', action_family: 'read' };
  }
  if (/^(send|publish|post|message|reply|forward|share|invite|notify)(_|$)/.test(operation)) {
    return { risk_tier: 'R2', action_family: 'communicate_external' };
  }
  if (/^(delete|trash|destroy|purge|cancel)(_|$)|^move_.*_?trash($|_)|(^|_)(refund|payment|purchase|charge|transfer|order|trade|submit)($|_)/.test(operation)) {
    return { risk_tier: 'R3', action_family: 'financial_destructive' };
  }
  if (/^(create|update|upsert|edit|modify|batch_modify|add|set|patch|archive|draft|stop)(_|$)/.test(operation)) {
    return { risk_tier: 'R1', action_family: 'write_internal' };
  }
  // Unknown third-party actions are approval-gated rather than silently read-only.
  return { risk_tier: 'R2', action_family: 'communicate_external' };
}

function upsertActionMetadata(action) {
  const id = String(action?.id || action?.action_id || '').trim();
  if (!id) throw new Error('Connector action id required');
  const classification = classifyConnectorAction(action);
  getDb().prepare(`
    INSERT INTO connector_action_registry
      (action_id, risk_tier, action_family, description, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(action_id) DO UPDATE SET
      risk_tier = excluded.risk_tier,
      action_family = excluded.action_family,
      description = excluded.description,
      updated_at = datetime('now')
  `).run(id, classification.risk_tier, classification.action_family, String(action?.description || ''));
  return { action_id: id, ...classification };
}

export function getAgentConnectorActionGrants(agentId) {
  ensureConnectorActionGrantTables();
  return getDb().prepare(`
    SELECT g.action_id, r.risk_tier, r.action_family, r.description
    FROM agent_connector_action_grants g
    LEFT JOIN connector_action_registry r ON r.action_id = g.action_id
    WHERE g.agent_id = ?
    ORDER BY g.action_id
  `).all(String(agentId || '').trim());
}

export function setAgentConnectorActionGrants(agentId, actions = []) {
  ensureConnectorActionGrantTables();
  const id = String(agentId || '').trim();
  if (!id || !getDb().prepare('SELECT 1 FROM agents WHERE id = ?').get(id)) {
    throw new Error('Agent not found');
  }
  const normalized = [];
  const seen = new Set();
  for (const action of Array.isArray(actions) ? actions : []) {
    const row = typeof action === 'string' ? { id: action } : action;
    const actionId = String(row?.id || row?.action_id || '').trim();
    if (!actionId || seen.has(actionId)) continue;
    seen.add(actionId);
    normalized.push({ ...row, id: actionId });
  }
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO agent_connector_action_grants (agent_id, action_id) VALUES (?, ?)
  `);
  db.transaction(() => {
    db.prepare(`
      INSERT INTO agent_connector_action_scopes (agent_id, mode, updated_at)
      VALUES (?, 'allowlist', datetime('now'))
      ON CONFLICT(agent_id) DO UPDATE SET mode = 'allowlist', updated_at = datetime('now')
    `).run(id);
    db.prepare('DELETE FROM agent_connector_action_grants WHERE agent_id = ?').run(id);
    for (const action of normalized) {
      upsertActionMetadata(action);
      insert.run(id, action.id);
    }
  })();
  return getAgentConnectorActionGrants(id);
}

export function seedConnectorActionRegistry() {
  ensureConnectorActionGrantTables();
  const db = getDb();
  const put = db.prepare(`
    INSERT INTO connector_action_registry
      (action_id, risk_tier, action_family, description, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(action_id) DO UPDATE SET
      risk_tier = excluded.risk_tier,
      action_family = excluded.action_family,
      description = excluded.description,
      updated_at = datetime('now')
  `);
  const tx = db.transaction(() => {
    for (const row of GMAIL_OPERATIONS_CONNECTOR_ACTIONS) {
      put.run(
        row.action_id,
        row.risk_tier,
        row.action_family,
        row.action_id.includes('draft') ? 'Gmail draft operation; never sends mail.' : 'Gmail read operation.'
      );
    }
  });
  tx();
}

/** Seed existing and future Gmail Operations employees from the stable template id. */
export function grantGmailOperationsConnectorActions() {
  seedConnectorActionRegistry();
  const db = getDb();
  const agents = db.prepare(`
    SELECT id FROM agents
    WHERE lower(COALESCE(template_base_id, '')) = 'gmail-operations'
  `).all();
  const grantTool = db.prepare(
    'INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)'
  );
  const grantAction = db.prepare(`
    INSERT OR IGNORE INTO agent_connector_action_grants (agent_id, action_id)
    VALUES (?, ?)
  `);
  let changes = 0;
  const tx = db.transaction(() => {
    for (const agent of agents) {
      db.prepare(`INSERT OR IGNORE INTO agent_connector_action_scopes (agent_id, mode) VALUES (?, 'allowlist')`).run(agent.id);
      for (const tool of [
        'connector_search_actions',
        'connector_get_action_guide',
        'connector_execute_action',
      ]) changes += Number(grantTool.run(agent.id, tool).changes || 0);
      for (const action of GMAIL_OPERATIONS_CONNECTOR_ACTIONS) {
        changes += Number(grantAction.run(agent.id, action.action_id).changes || 0);
      }
    }
  });
  tx();
  return changes;
}

export function grantConnectorActionsForAgent(agent) {
  const templateId = String(agent?.template_base_id || '').trim().toLowerCase();
  if (!agent?.id || templateId !== 'gmail-operations') return 0;
  seedConnectorActionRegistry();
  const insert = getDb().prepare(`
    INSERT OR IGNORE INTO agent_connector_action_grants (agent_id, action_id)
    VALUES (?, ?)
  `);
  let changes = 0;
  const tx = getDb().transaction(() => {
    getDb().prepare(`INSERT OR IGNORE INTO agent_connector_action_scopes (agent_id, mode) VALUES (?, 'allowlist')`).run(agent.id);
    for (const action of GMAIL_OPERATIONS_CONNECTOR_ACTIONS) {
      changes += Number(insert.run(agent.id, action.action_id).changes || 0);
    }
  });
  tx();
  return changes;
}

export function getConnectorActionClassification(actionId) {
  ensureConnectorActionGrantTables();
  const row = getDb().prepare(`
    SELECT risk_tier, action_family FROM connector_action_registry WHERE action_id = ?
  `).get(String(actionId || '').trim());
  return row || null;
}

export function connectorPolicyToolName(actionId) {
  const id = String(actionId || '').trim();
  return id ? `connector_action:${id}` : 'connector_execute_action';
}

/**
 * Fail closed for an action-scoped agent. Legacy agents with no action rows
 * retain their existing connector_execute_action grant until administrators
 * migrate them to action-level grants.
 */
export function assertCallerMayExecuteConnectorAction(source, actionId) {
  const id = String(actionId || '').trim();
  if (!id) return { ok: false, error: 'action_id required' };
  const caller = source ? resolveAgentFromOpenClawCallerId(source) : null;
  if (!caller) return { ok: true, legacy_unscoped: true };
  ensureConnectorActionGrantTables();
  const db = getDb();
  const scoped = db.prepare(
    'SELECT mode FROM agent_connector_action_scopes WHERE agent_id = ?'
  ).get(caller.id);
  if (!scoped) return { ok: true, legacy_unscoped: true };
  const allowed = db.prepare(`
    SELECT 1 AS ok FROM agent_connector_action_grants
    WHERE agent_id = ? AND action_id = ?
  `).get(caller.id, id);
  return allowed
    ? { ok: true, action_scoped: true, agent_id: caller.id }
    : { ok: false, action_scoped: true, agent_id: caller.id, error: `Connector action "${id}" is not granted to agent "${caller.id}"` };
}
