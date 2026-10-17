import { getDb } from '../db/schema.js';
import { isUserEnabled } from './user-enabled.js';
import { evaluateActionPolicy, previewActionPolicy } from './action-policy.js';
import { assertCallerMayExecuteConnectorAction, ensureConnectorActionGrantTables } from './connector-action-grants.js';
import { createCopilotConnector, COPILOT_ACTIONS } from './digital-adoption-connector-core.js';
import { attachOrgFieldsToAuthUser, hasPermission } from './org-permissions.js';
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
      if (!res.ok) throw Object.assign(new Error(result.code || 'COPILOT_BRIDGE_UNAVAILABLE'), {
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
      return {
        ...evaluateActionPolicy({
          ownerUserId: context.ownerUserId || user,
          toolName,
          body,
          context: {
            workflowId: context.workflowId,
            agentId: context.source
          }
        }),
        tool_name: toolName
      };
    },
    preview: (user, id, body, context) => previewActionPolicy({
      ownerUserId: context.ownerUserId || user,
      toolName: policyName(id, context),
      body,
      context: {
        workflowId: context.workflowId,
        agentId: context.source
      }
    }),
    approvalActive: decision => {
      if (!decision.approval_grant_id) return true;
      const g = getDb().prepare('SELECT revoked_at,expires_at FROM action_approval_grants WHERE id=?').get(decision.approval_grant_id);
      return !!g && !g.revoked_at && Date.parse(g.expires_at) > Date.now();
    }
  });
  return current;
}
