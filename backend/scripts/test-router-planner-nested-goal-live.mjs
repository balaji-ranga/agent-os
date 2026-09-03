import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getDb } from '../src/db/schema.js';
import { routeAgentTurn } from '../src/services/agent-turn-router.js';
import { planGoalStepsAsync } from '../src/services/agent-goal-run.js';
import { ensureTenantOpenClawAgent } from '../src/services/openclaw-tenant.js';

const ownerUserId = process.env.TEST_OWNER_USER_ID || 'ceo-bala';
const prompt = 'Create a concise launch concept for a 30-second Flolah explainer about humans and AI employees working together. Use the CEO profile tool for company context. Delegate creative ownership to Content Orchestrator. Content Orchestrator must delegate narrative development to its Story Agent, use the returned narrative to create and export a draft storyboard, then report the outcome back to COO. COO must provide the consolidated final result to the CEO. This test must demonstrate COO → Content Orchestrator → Story Agent, use ceo_profile and video_storyboard_export, and preserve the delegation trace and step outputs.';
const conn = getDb();
const agent = conn.prepare(`
  SELECT a.* FROM user_agents ua JOIN agents a ON a.id=ua.agent_id
  WHERE ua.user_id=? AND ua.enabled=1 AND a.is_coo=1 LIMIT 1
`).get(ownerUserId);
assert(agent, `No enabled COO found for ${ownerUserId}`);
const sessionId = `focused-router-plan-${randomUUID()}`;
let route;
try {
  route = await routeAgentTurn({ ownerUserId, agent, sessionId, message: prompt, history: [] });
  assert.equal(route.execution_mode, 'goal_plan', JSON.stringify(route));
  assert(route.confidence >= 0.55, `Unexpected route confidence ${route.confidence}`);
  const tenant = ensureTenantOpenClawAgent(agent, ownerUserId);
  const steps = await planGoalStepsAsync(prompt, {
    ownerUserId,
    orchestratorAgentId: tenant.openclawAgentId,
  });
  const toolNames = steps.filter((step) => step.type === 'agent_tool').map((step) => step.spec?.tool_name);
  const specialty = steps.filter((step) => step.type === 'specialty_task');
  assert(toolNames.includes('ceo_profile'), `ceo_profile missing: ${JSON.stringify(steps)}`);
  const contentOwner = specialty.find((step) => /content orchestrator/i.test(`${step.label || ''} ${step.spec?.message || ''}`));
  assert(contentOwner, `Content Orchestrator missing: ${JSON.stringify(steps)}`);
  assert(/story agent/i.test(contentOwner.spec?.message || prompt), 'Nested Story Agent requirement was lost');
  assert(/video_storyboard_export/i.test(contentOwner.spec?.message || prompt), 'Storyboard export requirement was lost');
  assert.equal(steps.at(-1)?.type, 'notify_ceo', `notify_ceo is not terminal: ${JSON.stringify(steps)}`);
  console.log(JSON.stringify({
    ok: true,
    route: { mode: route.execution_mode, confidence: route.confidence, attempts: route.decision_attempts?.length || 0 },
    steps: steps.map((step) => ({
      type: step.type,
      label: step.label,
      executor: step.spec?.tool_name || step.spec?.agent_id || step.spec?.workflow_id || null,
      message: String(step.spec?.message || '').slice(0, 500),
    })),
  }, null, 2));
} finally {
  if (route?.id) conn.prepare('DELETE FROM chat_work_units WHERE id=? AND owner_user_id=?').run(route.id, ownerUserId);
}
