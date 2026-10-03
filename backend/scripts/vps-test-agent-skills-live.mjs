import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/db/schema.js';
import { createSession, revokeSession } from '../src/services/auth/session.js';
import { setAgentSkillAssignments } from '../src/services/agent-skills.js';
import { routeAgentTurn } from '../src/services/agent-turn-router.js';
import { qualityAssureGoalPlan } from '../src/services/goal-plan-quality.js';

const baseUrl = String(process.env.AGENT_SKILLS_TEST_BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const ownerUserId = process.env.AGENT_SKILLS_TEST_OWNER || 'ceo-bala';
const agentId = process.env.AGENT_SKILLS_TEST_AGENT || 'marketing-specialist';
const skillId = process.env.AGENT_SKILLS_TEST_SKILL || 'platform:marketing-lead-intelligence';
const orchestratorAgentId = process.env.AGENT_SKILLS_TEST_ORCHESTRATOR || 'balserve';
const selectionOnly = ['1', 'true'].includes(String(process.env.AGENT_SKILLS_TEST_SELECTION_ONLY || '').toLowerCase());
const db = getDb();
const owner = db.prepare(`SELECT id FROM platform_users WHERE id=? AND enabled=1 AND role='ceo'`).get(ownerUserId);
const agent = db.prepare(`SELECT a.* FROM agents a JOIN user_agents ua ON ua.agent_id=a.id AND ua.user_id=? AND ua.enabled=1 WHERE a.id=?`).get(ownerUserId, agentId);
const orchestrator = db.prepare(`SELECT a.* FROM agents a JOIN user_agents ua ON ua.agent_id=a.id AND ua.user_id=? AND ua.enabled=1 WHERE a.id=?`).get(ownerUserId, orchestratorAgentId);
assert.ok(owner, `enabled CEO not found: ${ownerUserId}`);
assert.ok(agent, `entitled agent not found: ${agentId}`);
assert.ok(orchestrator, `entitled orchestrator not found: ${orchestratorAgentId}`);

const session = createSession(ownerUserId, { userAgent: 'vps-agent-skills-live-test' });
const request = async (method, path, body, timeoutMs = 30_000) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${data.error || JSON.stringify(data).slice(0, 300)}`);
  return data;
};

let previousAssignments = [];
let assignmentsCaptured = false;
let restored = false;
let routerWorkUnitId = null;
try {
  const before = await request('GET', `/api/agents/${encodeURIComponent(agentId)}/skills`);
  assert.ok(before.skills.some((skill) => skill.id === skillId), 'platform skill missing from tenant-visible catalog');
  previousAssignments = (before.assignments || []).map((row) => ({
    skill_id: row.skill_id,
    version_id: row.version_id,
    enabled: row.enabled,
    priority: row.priority,
    auto_select: row.auto_select,
  }));
  assignmentsCaptured = true;
  const selected = before.skills.find((skill) => skill.id === skillId);
  const testAssignments = [
    ...previousAssignments.filter((row) => row.skill_id !== skillId),
    { skill_id: skillId, version_id: selected.version_id, enabled: true, auto_select: true, priority: 1 },
  ];
  const saved = await request('PUT', `/api/agents/${encodeURIComponent(agentId)}/skills`, { assignments: testAssignments }, 60_000);
  const assigned = saved.assignments.find((row) => row.skill_id === skillId);
  assert.equal(assigned?.ready, true, `skill is not execution-ready: ${JSON.stringify(assigned)}`);
  assert.ok(saved.runtime?.workspacePath, 'assignment did not synchronize an employee workspace');
  const skillPath = join(saved.runtime.workspacePath, 'skills', assigned.slug, 'SKILL.md');
  assert.ok(existsSync(skillPath), `materialized SKILL.md missing: ${skillPath}`);
  assert.match(readFileSync(skillPath, 'utf8'), /marketing|lead/i);

  const selectionPrompt = 'Delegate one bounded read-only deliverable to the employee best matched by the assigned marketing-lead-intelligence skill: provide a concise method for researching and qualifying one target account. Do not access or change business data.';
  const route = await routeAgentTurn({
    ownerUserId,
    agent: orchestrator,
    sessionId: `vps-agent-skills-router-${Date.now()}`,
    message: selectionPrompt,
  });
  routerWorkUnitId = route.id;
  assert.equal(route.execution_mode, 'delegate', `router did not choose a bounded specialist delegation: ${JSON.stringify(route)}`);
  assert.equal(route.target_agent_id, agentId, `router did not select the skill-matched employee: ${JSON.stringify(route)}`);

  const plan = await qualityAssureGoalPlan({
    ownerUserId,
    orchestratorAgentId,
    prompt: `${selectionPrompt} Use the employee whose assigned operating skill is the closest match, and report the result to the CEO.`,
    candidateSteps: [],
  });
  const selectedStep = (plan.steps || []).find((step) => step.type === 'specialty_task' && step.spec?.agent_id === agentId);
  assert.ok(selectedStep, `planner did not select the skill-matched employee: ${JSON.stringify(plan.steps || [])}`);
  const pinnedSkill = (selectedStep.spec?.skill_refs || []).find((ref) => ref.skill_id === skillId);
  assert.ok(pinnedSkill, `planner did not pin the matching assigned skill: ${JSON.stringify(selectedStep.spec || {})}`);
  assert.equal(pinnedSkill.version_id, assigned.version_id, 'planner pinned a different skill version');

  let chat = null;
  if (!selectionOnly) {
    chat = await request('POST', `/api/agents/${encodeURIComponent(agentId)}/chat`, {
      message: 'Use your assigned marketing-lead-intelligence skill. In two sentences, explain the first two steps you would take to research and qualify a target account. This is a read-only test: do not create tasks, contact anyone, or change business data.',
    }, 240_000);
    assert.ok(String(chat.reply || '').trim(), 'agent returned an empty reply');
    assert.ok((chat.skills_used || []).some((ref) => ref.skill_id === skillId), `agent did not confirm skill usage: ${JSON.stringify(chat.skills_used || [])}`);

    const audit = await request('GET', `/api/agents/${encodeURIComponent(agentId)}/skills/audit?limit=20`);
    const auditRow = (audit.rows || []).find((row) => (row.skill_refs || []).some((ref) => ref.skill_id === skillId));
    assert.ok(auditRow, 'skill execution audit row not found');
    assert.equal(auditRow.status, 'completed');
  }

  await request('PUT', `/api/agents/${encodeURIComponent(agentId)}/skills`, { assignments: previousAssignments }, 60_000);
  restored = true;
  const after = await request('GET', `/api/agents/${encodeURIComponent(agentId)}/skills`);
  assert.deepEqual(
    (after.assignments || []).map((row) => row.skill_id).sort(),
    previousAssignments.map((row) => row.skill_id).sort(),
    'original skill assignments were not restored',
  );

  console.log(JSON.stringify({
    ok: true,
    owner_user_id: ownerUserId,
    agent_id: agentId,
    skill_id: skillId,
    catalog_api: 'passed',
    assignment_api: 'passed',
    workspace_materialization: 'passed',
    router_agent_selection: 'passed',
    router_target_agent_id: route.target_agent_id,
    planner_agent_selection: 'passed',
    planner_pinned_skill: `${pinnedSkill.skill_id}@v${pinnedSkill.version}`,
    ...(selectionOnly ? {} : { live_agent_skill_confirmation: 'passed', execution_audit: 'passed' }),
    assignment_restore: 'passed',
    ...(chat ? { reply_preview: String(chat.reply).replace(/\s+/g, ' ').slice(0, 220) } : {}),
  }, null, 2));
} finally {
  if (routerWorkUnitId) {
    try { db.prepare('DELETE FROM chat_work_units WHERE id=? AND owner_user_id=?').run(routerWorkUnitId, ownerUserId); } catch {}
  }
  if (!restored && assignmentsCaptured) {
    try { setAgentSkillAssignments(ownerUserId, agentId, previousAssignments, 'vps-agent-skills-live-test-restore'); } catch {}
  }
  revokeSession(session.token);
}
