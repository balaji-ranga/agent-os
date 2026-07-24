/**
 * Build → test → diagnose → fix loop for Workflow Builder (Cursor-style until success).
 * Owner-scoped only — callers must pass the entitled CEO user id.
 */
import * as store from './agent-workflow-store.js';
import { diagnoseWorkflowGraph } from './agent-workflow-agent-troubleshoot.js';
import { validateWorkflowForPublish } from './agent-workflow-builder-catalog.js';
import { buildDetailedGraphSummary } from './agent-workflow-agent-describe.js';

async function applyActions(ownerUserId, workflowId, actions, actor) {
  const { applyWorkflowBuilderActions } = await import('./agent-workflow-builder.js');
  return applyWorkflowBuilderActions(ownerUserId, workflowId, actions, actor);
}

const DEFAULT_MAX_ATTEMPTS = 3;
const HARD_MAX_ATTEMPTS = 5;

/** Detect user intent to build/test/iterate until criteria are met. */
export function parseUntilSuccessIntent(message) {
  const t = String(message || '').trim();
  if (!t) return null;
  const asks =
    /\buntil\s+(?:it\s+)?(?:works|succeeds|passes|is\s+(?:green|ready|done))\b/i.test(t) ||
    /\bbuild[- ]test[- ]iterate\b/i.test(t) ||
    /\biterate\s+until\b/i.test(t) ||
    /\bkeep\s+(?:fixing|iterating|retrying)\b/i.test(t) ||
    /\bsuccess\s+criteria?\b/i.test(t) ||
    /\bmust\s+(?:pass|succeed|complete)\b/i.test(t) ||
    /\bmake\s+(?:it\s+)?(?:work|pass|succeed)\b/i.test(t) ||
    /\buntil_success\b/i.test(t);
  if (!asks) return null;

  const criteriaMatch =
    t.match(/success\s+criteria?\s*[:=]\s*["']?([^"'\n]+)["']?/i) ||
    t.match(/criteria?\s*[:=]\s*["']?([^"'\n]+)["']?/i);
  const inputMatch =
    t.match(/(?:test\s+)?input\s*[:=]\s*["']([^"']+)["']/i) ||
    t.match(/with\s+(?:test\s+)?input\s+["']([^"']+)["']/i);

  return {
    success_criteria: (criteriaMatch?.[1] || '').trim() || null,
    input: (inputMatch?.[1] || '').trim() || null,
    max_attempts: (() => {
      const m = t.match(/(?:max(?:imum)?\s+)?attempts?\s*[:=]?\s*(\d+)/i);
      return m ? Number(m[1]) : null;
    })(),
  };
}

/**
 * Default success: run completed with no failed steps.
 * Optional criteria string matched against status, error_message, and step output previews.
 */
export function runMeetsSuccessCriteria(runSummary, successCriteria = null) {
  if (!runSummary) return false;
  const status = String(runSummary.status || '').toLowerCase();
  if (status !== 'completed') return false;
  const failedSteps = (runSummary.steps || []).filter((s) => s.status === 'failed');
  if (failedSteps.length) return false;

  const criteria = String(successCriteria || '').trim();
  if (!criteria) return true;

  const lower = criteria.toLowerCase();
  if (['completed', 'success', 'pass', 'passed', 'ok', 'green'].includes(lower)) return true;

  const hay = [
    runSummary.status,
    runSummary.error_message,
    ...(runSummary.steps || []).flatMap((s) => [s.status, s.error_message, s.output_preview]),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  const tokens = lower.split(/\s+/).filter((t) => t.length > 2);
  if (!tokens.length) return true;
  return tokens.every((tok) => hay.includes(tok));
}

function stripRecursiveUntilSuccess(actions) {
  return (actions || []).filter((a) => {
    const op = String(a?.action || a?.op || a?.type || '').toLowerCase();
    return op && op !== 'until_success' && op !== 'build_until_success';
  });
}

/**
 * Autonomous iterate loop: structural heal → publish → test → optional LLM fixes → retry.
 */
export async function executeUntilSuccess({
  ownerUserId,
  workflowId,
  actor,
  input = 'Until-success validation run',
  successCriteria = null,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  timeoutMs = 45000,
  applyStructuralFixes = true,
  llmFixFn = null,
}) {
  if (!ownerUserId) throw new Error('ownerUserId required for until_success');
  if (!workflowId) throw new Error('workflow_id required for until_success');

  const budget = Math.min(Math.max(Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS, 1), HARD_MAX_ATTEMPTS);
  const attempts = [];
  let currentId = workflowId;
  let success = false;
  let lastRun = null;

  for (let attempt = 1; attempt <= budget; attempt++) {
    let def = store.getDefinition(currentId, ownerUserId);
    if (!def) throw new Error(`Workflow not found: ${currentId}`);

    if (applyStructuralFixes) {
      const diagnosis = diagnoseWorkflowGraph(def);
      if (diagnosis.fixActions?.length) {
        const fixResult = await applyActions(
          ownerUserId,
          currentId,
          stripRecursiveUntilSuccess(diagnosis.fixActions),
          actor
        );
        currentId = fixResult.workflow_id || currentId;
        def = store.getDefinition(currentId, ownerUserId);
        attempts.push({
          attempt,
          phase: 'structural_fix',
          ok: !fixResult.has_errors,
          issue_count: diagnosis.issues?.length || 0,
          fixes_applied: diagnosis.fixActions.length,
        });
      }
    }

    const publishErrors = validateWorkflowForPublish(def?.draft_graph, ownerUserId) || [];
    if (publishErrors.length) {
      attempts.push({
        attempt,
        phase: 'validate',
        ok: false,
        errors: publishErrors.slice(0, 10),
      });

      if (typeof llmFixFn === 'function') {
        const fixActions = stripRecursiveUntilSuccess(
          await llmFixFn({
            phase: 'validate',
            errors: publishErrors,
            def,
            attempt,
            successCriteria,
            lastRun,
          })
        );
        if (fixActions.length) {
          await applyActions(ownerUserId, currentId, fixActions, actor);
          continue;
        }
      }
      if (attempt >= budget) break;
      continue;
    }

    const prep = [];
    if (def.paused) prep.push({ action: 'resume_workflow' });
    if (def.status !== 'published') prep.push({ action: 'publish' });
    if (prep.length) {
      const prepResult = await applyActions(ownerUserId, currentId, prep, actor);
      currentId = prepResult.workflow_id || currentId;
      attempts.push({ attempt, phase: 'publish', ok: !prepResult.has_errors });
    }

    const testResult = await applyActions(
      ownerUserId,
      currentId,
      [{ action: 'test_workflow', input, wait: true, timeout_ms: timeoutMs }],
      actor
    );
    const testRow = testResult.results?.find((r) => r.action === 'test_workflow');
    lastRun = testRow?.run || null;
    const met = runMeetsSuccessCriteria(lastRun, successCriteria);
    attempts.push({
      attempt,
      phase: 'test',
      ok: met,
      run_id: testRow?.run_id || lastRun?.run_id,
      run_number: testRow?.run_number || lastRun?.run_number,
      status: lastRun?.status || null,
      error_message: lastRun?.error_message || null,
      failed_steps: (lastRun?.steps || [])
        .filter((s) => s.status === 'failed')
        .map((s) => ({ node_id: s.node_id, node_label: s.node_label, error: s.error_message })),
    });

    if (met) {
      success = true;
      break;
    }

    def = store.getDefinition(currentId, ownerUserId);
    const postDiag = diagnoseWorkflowGraph(def);

    if (typeof llmFixFn === 'function') {
      const fixActions = stripRecursiveUntilSuccess(
        await llmFixFn({
          phase: 'run_failed',
          run: lastRun,
          diagnosis: postDiag,
          def,
          attempt,
          successCriteria,
          graph_summary: buildDetailedGraphSummary(def?.draft_graph),
        })
      );
      if (fixActions.length) {
        await applyActions(ownerUserId, currentId, fixActions, actor);
        continue;
      }
    }

    if (applyStructuralFixes && postDiag.fixActions?.length) {
      await applyActions(
        ownerUserId,
        currentId,
        stripRecursiveUntilSuccess(postDiag.fixActions),
        actor
      );
      continue;
    }

    // No automatic repairs left — stop early
    break;
  }

  const finalDef = store.getDefinition(currentId, ownerUserId);
  return {
    success,
    workflow_id: currentId,
    workflow: finalDef,
    attempts,
    last_run: lastRun,
    success_criteria: successCriteria || 'status=completed and no failed steps',
    max_attempts: budget,
  };
}

export function formatUntilSuccessReply(outcome) {
  if (!outcome) return 'Until-success loop did not run.';
  const lines = [
    outcome.success
      ? `**Until-success: PASSED** after ${outcome.attempts?.length || 0} phase(s).`
      : `**Until-success: NOT MET** after ${outcome.attempts?.length || 0} phase(s).`,
    `Criteria: ${outcome.success_criteria}`,
  ];
  for (const a of outcome.attempts || []) {
    if (a.phase === 'test') {
      lines.push(
        `- Attempt ${a.attempt} test: ${a.status || 'n/a'}${a.ok ? ' ✓' : ' ✗'}${
          a.failed_steps?.length
            ? ` — ${a.failed_steps.map((s) => `${s.node_label}: ${s.error || 'failed'}`).join('; ')}`
            : ''
        }`
      );
    } else {
      lines.push(`- Attempt ${a.attempt} ${a.phase}: ${a.ok === false ? 'issues' : 'ok'}`);
    }
  }
  if (!outcome.success && outcome.last_run) {
    lines.push('', `Last run #${outcome.last_run.run_number}: ${outcome.last_run.status}`);
    if (outcome.last_run.error_message) lines.push(`Error: ${outcome.last_run.error_message}`);
  }
  return lines.join('\n');
}
