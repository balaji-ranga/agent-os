/**
 * Goal-plan failure recovery: enqueue a Kanban + pending delegation so the
 * owning agent continues via the **chat/tool loop** (not a new goal plan).
 *
 * Prompt is wrapped [SYSTEM goal_plan_recovery] with the CEO goal + ladder
 * (completed / failed / pending) so the model does not call agent_goal_create.
 */
import { getDb } from '../db/schema.js';
import { getOrCreateDelegationHubStandup } from './standup-hub.js';
import { withOwnerScope } from './org-context.js';
import { sendPlatformNotifications } from './platform-notifications.js';

const TAG = '[goal_plan_recovery]';

function db() {
  return getDb();
}

function clip(s, n = 500) {
  const t = String(s || '').trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + '…';
}

function parseJson(raw, fallback = {}) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw) || fallback;
  } catch {
    return fallback;
  }
}

function recoveryDisabled() {
  return String(process.env.GOAL_PLAN_FAILURE_KANBAN || '1') === '0';
}

/**
 * Build step ladder lines: status, label, tool/agent, error snippet.
 * Accepts raw SQL step rows or serializeGoalRun steps (spec vs spec_json).
 */
export function buildGoalFailureLadder(steps) {
  const list = Array.isArray(steps) ? steps : [];
  return list
    .map((s, i) => {
      const st = String(s.status || 'pending');
      const lab = s.label || s.step_type || 'step';
      const spec =
        s.spec && typeof s.spec === 'object'
          ? s.spec
          : parseJson(s.spec_json, {});
      const tool = spec.tool_name ? ` tool=${spec.tool_name}` : '';
      const agentBit = spec.agent_id ? ` agent=${spec.agent_id}` : '';
      const err =
        st === 'failed' && s.error_message
          ? ` — error: ${clip(s.error_message, 200)}`
          : '';
      let resultNote = '';
      if (st === 'completed') {
        const raw =
          s.result != null
            ? typeof s.result === 'string'
              ? s.result
              : JSON.stringify(s.result)
            : s.result_json
              ? String(s.result_json)
              : '';
        resultNote = raw ? ` — result: ${clip(raw, 400)}` : ' — completed';
      }
      return `${i + 1}. [${st}] ${lab}${tool}${agentBit}${err || resultNote}`;
    })
    .join('\n');
}

/**
 * Resolve recovery assignee: specialty agent for failed specialty_task, else goal orchestrator.
 */
export function resolveGoalFailureAssignee(goal, steps) {
  const list = Array.isArray(steps) ? steps : [];
  const failed = [...list].reverse().find((s) => String(s.status) === 'failed');
  if (failed) {
    const spec =
      failed.spec && typeof failed.spec === 'object'
        ? failed.spec
        : parseJson(failed.spec_json, {});
    if (String(failed.step_type || '') === 'specialty_task' && spec.agent_id) {
      return String(spec.agent_id).trim();
    }
  }
  let id = String(goal?.agent_id || 'balserve').trim();
  if (id.includes('--')) id = id.split('--').pop() || id;
  return id || 'balserve';
}

/**
 * Recovery body for Kanban + delegation (chat path, not plan engine).
 */
export function buildGoalPlanRecoveryPrompt(goal, { steps = [], error = null } = {}) {
  const id = String(goal?.id || '').trim();
  const title = goal?.title || clip(goal?.prompt, 80) || id;
  const ladder = buildGoalFailureLadder(steps);
  const original = String(goal?.prompt || '').trim();
  const failErr = error || goal?.error_message || '';

  return [
    `${TAG}`,
    `[goal_run_id: ${id}]`,
    `[owner_user_id: ${goal?.owner_user_id || ''}]`,
    `[ceo_user_id: ${goal?.owner_user_id || ''}]`,
    '',
    'SYSTEM — goal_plan_recovery (read carefully):',
    'A durable multi-step goal plan failed. You must finish the CEO outcome via your normal Agent Chat tools',
    '(same intelligence as free-form chat: infer tickers from MAG7/MAGS, fill tool args, summarize).',
    '',
    'HARD RULES:',
    '- Do NOT call agent_goal_create (do not start a new agr-… plan).',
    '- Do NOT restart the failed goal plan engine.',
    '- Prefer completing pending / failed work with your tools + a CEO-facing reply in chat.',
    '- Use the step ladder below: do not redo successful steps unless needed for the report.',
    '- When done, mark this Kanban done (kanban_move_status completed) and optionally notify_ceo briefly.',
    '',
    `Failed plan: ${id}`,
    `Title: ${title}`,
    failErr ? `Terminal error: ${clip(failErr, 500)}` : '',
    '',
    '### Original CEO goal (verbatim)',
    original || '(empty)',
    '',
    '### Step ladder (completed / failed / pending)',
    ladder || '(no steps)',
    '',
    '### Your job',
    '1) Understand what already succeeded vs what is still pending.',
    '2) Complete remaining work (or repair the failed step) with tools as you would in Agent Chat.',
    '3) Deliver the CEO outcome (brief report / answer). Quote agr-… only as context; do not re-create the plan.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Once-only Kanban + pending delegation for a failed goal run.
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, kanban_id?: number, task_id?: number, request_id?: string, agent_id?: string }>}
 */
export async function enqueueGoalPlanFailureKanban(goalRunId, opts = {}) {
  if (recoveryDisabled()) {
    return { ok: false, skipped: true, reason: 'disabled_by_env' };
  }
  const id = String(goalRunId || '').trim();
  if (!id) return { ok: false, error: 'goal_run_id required' };

  const { getGoalRun, ensureAgentGoalRunTables } = await import('./agent-goal-run.js');
  ensureAgentGoalRunTables();

  const goal = getGoalRun(id, null);
  if (!goal) return { ok: false, error: 'goal not found' };
  // owner-scoped re-fetch for tenants always ok for system path
  const scoped = getGoalRun(id, goal.owner_user_id) || goal;
  if (String(scoped.status || '') !== 'failed' && !opts.force) {
    return { ok: false, skipped: true, reason: 'not_failed' };
  }

  const ctx =
    scoped.context && typeof scoped.context === 'object' ? { ...scoped.context } : {};
  if (ctx.failure_recovery_kanban_at && !opts.force) {
    return {
      ok: true,
      skipped: true,
      reason: 'already_enqueued',
      kanban_id: ctx.failure_recovery_kanban_id || null,
      task_id: ctx.failure_recovery_task_id || null,
    };
  }

  const steps = Array.isArray(scoped.steps) ? scoped.steps : [];
  const agentId = resolveGoalFailureAssignee(scoped, steps);
  const agent = db()
    .prepare('SELECT id, name, openclaw_agent_id, is_coo FROM agents WHERE lower(id) = lower(?)')
    .get(agentId);
  if (!agent) {
    console.warn('[goal-run] recovery kanban: agent not found', agentId);
    return { ok: false, error: 'agent_not_found', agent_id: agentId };
  }

  const entitled = db()
    .prepare(
      'SELECT 1 AS ok FROM user_agents WHERE user_id = ? AND agent_id = ? AND enabled = 1'
    )
    .get(scoped.owner_user_id, agent.id);
  if (!entitled && !agent.is_coo) {
    const isGoalAgent =
      String(scoped.agent_id || '').toLowerCase() === String(agent.id).toLowerCase();
    if (!isGoalAgent) {
      console.warn('[goal-run] recovery kanban: not entitled', {
        owner: scoped.owner_user_id,
        agent: agent.id,
      });
      return { ok: false, error: 'not_entitled', agent_id: agent.id };
    }
  }

  const standupId = getOrCreateDelegationHubStandup(scoped.owner_user_id);
  if (!standupId) {
    return { ok: false, error: 'no_standup_hub' };
  }

  const goalForPrompt = {
    ...scoped,
    error_message: scoped.error_message || opts.error || null,
  };
  const prompt = withOwnerScope(
    buildGoalPlanRecoveryPrompt(goalForPrompt, {
      steps,
      error: opts.error || scoped.error_message,
    }),
    scoped.owner_user_id
  );

  const requestId = `goal-fail-${String(id).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40)}-${Date.now()}`;
  const info = db()
    .prepare(
      `INSERT INTO agent_delegation_tasks (standup_id, request_id, to_agent_id, prompt, status, owner_user_id)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    )
    .run(standupId, requestId, agent.id, prompt, scoped.owner_user_id);
  const taskId = Number(info.lastInsertRowid);

  const title = clip(`Goal recovery: ${scoped.title || id}`, 120) || `Goal recovery ${id}`;
  const description = [
    prompt,
    '',
    'owner_user_id: ' + scoped.owner_user_id,
    'created_by_agent: goal-run-recovery',
    `goal_run_id: ${id}`,
  ].join('\n');

  const kInfo = db()
    .prepare(
      `INSERT INTO kanban_tasks (title, description, status, assigned_agent_id, created_by, standup_id, agent_delegation_task_id, owner_user_id)
       VALUES (?, ?, 'open', ?, ?, ?, ?, ?)`
    )
    .run(title, description, agent.id, agent.id, standupId, taskId, scoped.owner_user_id);
  const kanbanId = Number(kInfo.lastInsertRowid);

  ctx.failure_recovery_kanban_at = new Date().toISOString();
  ctx.failure_recovery_kanban_id = kanbanId;
  ctx.failure_recovery_task_id = taskId;
  ctx.failure_recovery_request_id = requestId;
  ctx.failure_recovery_agent_id = agent.id;
  try {
    db()
      .prepare(
        `UPDATE agent_goal_runs SET context_json = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(JSON.stringify(ctx), id);
  } catch (e) {
    console.warn('[goal-run] recovery context write failed', e?.message || e);
  }

  try {
    sendPlatformNotifications({
      userIds: [scoped.owner_user_id],
      title: clip(`Goal recovery Kanban: ${scoped.title || id}`, 100),
      body: clip(
        `${id} failed — recovery task #${kanbanId} assigned to ${agent.name || agent.id}. ` +
          `Agent will continue via chat tools (not a new goal plan).`,
        500
      ),
      linkUrl: `/kanban`,
      createdBy: String(agent.id || 'goal-run').slice(0, 64),
      source: 'agent_goal_run',
      sourceKey: `goal-run:${id}:failure-kanban`,
    });
  } catch (e) {
    console.warn('[goal-run] recovery notify failed', e?.message || e);
  }

  console.info('[goal-run] failure recovery kanban enqueued', {
    goalRunId: id,
    kanbanId,
    taskId,
    agentId: agent.id,
  });

  return {
    ok: true,
    goal_run_id: id,
    kanban_id: kanbanId,
    task_id: taskId,
    request_id: requestId,
    agent_id: agent.id,
  };
}
