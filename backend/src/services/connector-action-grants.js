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
  `);
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
    'SELECT COUNT(*) AS n FROM agent_connector_action_grants WHERE agent_id = ?'
  ).get(caller.id);
  if (!Number(scoped?.n || 0)) return { ok: true, legacy_unscoped: true };
  const allowed = db.prepare(`
    SELECT 1 AS ok FROM agent_connector_action_grants
    WHERE agent_id = ? AND action_id = ?
  `).get(caller.id, id);
  return allowed
    ? { ok: true, action_scoped: true, agent_id: caller.id }
    : { ok: false, action_scoped: true, agent_id: caller.id, error: `Connector action "${id}" is not granted to agent "${caller.id}"` };
}
