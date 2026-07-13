/**
 * Workflow run queries for the Workflow Builder agent — factual DB lookups, no LLM guessing.
 */
import * as store from './agent-workflow-store.js';
import {
  resolveWorkflowForTrigger,
  summarizeRunForAgent,
  findLatestFailedRun,
} from './agent-workflow-chat-tools.js';
import { extractWorkflowReferenceFromMessage } from './agent-workflow-agent-describe.js';

function extractWorkflowNameFromRunQuery(message) {
  const t = String(message || '');
  const ref = extractWorkflowReferenceFromMessage(t);

  const patterns = [
    /(?:failed\s+run\s+of|failure\s+of)\s+(?:the\s+)?(?:workflow\s+)?[`"']?([a-zA-Z0-9_-]+)[`"']?/i,
    /(?:run\s+of|runs?\s+for)\s+(?:the\s+)?(?:workflow\s+)?[`"']?([a-zA-Z0-9_-]+)[`"']?/i,
    /(?:why|how)\s+(?:did|does|was)\s+(?:the\s+)?(?:workflow\s+)?[`"']?([a-zA-Z0-9_-]+)[`"']?\s+fail/i,
    /(?:workflow\s+)?[`"']?([a-zA-Z0-9_-]+)[`"']?\s+(?:workflow\s+)?fail(?:ed|ure)?/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1] && !/^(the|a|an|this|that|recent|latest|last|most|why|what|run|workflow)$/i.test(m[1])) {
      return m[1].trim();
    }
  }

  for (const m of t.matchAll(/`([^`]+)`/g)) {
    const name = m[1].trim();
    if (name.length > 1) return name;
  }

  return ref.name || null;
}

export function parseFailedRunQueryIntent(message) {
  const t = String(message || '').trim();
  if (!t) return null;

  const asksFailure =
    /(?:recent|latest|last|most recent)\s+failed\s+run/i.test(t) ||
    /failed\s+run\s+of/i.test(t) ||
    /(?:why|how)\s+(?:did|does|was)\s+.+\s+fail/i.test(t) ||
    /(?:what|which)\s+(?:is|was)\s+(?:the\s+)?(?:recent|latest|last)?\s*failed/i.test(t) ||
    /(?:inspect|show|check|explain)\s+(?:the\s+)?(?:recent|latest|last)?\s*failed/i.test(t) ||
    /\b(?:rca|root\s*cause)\b/i.test(t) ||
    /(?:analyze|analysis)\s+(?:the\s+)?(?:failed\s+)?(?:run|failure|error)/i.test(t) ||
    /(?:what\s+caused|explain\s+(?:the\s+)?(?:failure|error))/i.test(t);

  if (!asksFailure) return null;

  const workflow_query = extractWorkflowNameFromRunQuery(t);
  const ref = extractWorkflowReferenceFromMessage(t);

  return {
    workflow_query: workflow_query || ref.name || ref.workflow_id || null,
    workflow_id: ref.workflow_id || null,
    inspect: true,
  };
}

export function parseListRunsQueryIntent(message) {
  const t = String(message || '').trim();
  if (!t) return null;
  if (!/(?:list|show|recent)\s+(?:workflow\s+)?runs?/i.test(t)) return null;

  const workflow_query = extractWorkflowNameFromRunQuery(t);
  const ref = extractWorkflowReferenceFromMessage(t);
  return {
    workflow_query: workflow_query || ref.name || ref.workflow_id || null,
    workflow_id: ref.workflow_id || null,
  };
}

export function resolveWorkflowForRunQuery(ownerUserId, { workflow_id, workflow_query } = {}) {
  if (workflow_id) {
    const byId = store.getDefinition(workflow_id, ownerUserId);
    if (byId) return byId;
  }
  if (workflow_query) {
    const byName = resolveWorkflowForTrigger(ownerUserId, {
      workflow_id: workflow_query,
      workflow_name: workflow_query,
      message: workflow_query,
    });
    if (byName) return byName;
  }
  return null;
}

export function listRunsSummaryForAgent(ownerUserId, definitionId, limit = 15) {
  return store.listRuns(definitionId, ownerUserId, limit).map((r) => ({
    run_id: r.id,
    run_number: r.run_number,
    status: r.status,
    progress_pct: r.progress_pct,
    error_message: r.error_message || null,
    started_at: r.started_at,
    completed_at: r.completed_at,
  }));
}

export function formatRunFailureReply(def, runSummary) {
  if (!def) return 'Workflow not found.';
  if (!runSummary) {
    return `No failed runs found for workflow **${def.name}** (id: \`${def.id}\`).`;
  }

  const lines = [
    `**${def.name}** — failed run **#${runSummary.run_number}** (run id: ${runSummary.run_id})`,
    `- Status: ${runSummary.status}`,
    `- Started: ${runSummary.started_at || '—'}`,
    `- Completed: ${runSummary.completed_at || '—'}`,
  ];

  if (runSummary.error_message) {
    lines.push(`- Run error: ${runSummary.error_message}`);
  }

  const failedSteps = (runSummary.steps || []).filter((s) => s.status === 'failed');
  if (failedSteps.length) {
    lines.push('', '**Failed step(s):**');
    for (const s of failedSteps) {
      lines.push(`- **${s.node_label || s.node_id}** (\`${s.node_type || 'step'}\`): ${s.error_message || 'failed'}`);
      if (s.output_preview) lines.push(`  - Output preview: ${s.output_preview}`);
    }
  } else if (!runSummary.error_message) {
    lines.push('', '_No step-level failure recorded — check run logs in the workflow UI._');
  }

  lines.push('', formatRunRcaSection(def, runSummary));

  return lines.join('\n');
}

/** Heuristic RCA block for failed runs (deterministic — no LLM). */
export function formatRunRcaSection(def, runSummary) {
  const failedSteps = (runSummary.steps || []).filter((s) => s.status === 'failed');
  const root = failedSteps[0] || null;
  const err = String(root?.error_message || runSummary.error_message || '').toLowerCase();
  const lines = ['## Root Cause Analysis (RCA)'];

  lines.push(
    `**Symptom:** Run #${runSummary.run_number} of **${def.name}** ended as \`${runSummary.status}\`.`
  );
  if (root) {
    lines.push(
      `**Failing step:** ${root.node_label || root.node_id} (\`${root.node_id}\`, type \`${root.node_type || '?'}\`)`
    );
    lines.push(`**Evidence:** ${root.error_message || runSummary.error_message || 'n/a'}`);
  } else if (runSummary.error_message) {
    lines.push(`**Evidence:** ${runSummary.error_message}`);
  }

  const { cause, fix } = inferRcaFromError(err, root?.node_type);
  lines.push(`**Likely root cause:** ${cause}`);
  lines.push(`**Recommended fix:** ${fix}`);
  lines.push(
    '',
    '_Ask the Workflow Builder to apply fixes (update_node / reconnect / publish), then `test_workflow`._'
  );
  return lines.join('\n');
}

function inferRcaFromError(err, nodeType) {
  if (/timed?\s*out|timeout|abort/i.test(err)) {
    return {
      cause: 'Step exceeded its node timeout (or HTTP/script abort) before completing.',
      fix: 'Increase timeoutMs on the node, or set timeoutAction=default_output if a fallback is acceptable. Check downstream dependency health.',
    };
  }
  if (/fetch failed|enotfound|econnrefused|network|dns|http\s*[45]\d\d/i.test(err)) {
    return {
      cause: 'Outbound HTTP call failed (bad URL, auth, or remote unavailable).',
      fix: 'Verify API URL, auth headers/tokens on the API node, and that the target service is reachable from the backend.',
    };
  }
  if (/mcp server|not healthy|mcp /i.test(err)) {
    return {
      cause: 'MCP server missing, unhealthy, or misconfigured for this user.',
      fix: 'Open MCP integrations, reconnect the server, and confirm mcpServerId / toolName on the MCP node.',
    };
  }
  if (/no agent|agent not found|agent_id|agentid/i.test(err)) {
    return {
      cause: 'Agent step has no valid agent_id (or agent was deleted).',
      fix: 'update_node with a valid agent_id from the Agents list, then republish.',
    };
  }
  if (/script|custom script|not approved|not accessible/i.test(err)) {
    return {
      cause: 'Custom script missing, not approved, or failed in sandbox.',
      fix: 'Confirm customScriptId points to an approved script; inspect script last_error; re-run after fixing source.',
    };
  }
  if (/api key|unauthorized|401|403|credentials|model source/i.test(err)) {
    return {
      cause: 'LLM/API credentials missing or rejected on the Brain/API node.',
      fix: 'For Brain: set modelSource=ollama (local) or provide apiKey on the node. Platform .env keys are not used at run time.',
    };
  }
  if (/condition|branch/i.test(err)) {
    return {
      cause: 'Branch/condition evaluation failed or took an unexpected path.',
      fix: 'Inspect IF/WHILE sourceNodeId + compareValue; verify upstream output keys exist.',
    };
  }
  if (nodeType === 'brain') {
    return {
      cause: 'Brain (LLM) step failed during model call or tool-calling loop.',
      fix: 'Check modelSource/endpoint/model, Ollama availability, and MCP tool-calling config if enabled.',
    };
  }
  return {
    cause: 'Step failed with the error above; no higher-level pattern matched.',
    fix: 'inspect_run the failed step, fix the node config or upstream input, publish, and test_workflow again.',
  };
}

export function parseRcaIntent(message) {
  const t = String(message || '').trim();
  if (!t) return null;
  const asks =
    /\b(?:rca|root\s*cause|analyze|analysis|post[- ]?mortem)\b/i.test(t) ||
    /(?:why\s+did|what\s+caused|explain\s+(?:the\s+)?(?:failure|error|fail))/i.test(t);
  if (!asks) return null;
  return parseFailedRunQueryIntent(t) || {
    workflow_query: extractWorkflowNameFromRunQuery(t),
    workflow_id: null,
    inspect: true,
    rca: true,
  };
}

export function formatRunsListReply(def, runs) {
  if (!def) return 'Workflow not found.';
  if (!runs?.length) return `No runs yet for **${def.name}** (id: \`${def.id}\`).`;

  const lines = [`Recent runs for **${def.name}** (id: \`${def.id}\`):`];
  for (const r of runs) {
    lines.push(
      `- #${r.run_number} (id ${r.run_id}) | ${r.status}${r.error_message ? ` | ${r.error_message.slice(0, 100)}` : ''}`
    );
  }
  return lines.join('\n');
}

export function formatRunContextBlock(def, runs, { maxRuns = 10 } = {}) {
  if (!def || !runs?.length) return '';
  const slice = runs.slice(0, maxRuns);
  const latestFailed = slice.find((r) => r.status === 'failed');
  const lines = [
    `Recent runs for ${def.name} (AUTHORITATIVE — do not invent other run numbers):`,
    ...slice.map(
      (r) =>
        `- #${r.run_number} (id ${r.id}) | ${r.status}${r.error_message ? ` | error: ${String(r.error_message).slice(0, 120)}` : ''}`
    ),
  ];
  if (latestFailed) {
    lines.push(`Latest failed run: #${latestFailed.run_number} (id ${latestFailed.id})`);
  }
  return lines.join('\n');
}

/**
 * Deterministic response for "latest failed run of X" — inspect_run from DB, no LLM.
 */
export async function tryFailedRunQueryResponse(ownerUserId, workflowId, message) {
  const intent = parseFailedRunQueryIntent(message);
  if (!intent) return null;

  const def =
    resolveWorkflowForRunQuery(ownerUserId, intent) ||
    (workflowId ? store.getDefinition(workflowId, ownerUserId) : null);

  if (!def) {
    const q = intent.workflow_query || 'workflow';
    return {
      reply: `No workflow matched "${q}". Use the exact workflow name or id from the workflows list.`,
      workflow_id: workflowId,
      actions_applied: [],
    };
  }

  const { run } = findLatestFailedRun(ownerUserId, {
    workflow_id: def.id,
  });

  if (!run) {
    return {
      reply: formatRunFailureReply(def, null),
      workflow_id: def.id,
      workflow: def,
      actions_applied: [{ action: 'list_runs', ok: true, workflow_id: def.id, runs: listRunsSummaryForAgent(ownerUserId, def.id) }],
    };
  }

  const summary = summarizeRunForAgent(run);
  return {
    reply: formatRunFailureReply(def, summary),
    workflow_id: def.id,
    workflow: def,
    actions_applied: [{ action: 'inspect_run', ok: true, run: summary }],
  };
}

export async function tryListRunsQueryResponse(ownerUserId, workflowId, message) {
  const intent = parseListRunsQueryIntent(message);
  if (!intent) return null;

  const def =
    resolveWorkflowForRunQuery(ownerUserId, intent) ||
    (workflowId ? store.getDefinition(workflowId, ownerUserId) : null);

  if (!def) {
    return {
      reply: `No workflow matched "${intent.workflow_query || 'workflow'}".`,
      workflow_id: workflowId,
      actions_applied: [],
    };
  }

  const runs = listRunsSummaryForAgent(ownerUserId, def.id, 20);
  return {
    reply: formatRunsListReply(def, runs),
    workflow_id: def.id,
    workflow: def,
    actions_applied: [{ action: 'list_runs', ok: true, workflow_id: def.id, runs }],
  };
}
