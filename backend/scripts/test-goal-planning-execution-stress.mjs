/**
 * Goal planner/executor stress acceptance: simple + medium + complex +
 * invoice-artifact → human decision → safe draft-PO contract handoff.
 *
 * The live maker/checker must create every plan from the natural-language goal.
 * Execution then runs the accepted contract through real goal services. Workflows
 * and read-only tools are real; human work is completed through the same Kanban
 * continuation API used by the UI. Specialty callbacks are real by default and
 * may be simulated only when REGRESSION_GOAL_STRESS_SIMULATE_SPECIALISTS=1.
 *
 * Required tenant capabilities:
 * - an enabled COO/orchestrator
 * - ceo_profile (or status_checker), one crm_* read/status tool, one erp_* read/status tool
 * - at least two eligible specialty agents (one is enough for simple/medium)
 *
 * Usage:
 *   node scripts/test-goal-planning-execution-stress.mjs
 *
 * Env:
 *   REGRESSION_CEO_ID=<owner id>
 *   REGRESSION_GOAL_STRESS_SIMULATE_SPECIALISTS=0|1 (default 0)
 *   REGRESSION_GOAL_STRESS_KEEP_DATA=0|1 (default 0)
 *   REGRESSION_GOAL_STRESS_TIMEOUT_MS=240000
 */
import { randomUUID } from 'node:crypto';
import { initDb, getDb } from '../src/db/schema.js';
import {
  completeGoalStep,
  createGoalRun,
  createAndStartGoalRun,
  getGoalRun,
  onDelegationTerminalForGoalRun,
  onWorkflowTerminalForGoalRun,
  planGoalStepsAsync,
  respondToHumanGoalTask,
  startGoalRunExecution,
} from '../src/services/agent-goal-run.js';
import {
  listOrchestratorToolsForGoalPlan,
  listSpecialtyAgentsForGoalPlan,
} from '../src/services/goal-plan-intent.js';
import { listHumanWorkCandidates } from '../src/services/work-assignment-policy.js';
import {
  createDefinition,
  deleteDefinition,
  publishDefinition,
} from '../src/services/agent-workflow-store.js';
import { deleteMediaArtifact } from '../src/services/ceo-media-artifacts.js';

initDb();
const db = getDb();
const runTag = `goal-stress-${Date.now()}-${randomUUID().slice(0, 6)}`;
const simulateSpecialists = String(process.env.REGRESSION_GOAL_STRESS_SIMULATE_SPECIALISTS || '0') === '1';
const deterministicIsolatedExecution =
  simulateSpecialists && String(process.env.REGRESSION_ISOLATED_USER || '') === '1';
const keepData = String(process.env.REGRESSION_GOAL_STRESS_KEEP_DATA || '0') === '1';
const cleanupOnly = String(process.env.REGRESSION_GOAL_STRESS_CLEANUP_ONLY || '0') === '1';
const timeoutMs = Math.max(30000, Number(process.env.REGRESSION_GOAL_STRESS_TIMEOUT_MS) || 240000);
const createdGoalIds = [];
const createdWorkflowIds = [];
const createdAgentIds = [];
let createdHumanId = null;

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function pickOwner() {
  const ownerOverride = String(process.env.REGRESSION_CEO_ID || '').trim();
  return (
    (ownerOverride && db.prepare("SELECT id,email,name FROM platform_users WHERE id=? AND role='ceo' AND enabled=1").get(ownerOverride)) ||
    db.prepare("SELECT id,email,name FROM platform_users WHERE role='ceo' AND enabled=1 ORDER BY CASE WHEN id LIKE 'ceo-demo-brightbox%' THEN 0 ELSE 1 END,id LIMIT 1").get()
  );
}

function pickOrchestrator(ownerUserId) {
  return (
    db.prepare(`SELECT a.id,a.name,a.openclaw_agent_id FROM agents a
      JOIN user_agents ua ON ua.agent_id=a.id AND ua.user_id=? AND ua.enabled=1
      WHERE (COALESCE(a.is_coo,0)=1 OR lower(COALESCE(a.role,'')) LIKE '%chief operating%')
      ORDER BY COALESCE(a.is_coo,0) DESC LIMIT 1`).get(ownerUserId) ||
    db.prepare(`SELECT a.id,a.name,a.openclaw_agent_id FROM agents a
      JOIN user_agents ua ON ua.agent_id=a.id AND ua.user_id=? AND ua.enabled=1
      WHERE COALESCE(a.is_orchestrator,0)=1 LIMIT 1`).get(ownerUserId)
  );
}

function ensureHuman(ownerUserId) {
  const existing = listHumanWorkCandidates(ownerUserId)[0];
  if (existing?.id) return existing;
  const id = `reg-human-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  db.prepare(`INSERT INTO platform_users
    (id,email,password_hash,name,role,enabled,owner_user_id,department,role_title,specialty,purpose)
    VALUES (?,?,?,?,?,1,?,?,?,?,?)`).run(
      id,
      `${id}@example.invalid`,
      'regression-only-no-login',
      'Regression Human Reviewer',
      'org_user',
      ownerUserId,
      'Operations',
      'Human Quality Reviewer',
      'Review evidence and make bounded approve or reject decisions',
      'Regression-only human-in-the-loop validation'
    );
  createdHumanId = id;
  const row = listHumanWorkCandidates(ownerUserId).find((item) => item.id === id);
  assert(row, 'temporary human was not eligible under work-assignment policy');
  return row;
}

function createCapabilityFixtureAgent(ownerUserId, orchestratorId, suffix, name, role, department) {
  const id = `reg-agent-${runTag}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
  db.prepare(`INSERT INTO agents
    (id,name,role,parent_id,openclaw_agent_id,is_coo,is_orchestrator,agent_type,owner_user_id,department,planning_status)
    VALUES (?,?,?,?,?,0,0,'custom',?,?,'production')`).run(
      id, name, role, orchestratorId, id, ownerUserId, department
    );
  db.prepare('INSERT INTO user_agents(user_id,agent_id,enabled) VALUES(?,?,1)').run(ownerUserId, id);
  createdAgentIds.push(id);
}

function ensureStressCapabilityAgents(ownerUserId, orchestratorId, agents) {
  const isolated = String(process.env.REGRESSION_ISOLATED_USER || '') === '1';
  const requirements = [
    { terms: ['tech', 'research', 'analysis'], suffix: 'research', name: 'Regression Research Analyst', role: 'Market and technical research analysis', department: 'Research' },
    { terms: ['crm', 'sales'], suffix: 'crm', name: 'Regression CRM Specialist', role: 'CRM sales operations and customer records', department: 'Sales' },
    { terms: ['erp', 'finance', 'operations'], suffix: 'erp', name: 'Regression ERP Specialist', role: 'ERP procurement finance operations', department: 'Finance' },
    { terms: ['invoice', 'accounts', 'finance'], suffix: 'invoice', name: 'Regression Invoice Specialist', role: 'Invoice and accounts finance review', department: 'Finance' },
  ];
  for (const requirement of requirements) {
    if (isolated || !selectAgentByCapability(agents, requirement.terms)) {
      createCapabilityFixtureAgent(ownerUserId, orchestratorId, requirement.suffix, requirement.name, requirement.role, requirement.department);
    }
  }
}

function triggerNode(phrase) {
  return {
    id: 'trigger-1',
    type: 'trigger',
    position: { x: 40, y: 100 },
    data: {
      label: 'Start regression workflow',
      triggerModes: ['manual', 'chat'],
      chatPhrase: phrase,
      outputs: [{ id: 'trigger_input', label: 'Trigger payload' }],
    },
  };
}

function apiNode() {
  return {
    id: 'api-health',
    type: 'api',
    position: { x: 300, y: 100 },
    data: {
      label: 'Read Flolah API health',
      inputBindings: [
        { id: 'url', label: 'URL', mode: 'static', value: 'https://login.flolah.cloud/api/health' },
        { id: 'headers', label: 'Headers', mode: 'static', value: '{"Accept":"application/json"}' },
      ],
      outputs: [
        { id: 'status', label: 'HTTP status' },
        { id: 'body', label: 'Response body' },
        { id: 'ok', label: 'Success' },
      ],
      taskConfig: { method: 'GET', authType: 'none', timeoutMs: 30000, timeoutAction: 'fail', defaultTimeoutOutput: '{}' },
    },
  };
}

function createFixtureWorkflow(ownerUserId, kind) {
  const id = `reg-${runTag}-${kind}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
  const phrase = `run ${runTag} ${kind}`;
  const isApi = kind === 'complex-api';
  createDefinition({
    id,
    name: `Regression ${kind} ${runTag}`,
    description: isApi
      ? 'Regression-only workflow that performs a safe read-only Flolah health API request.'
      : 'Regression-only workflow used to prove human handoff continuation.',
    ownerUserId,
    actor: { id: 'regression', name: 'Goal stress regression' },
    trigger_modes: ['manual', 'chat'],
    chat_trigger_phrase: phrase,
    graph: {
      nodes: isApi ? [triggerNode(phrase), apiNode()] : [triggerNode(phrase)],
      edges: isApi ? [{ id: 'trigger-to-api', source: 'trigger-1', target: 'api-health' }] : [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  publishDefinition(id, ownerUserId, { id: 'regression', name: 'Goal stress regression' });
  createdWorkflowIds.push(id);
  return { id, phrase, kind };
}

function safeTool(tools, preferred, prefix) {
  const names = tools.map((item) => String(item.name || ''));
  return preferred.find((name) => names.includes(name)) || names.find((name) => name.startsWith(prefix));
}

function selectAgentByCapability(agents, capabilityTerms, excludedIds = []) {
  const excluded = new Set(excludedIds.map((id) => String(id || '').toLowerCase()));
  const terms = capabilityTerms.map((term) => String(term || '').toLowerCase()).filter(Boolean);
  const ranked = agents
    .filter((agent) => !excluded.has(String(agent.id || '').toLowerCase()))
    .map((agent) => {
      const name = String(agent.name || '').toLowerCase();
      const role = String(agent.role || '').toLowerCase();
      const score = terms.reduce(
        (total, term) => total + (name.includes(term) ? 5 : 0) + (role.includes(term) ? 2 : 0),
        0
      );
      return { agent, score };
    })
    .sort((a, b) => b.score - a.score || String(a.agent.id).localeCompare(String(b.agent.id)));
  return ranked[0]?.score > 0 ? ranked[0].agent : null;
}

function shape(steps) {
  return steps.map((step) => ({
    key: step.spec?.step_key || null,
    type: step.type,
    label: step.label,
    executor: step.spec?.tool_name || step.spec?.workflow_id || step.spec?.agent_id || step.spec?.user_id || null,
    depends_on: step.spec?.depends_on || [],
    required_inputs: step.spec?.required_inputs || [],
    produces: step.spec?.produces || [],
    rationale: step.spec?.selection_rationale || null,
  }));
}

function assertScenarioPlan(scenario, steps) {
  const types = steps.map((step) => step.type);
  const tools = steps.filter((step) => step.type === 'agent_tool').map((step) => step.spec?.tool_name);
  const workflows = steps.filter((step) => step.type === 'workflow_trigger').map((step) => step.spec?.workflow_id);
  const agents = new Set(steps.filter((step) => step.type === 'specialty_task').map((step) => step.spec?.agent_id));
  assert(types.at(-1) === 'notify_ceo', `${scenario.name}: notify_ceo must be terminal`);
  assert(tools.includes(scenario.simpleTool), `${scenario.name}: required tool ${scenario.simpleTool} missing`);
  if (scenario.crmTool) assert(tools.includes(scenario.crmTool), `${scenario.name}: CRM tool ${scenario.crmTool} missing`);
  if (scenario.erpTool) assert(tools.includes(scenario.erpTool), `${scenario.name}: ERP tool ${scenario.erpTool} missing`);
  if (scenario.workflow) assert(workflows.includes(scenario.workflow.id), `${scenario.name}: workflow ${scenario.workflow.id} missing`);
  assert(agents.size >= scenario.minAgents, `${scenario.name}: expected at least ${scenario.minAgents} specialty agent(s), got ${agents.size}`);
  if (scenario.human) {
    assert(steps.some((step) => step.type === 'human_task' && step.spec?.user_id === scenario.human.id), `${scenario.name}: bounded human step missing`);
  }
  if (scenario.requiresArtifactHandoff) {
    const humanStep = steps.find((step) => step.type === 'human_task' && step.spec?.user_id === scenario.human.id);
    const artifactInput = humanStep?.spec?.required_inputs?.find((input) => input.kind === 'artifact');
    assert(artifactInput?.source_step_key, `${scenario.name}: human step is not bound to an attachment-producing predecessor`);
    const source = steps.find((step) => step.spec?.step_key === artifactInput.source_step_key);
    assert(source?.spec?.produces?.some((output) => output.kind === 'artifact' && output.key === artifactInput.key), `${scenario.name}: attachment source contract is missing`);
  }
  for (let index = 1; index < steps.length; index += 1) {
    const step = steps[index];
    if (step.type === 'notify_ceo') assert((step.spec?.depends_on || []).length > 0, `${scenario.name}: terminal report is not dependency-bound`);
  }
}

function delegationOutput(goal, step, scenarioName) {
  const prior = goal.steps
    .filter((row) => row.step_index < step.step_index && row.status === 'completed')
    .map((row) => `${row.label}: ${JSON.stringify(row.result || {}).slice(0, 1200)}`)
    .join('\n');
  const attachment = scenarioName === 'invoice-human-po'
    ? `\nAttachment: https://login.flolah.cloud/api/health?regression_invoice_packet=${encodeURIComponent(runTag)}`
    : '';
  return `[REGRESSION ${scenarioName}] Completed the bounded specialty analysis using only this goal's original request and prior outputs. Evidence reviewed:\n${prior || 'No predecessor output was required.'}${attachment}\nResult: safe read-only validation passed; no CRM, ERP, payment, email, or external record was changed.`;
}

async function driveGoal(scenario, goalId) {
  const started = Date.now();
  const simulated = [];
  while (Date.now() - started < timeoutMs) {
    const goal = getGoalRun(goalId, scenario.ownerUserId);
    assert(goal, `${scenario.name}: goal disappeared`);
    if (goal.status === 'completed') return { goal, simulated };
    if (['failed', 'cancelled'].includes(goal.status)) {
      throw new Error(`${scenario.name}: goal ${goal.status}: ${goal.error_message || goal.steps.find((s) => s.error_message)?.error_message || 'unknown error'}`);
    }
    if (goal.status === 'awaiting_approval') throw new Error(`${scenario.name}: safe regression unexpectedly requires approval`);

    let progressed = false;
    for (const step of goal.steps) {
      if (step.step_type === 'workflow_trigger' && step.status === 'running' && step.child_workflow_run_id) {
        const run = db.prepare('SELECT status,error_message FROM agent_workflow_runs WHERE id=?').get(step.child_workflow_run_id);
        if (run && ['completed', 'failed', 'cancelled', 'timed_out'].includes(String(run.status))) {
          await onWorkflowTerminalForGoalRun(step.child_workflow_run_id);
          progressed = true;
          break;
        }
      }
      if (step.step_type === 'specialty_task' && step.status === 'running' && step.child_delegation_task_id) {
        const task = db.prepare('SELECT status,response_content,error_message FROM agent_delegation_tasks WHERE id=?').get(step.child_delegation_task_id);
        if (task && ['completed', 'failed'].includes(String(task.status))) {
          await onDelegationTerminalForGoalRun(step.child_delegation_task_id);
          progressed = true;
          break;
        }
        if (simulateSpecialists && Date.now() - started > 2500) {
          db.prepare("UPDATE agent_delegation_tasks SET status='completed',response_content=?,completed_at=datetime('now') WHERE id=?")
            .run(delegationOutput(goal, step, scenario.name), step.child_delegation_task_id);
          simulated.push(Number(step.child_delegation_task_id));
          await onDelegationTerminalForGoalRun(step.child_delegation_task_id);
          progressed = true;
          break;
        }
      }
      if (step.step_type === 'human_task' && step.status === 'running') {
        const stored = db.prepare('SELECT human_kanban_task_id FROM agent_goal_steps WHERE id=?').get(step.id);
        const humanTaskId = Number(stored?.human_kanban_task_id || 0);
        if (!humanTaskId) continue;
        await respondToHumanGoalTask({
          ownerUserId: scenario.ownerUserId,
          actorUserId: scenario.ownerUserId,
          taskId: humanTaskId,
          action: 'complete',
          outcome: `[REGRESSION ${scenario.name}] I reviewed the attached prior-step evidence and approve continuation for this read-only test. No production record creation, payment, email, or external publish is authorized.`,
        });
        progressed = true;
        break;
      }
    }
    if (!progressed && !goal.steps.some((step) => step.status === 'running')) {
      await startGoalRunExecution(goalId, { ownerUserId: scenario.ownerUserId });
      progressed = true;
    }
    await sleep(progressed ? 350 : 1200);
  }
  const last = getGoalRun(goalId, scenario.ownerUserId);
  throw new Error(`${scenario.name}: timed out after ${timeoutMs}ms (${last?.status}; ${last?.steps?.map((s) => `${s.step_index}:${s.step_type}:${s.status}`).join(', ')})`);
}

function assertExecution(scenario, goal) {
  assert(goal.status === 'completed', `${scenario.name}: goal not completed`);
  assert(goal.steps.every((step) => step.status === 'completed'), `${scenario.name}: one or more steps are not completed`);
  for (const step of goal.steps) {
    assert(step.result, `${scenario.name}: ${step.label} has no execution result`);
    const result = step.result;
    assert(result && typeof result === 'object', `${scenario.name}: ${step.label} result is not structured JSON`);
  }
  if (scenario.workflow?.kind === 'complex-api') {
    const workflowStep = goal.steps.find((step) => step.step_type === 'workflow_trigger' && step.spec?.workflow_id === scenario.workflow.id);
    assert(workflowStep?.child_workflow_run_id, `${scenario.name}: API workflow run id missing`);
    const apiStep = db.prepare(`SELECT status,output_json,error_message FROM agent_workflow_run_steps
      WHERE run_id=? AND node_id='api-health'`).get(workflowStep.child_workflow_run_id);
    assert(apiStep?.status === 'completed', `${scenario.name}: API node did not complete: ${apiStep?.error_message || apiStep?.status || 'missing'}`);
    const output = json(apiStep.output_json, {});
    assert(output.ok === true || Number(output.status) < 400, `${scenario.name}: API health call was not successful`);
  }
  if (scenario.requiresArtifactHandoff) {
    const humanStep = goal.steps.find((step) => step.step_type === 'human_task');
    const stored = db.prepare('SELECT human_kanban_task_id FROM agent_goal_steps WHERE id=?').get(humanStep?.id);
    const card = stored?.human_kanban_task_id
      ? db.prepare('SELECT description,status FROM kanban_tasks WHERE id=?').get(stored.human_kanban_task_id)
      : null;
    assert(card, `${scenario.name}: human Kanban handoff was not created`);
    assert(
      /https?:\/\/|\/api\/media\//i.test(String(card.description || '')),
      `${scenario.name}: attachment URL was not carried into the human task`
    );
    assert(card.status === 'completed', `${scenario.name}: human decision did not complete through Kanban continuity`);
  }
}

function deleteGoalArtifacts(goalId) {
  try {
    const media = db.prepare("SELECT id,owner_user_id FROM ceo_media_artifacts WHERE meta_json LIKE ?").all(`%\"goal_run_id\":\"${goalId}\"%`);
    for (const item of media) deleteMediaArtifact(item.owner_user_id, item.id);
  } catch {}
  const taskIds = db.prepare('SELECT id FROM kanban_tasks WHERE goal_run_id=?').all(goalId).map((row) => row.id);
  const delegationIds = db.prepare('SELECT child_delegation_task_id AS id FROM agent_goal_steps WHERE goal_run_id=? AND child_delegation_task_id IS NOT NULL').all(goalId).map((row) => row.id);
  for (const taskId of taskIds) db.prepare('DELETE FROM task_messages WHERE task_id=?').run(taskId);
  db.prepare('DELETE FROM kanban_tasks WHERE goal_run_id=?').run(goalId);
  for (const id of delegationIds) db.prepare('DELETE FROM agent_delegation_tasks WHERE id=?').run(id);
  for (const table of ['goal_action_approvals', 'goal_mission_events']) {
    try { db.prepare(`DELETE FROM ${table} WHERE goal_run_id=?`).run(goalId); } catch {}
  }
  try { db.prepare("DELETE FROM platform_user_notifications WHERE source_key LIKE ?").run(`%${goalId}%`); } catch {}
  try { db.prepare("DELETE FROM chat_turns WHERE content LIKE ?").run(`%${goalId}%`); } catch {}
  db.prepare('DELETE FROM agent_goal_steps WHERE goal_run_id=?').run(goalId);
  db.prepare('DELETE FROM agent_goal_runs WHERE id=?').run(goalId);
}

async function cleanup(ownerUserId) {
  if (keepData) return;
  for (const goalId of createdGoalIds) deleteGoalArtifacts(goalId);
  for (const workflowId of createdWorkflowIds) {
    try { deleteDefinition(workflowId, ownerUserId, { id: 'regression', name: 'Goal stress regression' }); } catch {}
  }
  if (createdHumanId) {
    try { db.prepare('DELETE FROM platform_users WHERE id=? AND owner_user_id=?').run(createdHumanId, ownerUserId); } catch {}
  }
  for (const agentId of createdAgentIds) {
    try { db.prepare('DELETE FROM agent_tool_grants WHERE agent_id=?').run(agentId); } catch {}
    try { db.prepare('DELETE FROM user_agents WHERE user_id=? AND agent_id=?').run(ownerUserId, agentId); } catch {}
    try { db.prepare('DELETE FROM agents WHERE id=? AND owner_user_id=?').run(agentId, ownerUserId); } catch {}
  }
}

async function driveIsolatedGoal(scenario, goalId) {
  const simulated = [];
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const goal = getGoalRun(goalId, scenario.ownerUserId);
    assert(goal, `${scenario.name}: goal disappeared`);
    if (goal.status === 'completed') return { goal, simulated };
    if (['failed', 'cancelled'].includes(goal.status)) {
      throw new Error(`${scenario.name}: isolated goal ${goal.status}: ${goal.error_message || 'unknown error'}`);
    }
    const step = goal.steps.find((row) => row.status === 'pending' || row.status === 'running');
    assert(step, `${scenario.name}: isolated goal has no executable step`);
    if (step.step_type === 'workflow_trigger') {
      if (step.status === 'pending') await startGoalRunExecution(goalId, { ownerUserId: scenario.ownerUserId });
      const refreshed = getGoalRun(goalId, scenario.ownerUserId).steps.find((row) => row.id === step.id);
      if (refreshed?.child_workflow_run_id) {
        const run = db.prepare('SELECT status,error_message FROM agent_workflow_runs WHERE id=?').get(refreshed.child_workflow_run_id);
        if (run && ['completed', 'failed', 'cancelled', 'timed_out'].includes(String(run.status))) {
          await onWorkflowTerminalForGoalRun(refreshed.child_workflow_run_id);
        }
      }
    } else if (step.step_type === 'human_task') {
      if (step.status === 'pending') await startGoalRunExecution(goalId, { ownerUserId: scenario.ownerUserId });
      const refreshed = getGoalRun(goalId, scenario.ownerUserId).steps.find((row) => row.id === step.id);
      const stored = db.prepare('SELECT human_kanban_task_id FROM agent_goal_steps WHERE id=?').get(refreshed?.id);
      const humanTaskId = Number(stored?.human_kanban_task_id || 0);
      if (humanTaskId) {
        await respondToHumanGoalTask({
          ownerUserId: scenario.ownerUserId,
          actorUserId: scenario.ownerUserId,
          taskId: humanTaskId,
          action: 'complete',
          outcome: `[REGRESSION ${scenario.name}] Reviewed the attached typed evidence and approved continuation of this isolated, read-only contract test.`,
        });
      }
    } else {
      const result = step.step_type === 'specialty_task'
        ? { ok: true, simulated_isolated_specialist: true, response_content: delegationOutput(goal, step, scenario.name) }
        : step.step_type === 'agent_tool'
          ? { ok: true, simulated_isolated_tool: true, tool_name: step.spec?.tool_name, result: { regression: true, read_only: true } }
          : { ok: true, simulated_isolated_step: true, outcome: `Completed ${step.label} for isolated regression.` };
      await completeGoalStep({
        goalRunId: goalId,
        stepId: step.id,
        ownerUserId: scenario.ownerUserId,
        result,
      });
      simulated.push(step.id);
    }
    await sleep(250);
  }
  throw new Error(`${scenario.name}: isolated execution timed out after ${timeoutMs}ms`);
}

async function cleanupInterruptedRegressionData(ownerUserId) {
  if (keepData) return { goals: 0, workflows: 0, humans: 0 };
  const staleGoalIds = db.prepare(`SELECT id FROM agent_goal_runs
    WHERE owner_user_id=? AND source LIKE 'regression-goal-stress:%'`).all(ownerUserId).map((row) => row.id);
  const staleWorkflowIds = db.prepare(`SELECT id FROM agent_workflow_definitions
    WHERE owner_user_id=? AND id LIKE 'reg-goal-stress-%'`).all(ownerUserId).map((row) => row.id);
  const staleHumanIds = db.prepare(`SELECT id FROM platform_users
    WHERE owner_user_id=? AND id LIKE 'reg-human-%'`).all(ownerUserId).map((row) => row.id);
  const staleAgentIds = db.prepare(`SELECT id FROM agents
    WHERE owner_user_id=? AND id LIKE 'reg-agent-goal-stress-%'`).all(ownerUserId).map((row) => row.id);
  for (const goalId of staleGoalIds) deleteGoalArtifacts(goalId);
  for (const workflowId of staleWorkflowIds) {
    try { deleteDefinition(workflowId, ownerUserId, { id: 'regression', name: 'Goal stress regression cleanup' }); } catch {}
  }
  for (const humanId of staleHumanIds) {
    try { db.prepare('DELETE FROM platform_users WHERE id=? AND owner_user_id=?').run(humanId, ownerUserId); } catch {}
  }
  for (const agentId of staleAgentIds) {
    try { db.prepare('DELETE FROM agent_tool_grants WHERE agent_id=?').run(agentId); } catch {}
    try { db.prepare('DELETE FROM user_agents WHERE user_id=? AND agent_id=?').run(ownerUserId, agentId); } catch {}
    try { db.prepare('DELETE FROM agents WHERE id=? AND owner_user_id=?').run(agentId, ownerUserId); } catch {}
  }
  return { goals: staleGoalIds.length, workflows: staleWorkflowIds.length, humans: staleHumanIds.length, agents: staleAgentIds.length };
}

async function main() {
  const owner = pickOwner();
  assert(owner?.id, 'No enabled CEO found (set REGRESSION_CEO_ID)');
  const interruptedCleanup = await cleanupInterruptedRegressionData(owner.id);
  if (cleanupOnly) {
    console.log('GOAL_PLANNING_EXECUTION_STRESS_CLEANUP_OK', JSON.stringify({ owner_user_id: owner.id, removed: interruptedCleanup }));
    return;
  }
  const orchestrator = pickOrchestrator(owner.id);
  assert(orchestrator?.id, `No enabled COO/orchestrator is entitled to ${owner.id}`);
  const orchestratorId = orchestrator.openclaw_agent_id || orchestrator.id;
  const tools = listOrchestratorToolsForGoalPlan(owner.id, orchestratorId);
  const simpleTool = safeTool(tools, ['ceo_profile', 'status_checker'], '');
  const crmTool = safeTool(tools, ['crm_status', 'crm_list_tasks', 'crm_list_companies'], 'crm_');
  const erpTool = safeTool(tools, ['erp_status', 'erp_list_invoices', 'erp_list_purchase_orders'], 'erp_');
  assert(simpleTool, 'No safe read-only profile/status tool is available to the orchestrator');
  assert(crmTool, 'No CRM tool is available to the orchestrator');
  assert(erpTool, 'No ERP tool is available to the orchestrator');
  let agents = (await listSpecialtyAgentsForGoalPlan(owner.id, orchestratorId)).filter((agent) => String(agent.id).toLowerCase() !== String(orchestrator.id).toLowerCase());
  ensureStressCapabilityAgents(owner.id, orchestrator.id, agents);
  agents = (await listSpecialtyAgentsForGoalPlan(owner.id, orchestratorId)).filter((agent) => String(agent.id).toLowerCase() !== String(orchestrator.id).toLowerCase());
  assert(agents.length >= 2, `Need two eligible specialty agents for stress coverage; found ${agents.length}`);
  const researchAgent = selectAgentByCapability(agents, ['tech', 'research', 'analysis']);
  const crmAgent = selectAgentByCapability(agents, ['crm', 'sales']);
  const erpAgent = selectAgentByCapability(agents, ['erp', 'finance', 'operations'], [crmAgent?.id]);
  const invoiceAgent = selectAgentByCapability(agents, ['invoice', 'accounts', 'finance']);
  assert(researchAgent, 'No research/analysis specialist is available for simple and medium coverage');
  assert(crmAgent, 'No CRM/sales specialist is available for complex coverage');
  assert(erpAgent, 'No distinct ERP/finance specialist is available for complex coverage');
  assert(invoiceAgent, 'No invoice/finance specialist is available for artifact handoff coverage');
  const human = ensureHuman(owner.id);
  const mediumWorkflow = createFixtureWorkflow(owner.id, 'medium-handoff');
  const complexWorkflow = createFixtureWorkflow(owner.id, 'complex-api');
  const poDraftWorkflow = createFixtureWorkflow(owner.id, 'po-draft-contract');
  const invoiceTool = safeTool(tools, ['erp_list_purchase_invoices', 'erp_list_sales_invoices', erpTool], 'erp_list_');
  assert(invoiceTool, 'No safe read-only ERP invoice tool is available to the orchestrator');

  const common = { ownerUserId: owner.id, orchestratorAgentId: orchestratorId, simpleTool };
  const scenarios = [
    {
      ...common,
      name: 'simple',
      minAgents: 1,
      prompt: `Regression goal ${runTag}: Call the exact read-only tool ${simpleTool}. Pass that tool result to the exact specialist agent ${researchAgent.id} (${researchAgent.name}) for a concise factual interpretation, then send the completed outcome to the CEO. Do not modify records, send email, publish externally, or ask for approval.`,
    },
    {
      ...common,
      name: 'medium',
      minAgents: 1,
      workflow: mediumWorkflow,
      human,
      prompt: `Regression goal ${runTag}: Run the published trigger-only workflow with exact catalog id ${mediumWorkflow.id} and exact phrase "${mediumWorkflow.phrase}". Treat its terminal status and summary as structured completion data, not as a file or artifact. Give that completion data to exact specialist ${researchAgent.id} (${researchAgent.name}) to prepare bounded review data. Then assign only the approve-or-reject decision on that data to human ${human.id} (${human.name}). After the human decision, call ${simpleTool} as a safe verification and send the complete result to the CEO. No external message or record mutation.`,
    },
    {
      ...common,
      name: 'complex',
      minAgents: 2,
      workflow: complexWorkflow,
      human,
      crmTool,
      erpTool,
      prompt: `Regression goal ${runTag}: Build and execute a read-only cross-company assurance. First call exact CRM tool ${crmTool} and exact ERP tool ${erpTool}. Run the published workflow with exact catalog id ${complexWorkflow.id} and exact phrase "${complexWorkflow.phrase}"; that workflow must perform the Flolah health API GET. Give the CRM evidence to exact specialist ${crmAgent.id} (${crmAgent.name}) and the ERP plus API/workflow evidence to distinct exact specialist ${erpAgent.id} (${erpAgent.name}). Preserve typed prior outputs between every dependent step. Then assign human ${human.id} (${human.name}) only a bounded approve-or-reject decision over the consolidated evidence. After that decision, call ${simpleTool} for final safe verification and send an outcome-rich terminal report to the CEO containing tool, API, workflow, both agent, and human outcomes. This is read-only: do not create or update CRM/ERP records, POs, invoices, payments, emails, or external publications.`,
    },
    {
      ...common,
      name: 'invoice-human-po',
      minAgents: 1,
      human,
      workflow: poDraftWorkflow,
      erpTool: invoiceTool,
      requiresArtifactHandoff: true,
      prompt: `Regression goal ${runTag}: Call exact read-only ERP invoice tool ${invoiceTool} to retrieve one invoice candidate without changing ERP. Give that ERP result to exact specialist ${invoiceAgent.id} (${invoiceAgent.name}) to prepare a bounded invoice approval packet as a real clickable attachment URL; the specialty step must declare and return that packet as an artifact. If ERP returns zero invoices, the truthful packet must document the empty result and recommend that the human reject production PO creation; zero results are valid evidence and must not trigger clarification or invented invoice data. Pass only that attachment and its verified ERP facts to human ${human.id} (${human.name}) for an approve-or-reject purchase-order decision. After that bounded human review, run the published regression-only draft-PO contract workflow with exact catalog id ${poDraftWorkflow.id} and exact phrase "${poDraftWorkflow.phrase}" to validate the downstream PO payload shape without creating or submitting an ERP document. Then call ${simpleTool} for final safe verification and report the ERP evidence, attachment, human decision, and draft-PO contract validation outcome to the CEO. Do not mutate CRM/ERP, send email, pay, submit, or publish.`,
    },
  ];

  console.log('[goal-stress] tenant', {
    owner: owner.id,
    orchestrator: orchestratorId,
    tools: { simpleTool, crmTool, erpTool, invoiceTool },
    agents: { research: researchAgent.id, crm: crmAgent.id, erp: erpAgent.id, invoice: invoiceAgent.id },
    human: human.id,
  });
  console.log('[goal-stress] planning 4 goals concurrently');
  const planned = await Promise.all(scenarios.map(async (scenario) => {
    const steps = await planGoalStepsAsync(scenario.prompt, {
      ownerUserId: owner.id,
      orchestratorAgentId: orchestratorId,
    });
    assertScenarioPlan(scenario, steps);
    console.log(`[goal-stress] ${scenario.name} plan`, JSON.stringify(shape(steps), null, 2));
    return { scenario, steps };
  }));

  console.log('[goal-stress] executing 4 accepted plans concurrently');
  const started = await Promise.all(planned.map(async ({ scenario, steps }) => {
    const out = deterministicIsolatedExecution ? createGoalRun({
      ownerUserId: owner.id,
      agentId: orchestratorId,
      orchestratorAgentId: orchestratorId,
      title: `[REGRESSION] ${scenario.name} goal stress ${runTag}`,
      prompt: scenario.prompt,
      steps,
      source: `regression-goal-stress:${runTag}:${scenario.name}`,
      context: { regression: true, run_tag: runTag, scenario: scenario.name, deterministic_isolated_execution: true },
    }) : await createAndStartGoalRun({
      ownerUserId: owner.id,
      agentId: orchestratorId,
      orchestratorAgentId: orchestratorId,
      title: `[REGRESSION] ${scenario.name} goal stress ${runTag}`,
      prompt: scenario.prompt,
      steps,
      source: `regression-goal-stress:${runTag}:${scenario.name}`,
      context: { regression: true, run_tag: runTag, scenario: scenario.name },
    });
    const goalId = deterministicIsolatedExecution ? out.id : out.goal_run_id;
    createdGoalIds.push(goalId);
    return { scenario, goalId };
  }));
  const settled = await Promise.allSettled(started.map(async ({ scenario, goalId }) => {
    const result = deterministicIsolatedExecution
      ? await driveIsolatedGoal(scenario, goalId)
      : await driveGoal(scenario, goalId);
    assertExecution(scenario, result.goal);
    return {
      scenario: scenario.name,
      goal_run_id: goalId,
      duration_ms: Date.now() - new Date(result.goal.created_at).getTime(),
      simulated_specialty_callbacks: result.simulated,
      steps: result.goal.steps.map((step) => ({ index: step.step_index, type: step.step_type, label: step.label, status: step.status })),
    };
  }));
  const failures = settled
    .map((result, index) => result.status === 'rejected' ? `${started[index].scenario.name}: ${result.reason?.message || result.reason}` : null)
    .filter(Boolean);
  if (failures.length) throw new Error(`Goal stress failures:\n- ${failures.join('\n- ')}`);
  const completed = settled.map((result) => result.value);

  assert(new Set(completed.map((item) => item.goal_run_id)).size === 4, 'concurrent goals lost execution isolation');
  console.log('GOAL_PLANNING_EXECUTION_STRESS_OK', JSON.stringify({
    run_tag: runTag,
    owner_user_id: owner.id,
    orchestrator_agent_id: orchestratorId,
    simulate_specialists: simulateSpecialists,
    deterministic_isolated_execution: deterministicIsolatedExecution,
    scenarios: completed,
  }, null, 2));
}

let ownerForCleanup = null;
try {
  ownerForCleanup = pickOwner()?.id || null;
  await main();
} finally {
  if (ownerForCleanup) await cleanup(ownerForCleanup);
}
