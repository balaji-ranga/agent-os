import { getDb } from '../db/schema.js';
import { isUserEnabled } from './user-enabled.js';
import { evaluateActionPolicy, previewActionPolicy } from './action-policy.js';
import { assertCallerMayExecuteConnectorAction, ensureConnectorActionGrantTables } from './connector-action-grants.js';
import { createCopilotConnector, COPILOT_ACTIONS, copilotBridgeError } from './digital-adoption-connector-core.js';
import { attachOrgFieldsToAuthUser, hasPermission } from './org-permissions.js';
import { createHash } from 'node:crypto';
const overrideFingerprint = row => row && createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'use_count').sort(([a], [b]) => a.localeCompare(b))))).digest('hex');
export { COPILOT_ACTIONS };
export const copilotConfigured = () => !!process.env.DIGITAL_ADOPTION_BRIDGE_URL && !!process.env.DIGITAL_ADOPTION_BRIDGE_TOKEN;
let current;
function bridgeConfig() {
  const url = new URL(process.env.DIGITAL_ADOPTION_BRIDGE_URL),
    token = process.env.DIGITAL_ADOPTION_BRIDGE_TOKEN;
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || typeof token !== 'string' || token.length < 40) throw new Error('Copilot bridge is not configured');
  return {
    url,
    token
  };
}
function registry() {
  ensureConnectorActionGrantTables();
  const put = getDb().prepare('INSERT INTO connector_action_registry(action_id,risk_tier,action_family,description) VALUES (?,?,?,?) ON CONFLICT(action_id) DO UPDATE SET risk_tier=excluded.risk_tier,action_family=excluded.action_family,description=excluded.description');
  for (const a of COPILOT_ACTIONS) put.run(a.id, a.risk_tier, a.action_family, a.description);
}
const policyName = (id, context) => {
  const tiers = {
    read: 'R0',
    write_internal: 'R1',
    communicate_external: 'R2',
    financial_destructive: 'R3'
  };
  return id === 'digital_adoption.submit' && tiers[context.effectFamily] ? `copilot_bound_action|${tiers[context.effectFamily]}|${context.effectFamily}|${id}` : `connector_action:${id}`;
};
export function copilotConnector() {
  if (current) return current;
  registry();
  current = createCopilotConnector({
    bridge: async (path, input) => {
      const {
        url,
        token
      } = bridgeConfig();
      const res = await fetch(new URL(path, url), {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(input)
      });
      const result = await res.json();
      if (!res.ok) throw Object.assign(new Error(copilotBridgeError(result.code)), {
        status: res.status
      });
      return result;
    },
    entitled: (user, context) => {
      if (!isUserEnabled(user)) return false;
      const row = getDb().prepare('SELECT * FROM platform_users WHERE id=?').get(user),
        actor = attachOrgFieldsToAuthUser({
          ...row
        });
      if (!hasPermission(actor, 'workflows')) return false;
      if (context.ownerUserId && context.ownerUserId !== user && row.owner_user_id !== context.ownerUserId) return false;
      if (context.runId) {
        const run = getDb().prepare('SELECT owner_user_id,definition_id,status FROM agent_workflow_runs WHERE id=?').get(context.runId);
        if (!run || run.owner_user_id !== (context.ownerUserId || user) || run.definition_id !== context.workflowId || !['running', 'in_progress', 'pending'].includes(run.status)) return false;
      }
      return true;
    },
    grant: (source, id) => {
      const result = assertCallerMayExecuteConnectorAction(source, id);
      if (!result.ok) throw Object.assign(new Error('COPILOT_ACTION_NOT_GRANTED'), {
        status: 403
      });
    },
    policy: (user, id, body, context) => {
      const toolName = policyName(id, context);
      const decision = evaluateActionPolicy({
        ownerUserId: context.ownerUserId || user,
        toolName,
        body,
        context: {
          workflowId: context.workflowId,
          agentId: context.source
        }
      });
      const override = decision.override_id && getDb().prepare('SELECT * FROM action_policy_overrides WHERE id=? AND owner_user_id=?').get(decision.override_id, context.ownerUserId || user);
      return {
        ...decision,
        override_fingerprint: overrideFingerprint(override),
        override_use_count: override?.use_count,
        tool_name: toolName
      };
    },
    preview: (user, id, body, context, decision) => {
      const current = previewActionPolicy({
        ownerUserId: context.ownerUserId || user,
        toolName: policyName(id, context),
        body,
        context: {
          workflowId: context.workflowId,
          agentId: context.source
        }
      });
      if (!decision.override_id) return current;
      const row = getDb().prepare('SELECT * FROM action_policy_overrides WHERE id=? AND owner_user_id=?').get(decision.override_id, context.ownerUserId || user);
      if (!row || !row.enabled || row.expires_at && Date.parse(row.expires_at) <= Date.now() || overrideFingerprint(row) !== decision.override_fingerprint || row.use_count < decision.override_use_count || current.risk_tier !== decision.risk_tier || current.action_family !== decision.action_family || current.override_id && current.override_id !== row.id) return {
        ...current,
        ok: false
      };
      // The exact command already consumed this bounded use. Exhausting its
      // counter must not revoke that same command halfway through fan-out.
      // A changed/disabled/expired override or classification still revokes it.
      if (!current.override_id && row.max_uses != null && row.use_count >= row.max_uses) return {
        ...current,
        ok: true,
        mode: row.mode
      };
      return current;
    },
    approvalActive: decision => {
      if (!decision.approval_grant_id) return true;
      const g = getDb().prepare('SELECT revoked_at,expires_at FROM action_approval_grants WHERE id=?').get(decision.approval_grant_id);
      return !!g && !g.revoked_at && Date.parse(g.expires_at) > Date.now();
    }
  });
  return current;
}
