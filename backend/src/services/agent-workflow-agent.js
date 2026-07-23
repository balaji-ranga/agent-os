/**

 * Workflow Builder agent — LLM chat with structured graph mutations (workflow chatops SME).

 */

import { chatCompletions } from '../config/llm.js';

import { getTaskCatalog } from './agent-workflow-task-catalog.js';

import {

  applyWorkflowBuilderActions,

  getWorkflowDraftForAgent,

  summarizeGraphForAgent,

} from './agent-workflow-builder.js';

import * as store from './agent-workflow-store.js';

import { parseWorkflowAgentCommand } from './agent-workflow-chat-tools.js';

import {

  appendWorkflowChatExchange,

  listWorkflowChatTurns,

  workflowChatThreadKey,

} from './agent-workflow-chat-store.js';

import { buildAgentSystemKnowledge } from './agent-workflow-agent-knowledge.js';
import {
  buildWorkflowAgentRuntimeContext,
  formatRuntimeContextForPrompt,
} from './agent-workflow-agent-runtime-context.js';
import {
  matchWorkflowRecipe,
  buildRecipeActionBatch,
  enrichCreateWorkflowActions,
} from './agent-workflow-recipes.js';
import {
  findWorkflowsReferencedInMessage,
  formatWorkflowDescriptionBlock,
  tryDescribeWorkflowResponse,
  tryScheduleQueryResponse,
} from './agent-workflow-agent-describe.js';
import {
  formatRunFailureReply,
  formatRunContextBlock,
  tryFailedRunQueryResponse,
  tryListRunsQueryResponse,
} from './agent-workflow-agent-runs.js';
import { tryTroubleshootWorkflowResponse } from './agent-workflow-agent-troubleshoot.js';
import { tryCatalogQueryResponse, formatCatalogForPrompt } from './agent-workflow-builder-catalog.js';
import {
  parseUntilSuccessIntent,
  executeUntilSuccess,
  formatUntilSuccessReply,
} from './agent-workflow-agent-until-success.js';
import { formatCertifyReply } from './agent-workflow-certify.js';



const WORKFLOW_BUILDER_AGENT_ID = 'workflowbuilder';



const SYSTEM_PROMPT = `You are the Workflow Builder agent (workflow chatops SME) for Agent OS. You create, edit, test, troubleshoot, and operate visual agent workflows — full parity with the workflow UI.

You work like Cursor for workflows: user gives INTENT + optional SUCCESS CRITERIA; you build a complete wired graph, publish, test, diagnose failures, fix, and retest until criteria are met (or budget exhausted). Use Runtime environment IDs and defaults — never ask the user for node attribute details you can infer. You already have full context of ALL this CEO's workflows (draft + published) in the user message.

ENTITLEMENTS: You may only read/mutate/trigger workflows owned by the current entitled CEO. Never invent another owner's workflows or ask the user to spoof ceo_user_id.

LEARNINGS: Before starting any non-trivial create/fix/until_success task, prefer calling the learnings_summary content tool (topic = short description of the request, days default 30) so you avoid past mistakes and honor this CEO's prior feedback and Kanban approve/reject comments. If the tool is unavailable in this chat path, still respect any learnings included in context.

Respond with a single JSON object (no markdown fences):
{ "reply": "...", "actions": [ ... ] }



## Graph editing

- create_workflow — { "action": "create_workflow", "name": "...", "chat_phrase": "...", "trigger_modes": ["manual","chat"] }
  Prefer create_workflow THEN add_node (do not omit create when no workflow is open). If you include graph.nodes, each node MUST be { id, type, position: { x, y }, data: { ... } } — never omit position.

- create_from_template — { "action": "create_from_template", "template_id": "template-job-applicant-pipeline", "name": "..." }

- clone_workflow — { "action": "clone_workflow", "workflow_name": "source", "new_name": "Copy name" } — copy graph/variables from an existing definition (schedule not copied unless copy_schedule=true)

- add_node — { "action": "add_node", "node_type": "...", "label": "...", "connect_from": "node-id", "agent_id": "...", "prompt": "...", "system_prompt": "...", "task_config": { } }

- update_node — { "action": "update_node", "node_id": "...", "label": "...", "prompt": "...", "task_config": { } }

- delete_node, add_edge/connect, delete_edge, set_metadata

## Catalog tools (read-only — use before building unfamiliar nodes)

- get_node_catalog — { "action": "get_node_catalog" } — all node types, inputs, outputs, config fields

- get_node_type — { "action": "get_node_type", "node_type": "brain" } — detailed spec + examples

- list_content_tools — { "action": "list_content_tools" } — ALL enabled content tools (name + purpose)

- enquire_content_tools — { "action": "enquire_content_tools", "query": "summarize a web page" } — rank tools by user intent; returns top_recommendation

- validate_publish — { "action": "validate_publish" } — preflight publish errors before publishing



## Content tools → tool nodes (CRITICAL)

Runtime environment lists every enabled content tool with its purpose. When the user describes a capability:
1. Match intent to a content tool purpose (or call enquire_content_tools).
2. Recommend the tool by exact \`name\` and explain why (one sentence).
3. To wire it into a workflow: add_node with node_type "tool", toolName "<exact name>", optional toolPayload.
Example: { "action": "add_node", "node_type": "tool", "label": "Summarize URL", "toolName": "summarize_url", "connect_from": "trigger-1" }
Do NOT invent tool names or raw /api/tools/... api nodes when a registered content tool exists.


## Definition lifecycle (CRITICAL)

- publish — { "action": "publish" } — draft → published

- unpublish / revert_to_draft — { "action": "unpublish" } OR { "action": "revert_to_draft", "workflow_id": "..." } — published → draft (REQUIRED before treating workflow as draft again)

- pause_workflow — disables triggers + pauses active runs

- resume_workflow — re-enables triggers

- open_workflow / reload_workflow — load workflow into editor context



## Runs

- list_runs — { "action": "list_runs", "workflow_id": "...", "limit": 20 } — recent run instances (AUTHORITATIVE run numbers)
- trigger_workflow, test_workflow (run + wait + diagnostics), inspect_run, pause_run, stop_run, pause_all_runs, stop_listen
- until_success — { "action": "until_success", "success_criteria": "completed", "input": "...", "max_attempts": 3 } — publish → test → structural heal → retest until criteria met
- until_certified — { "action": "until_certified", "async": true, "message": "...", "max_attempts": 5 } — Maker/Checker certify (prefer async so OpenClaw can poll status). Sync when async omitted/false.
- compile_goal / check_goal — compile or grade a WorkflowGoal against the current graph + last run

NEVER invent run numbers or run ids. For failed-run questions: use list_runs or inspect_run with run_number from Recent runs context, or inspect_run with latest_failed on the named workflow.



When user says "make draft", "unpublish", "revert to draft", or "change status to draft" → use unpublish or revert_to_draft with workflow_id. Do NOT only open_workflow — unpublish works from the workflows list without opening the editor.



## Build-test-iterate (CRITICAL — Cursor mode)

When the user wants a working workflow, end-to-end validation, or states success criteria:
1. Create/update the full graph in one actions batch (wired end-to-end).
2. Include validate_publish then publish (or let until_success publish).
3. End with until_success (preferred) OR test_workflow with wait:true.
4. On failure: inspect failed steps, apply update_node/add_edge fixes, then until_success / test_workflow again — do not stop at "please try again".

Default success criteria when unspecified: run status=completed with no failed steps.

## Test & fix

inspect_run / failed-run RCA → read failed step errors → update_node / add_edge → unpublish if needed → edit → publish → test_workflow / until_success again.
For structural issues: diagnose orphans, missing agent_id, dangling edges — then apply add_edge / update_node fixes.
Job applicant pipeline: prefer create_from_template with template_id "template-job-applicant-pipeline" (or say "create a job applicant pipeline workflow").
Clone: use clone_workflow to copy an existing definition into a new draft.



Use task_config for brain (modelSource, systemPrompt, mcpToolCalling, mcpServerIds), mcp_tool (mcpServerId, toolName), api, email, if/while conditions, etc.
For tool nodes: set toolName to an exact Content tools catalog name (from Runtime or enquire_content_tools).

Brain nodes (CRITICAL):
- Default modelSource=ollama (local, no API key). Platform .env keys are NEVER used for workflow runs.
- Only set openai/anthropic/openrouter when task_config.apiKey is provided on the node.
- For guardrails/content safety: use systemPrompt with clear rules; connect_from trigger-1; wire input via {{input}}.
- On published workflows, graph edits auto-unpublish to draft — then publish when done.
- Call validate_publish before publish if unsure; fix reported errors first.



If only answering a question, return actions: [].

When describing or explaining a workflow: use ONLY the "Referenced workflow details" / Graph JSON in context. Never invent nodes (e.g. do not add Brain/MCP unless present in graph). List each node's type, purpose, config, and edges exactly as stored.

Keep node ids stable. Match workflows by name/id/chat phrase from context.



${buildAgentSystemKnowledge()}`;



function normalizeParsedAgentResponse(parsed, fallbackText = '') {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { reply: fallbackText, actions: [] };
  }
  let actions = [];
  if (Array.isArray(parsed.actions)) {
    actions = parsed.actions.filter((a) => a && a.action);
  } else if (parsed.action) {
    actions = [parsed];
  }
  const reply = String(parsed.reply || '').trim() || (actions.length ? '' : fallbackText);
  return { reply, actions };
}

function parseAgentJson(content) {
  const text = String(content || '').trim();
  if (!text) return { reply: '', actions: [] };

  try {
    return normalizeParsedAgentResponse(JSON.parse(text), text);
  } catch {
    const blocks = [...text.matchAll(/\{[\s\S]*?\}/g)];
    const actionObjects = [];
    let wrapper = null;

    for (const block of blocks) {
      try {
        const obj = JSON.parse(block[0]);
        if (obj?.reply !== undefined || Array.isArray(obj?.actions)) {
          wrapper = obj;
        } else if (obj?.action) {
          actionObjects.push(obj);
        }
      } catch {
        /* try next block */
      }
    }

    if (!wrapper) {
      const greedy = text.match(/\{[\s\S]*\}/);
      if (greedy) {
        try {
          const obj = JSON.parse(greedy[0]);
          if (obj?.reply !== undefined || obj?.action || Array.isArray(obj?.actions)) {
            return normalizeParsedAgentResponse(obj, text);
          }
        } catch {
          /* fall through */
        }
      }
    }

    if (wrapper) return normalizeParsedAgentResponse(wrapper, text);
    if (actionObjects.length) {
      const prose = text.replace(/\{[\s\S]*?\}/g, '').trim();
      return { reply: prose || 'Done.', actions: actionObjects };
    }

    return { reply: text, actions: [] };
  }
}



function formatWorkflowLine(w) {

  return `- ${w.name} | id: ${w.id} | status: ${w.status}${w.paused ? ' | PAUSED' : ''}${w.chat_trigger_phrase ? ` | chat: "${w.chat_trigger_phrase}"` : ''}`;

}



function buildUserContext({ workflowId, ownerUserId, message }) {

  const parts = [`CEO request:\n${message}`];

  try {
    const runtime = buildWorkflowAgentRuntimeContext(ownerUserId);
    parts.push(formatRuntimeContextForPrompt(runtime));
  } catch {
    parts.push('\n(Runtime environment unavailable)');
  }

  const all = store.listDefinitions(ownerUserId);

  if (all.length) {

    parts.push(`\nAll workflows:\n${all.map(formatWorkflowLine).join('\n')}`);

  }

  const referenced = (() => {
    try {
      return findWorkflowsReferencedInMessage(ownerUserId, message);
    } catch (e) {
      console.warn('[workflow-agent] findWorkflowsReferencedInMessage:', e.message);
      return [];
    }
  })();
  if (referenced.length) {
    parts.push(
      '\n## Referenced workflow details (AUTHORITATIVE — describe ONLY these nodes; do not invent Brain/MCP/agent nodes not listed)'
    );
    for (const def of referenced) {
      parts.push(formatWorkflowDescriptionBlock(def));
      const runs = store.listRuns(def.id, ownerUserId, 10);
      const runBlock = formatRunContextBlock(def, runs);
      if (runBlock) parts.push(runBlock);
    }
  }



  const activeRuns = store

    .listAllRuns(ownerUserId, 20)

    .filter((r) => ['running', 'pending', 'paused'].includes(r.status));

  if (activeRuns.length) {

    parts.push(

      `\nActive runs:\n${activeRuns

        .map((r) => `- run #${r.run_number} (id ${r.id}) | ${r.definition_id} | ${r.status}`)

        .join('\n')}`

    );

  }



  if (workflowId) {

    try {

      const draft = getWorkflowDraftForAgent(ownerUserId, workflowId);

      parts.push(`\nCurrently open: ${draft.name} (id: ${draft.workflow_id})`);

      parts.push(`Status: ${draft.status}${draft.paused ? ' (PAUSED)' : ''}`);

      if (draft.status === 'published') {

        parts.push('Note: workflow is PUBLISHED — use unpublish/revert_to_draft to return to draft status.');

      }

      parts.push(`Chat phrase: ${draft.chat_trigger_phrase || '(none)'}`);

      parts.push(`Graph: ${JSON.stringify(draft.graph_summary)}`);

      const runs = store.listRuns(workflowId, ownerUserId, 5);

      if (runs.length) {

        parts.push(`Recent runs: ${runs.map((r) => `#${r.run_number} ${r.status}`).join(', ')}`);

      }

    } catch {

      parts.push(`\n(workflow ${workflowId} not found)`);

    }

  } else {

    parts.push('\nNo workflow open — use open_workflow or create_workflow.');

  }



  parts.push(`\nStep types: ${getTaskCatalog().map((t) => t.type).join(', ')}`);
  parts.push('\nNode catalog summary (use get_node_type action for full spec):');
  parts.push(formatCatalogForPrompt());

  return parts.join('\n');

}



async function executeRecipePath(ownerUserId, workflowId, message, actor) {
  const runtime = buildWorkflowAgentRuntimeContext(ownerUserId);
  const recipe = matchWorkflowRecipe(message);
  if (!recipe) return null;

  const { actions, spec } = buildRecipeActionBatch(recipe, message, runtime);
  const result = await applyWorkflowBuilderActions(ownerUserId, workflowId, actions, actor);
  const effectiveWorkflowId = result.workflow_id || workflowId;
  const workflow = effectiveWorkflowId ? store.getDefinition(effectiveWorkflowId, ownerUserId) : null;

  let workflowTriggered = null;
  const tr = result.results?.find((r) => r.action === 'test_workflow' && r.run_id);
  if (tr) {
    workflowTriggered = { run_id: tr.run_id, run_number: tr.run_number, definition_id: tr.definition_id };
  }

  const reply = `Created **${spec.name}** (${recipe.label}). ${spec.summary}${spec.autoTest ? ' — test run included.' : ' — say "test workflow" to verify.'}`;

  return buildChatResultPayload({
    reply,
    modelUsed: null,
    effectiveWorkflowId,
    workflow,
    result,
    workflowTriggered,
  });
}



function formatAssistantReply(baseReply, result) {

  let text = baseReply || '';

  const applied = result?.actions_applied || result?.results || [];

  if (applied.length) {

    const summary = applied

      .map((a) => {

        let line = a.action;

        if (a.node_id) line += `: ${a.node_id}`;

        if (a.workflow_id) line += ` → ${a.workflow_id}`;

        if (a.status) line += ` [${a.status}]`;

        if (a.run_number) line += ` run #${a.run_number}`;

        if (a.ok === false && a.error) line += ` FAILED: ${a.error}`;

        return line;

      })

      .join(', ');

    text += `\n\n_Applied: ${summary}_`;

  }

  const failed = applied.filter((a) => a.ok === false && a.error);
  if (failed.length) {
    text += `\n\n**Errors:**\n${failed.map((f) => `- **${f.action}**: ${f.error}`).join('\n')}`;
    text += '\n\nGraph changes before the failed step were saved. Fix the error and retry publish.';
  }

  const untilResult = applied.find((a) => a.action === 'until_success');
  if (untilResult) {
    text += `\n\n${formatUntilSuccessReply(untilResult)}`;
  }

  const certifyResult = applied.find((a) => a.action === 'until_certified');
  if (certifyResult) {
    text += `\n\n${certifyResult.reply || formatCertifyReply(certifyResult.job || certifyResult)}`;
  }

  const testResult = applied.find((a) => a.action === 'test_workflow' && a.run);

  const inspectResult = applied.find((a) => a.action === 'inspect_run' && a.run);
  if (inspectResult?.run) {
    text += `\n\n${formatRunFailureReply(
      { name: inspectResult.run.definition_name || 'Workflow' },
      inspectResult.run
    )}`;
  }

  if (testResult?.run) {

    text += `\n\n**Test:** ${testResult.run.status}`;

    const failed = (testResult.run.steps || []).filter((s) => s.status === 'failed');

    if (failed.length) {

      text += `\n${failed.map((s) => `- ${s.node_label}: ${s.error_message || 'failed'}`).join('\n')}`;

    }

  }

  if (result?.workflow_triggered) {

    text += `\n\n▶ Run #${result.workflow_triggered.run_number} started.`;

  }

  return text;

}



function buildChatResultPayload({ reply, modelUsed, effectiveWorkflowId, workflow, result, workflowTriggered }) {

  return {

    reply,

    model_used: modelUsed ?? null,

    workflow_id: effectiveWorkflowId,

    draft_graph: workflow?.draft_graph || result?.draft_graph || null,

    graph_summary: workflow ? summarizeGraphForAgent(workflow.draft_graph) : result?.graph_summary,

    actions_applied: result?.results || [],

    workflow_triggered: workflowTriggered,

    workflow: workflow

      ? {

          id: workflow.id,

          name: workflow.name,

          status: workflow.status,

          paused: !!workflow.paused,

          chat_trigger_phrase: workflow.chat_trigger_phrase,

        }

      : null,

  };

}



async function executeFastPathCommand(ownerUserId, workflowId, command, actor) {

  const actionMap = {

    trigger_workflow: 'trigger_workflow',

    test_workflow: 'test_workflow',

    open_workflow: 'open_workflow',

    reload_workflow: 'reload_workflow',

    pause_workflow: 'pause_workflow',

    resume_workflow: 'resume_workflow',

    unpublish_workflow: 'unpublish',

    pause_run: 'pause_run',

    stop_run: 'stop_run',

    inspect_run: 'inspect_run',

    pause_all_runs: 'pause_all_runs',

    clone_workflow: 'clone_workflow',

  };

  const actionName = actionMap[command.cmd];

  if (!actionName) return null;



  const action = {

    action: actionName,

    workflow_id:
      command.cmd === 'clone_workflow' && command.workflow_name
        ? undefined
        : command.workflow_id || workflowId || undefined,

    workflow_name: command.workflow_name,

    source_workflow_id:
      command.cmd === 'clone_workflow' ? command.workflow_id || (!command.workflow_name ? workflowId : undefined) : undefined,

    source_workflow_name: command.cmd === 'clone_workflow' ? command.workflow_name : undefined,

    new_name: command.new_name,

    run_number: command.run_number,

    latest_failed: command.latest_failed,

    input: command.input,

  };



  const result = await applyWorkflowBuilderActions(ownerUserId, workflowId, [action], actor);

  const effectiveWorkflowId = result.workflow_id || workflowId;

  const workflow = effectiveWorkflowId ? store.getDefinition(effectiveWorkflowId, ownerUserId) : null;



  const replies = {

    trigger_workflow: () => {

      const tr = result.results?.find((r) => r.action === 'trigger_workflow');

      return tr ? `Started run #${tr.run_number}.` : 'Triggered.';

    },

    test_workflow: () => {

      const tr = result.results?.find((r) => r.action === 'test_workflow');

      return tr?.run ? `Test run #${tr.run_number}: ${tr.run.status}.` : `Test started #${tr?.run_number}.`;

    },

    open_workflow: () => (workflow ? `Opened "${workflow.name}".` : 'Opened.'),

    reload_workflow: () => (workflow ? `Reloaded "${workflow.name}".` : 'Reloaded.'),

    pause_workflow: () => 'Workflow paused.',

    resume_workflow: () => 'Workflow resumed.',

    unpublish_workflow: () =>

      workflow ? `"${workflow.name}" is now draft (unpublished).` : 'Reverted to draft.',

    pause_run: () => 'Run paused.',

    stop_run: () => 'Run stopped.',

    inspect_run: () => {

      const insp = result.results?.find((r) => r.action === 'inspect_run');

      if (insp?.run) {
        return formatRunFailureReply(
          { name: insp.run.definition_name || workflow?.name || 'Workflow' },
          insp.run
        );
      }
      return 'Run not found.';

    },

    pause_all_runs: () => {

      const pr = result.results?.find((r) => r.action === 'pause_all_runs');

      return `Paused ${pr?.paused ?? 0} run(s).`;

    },

    clone_workflow: () => {
      const cl = result.results?.find((r) =>
        ['clone_workflow', 'copy_workflow', 'duplicate_workflow'].includes(r.action)
      );
      if (cl?.ok) {
        return `Cloned "${cl.cloned_from_name || cl.cloned_from}" → **${cl.name}** (id: \`${cl.workflow_id}\`, status: ${cl.status}).`;
      }
      return cl?.error ? `Clone failed: ${cl.error}` : 'Clone completed.';
    },

  };



  const reply = (replies[command.cmd] || (() => 'Done.'))();



  let workflowTriggered = null;

  const tr = result.results?.find(

    (r) => ['trigger_workflow', 'test_workflow'].includes(r.action) && r.run_id

  );

  if (tr) {

    workflowTriggered = { run_id: tr.run_id, run_number: tr.run_number, definition_id: tr.definition_id };

  }



  return buildChatResultPayload({

    reply,

    modelUsed: null,

    effectiveWorkflowId,

    workflow,

    result,

    workflowTriggered,

  });

}



export async function runWorkflowBuilderChat({

  ownerUserId,

  workflowId = null,

  message,

  history = [],

  actor = null,

  persist = true,

}) {

  const trimmed = String(message || '').trim();

  if (!trimmed) throw new Error('message required');



  const actorNorm = {

    ...actor,

    id: actor?.id || WORKFLOW_BUILDER_AGENT_ID,

    name: actor?.name || 'Workflow Builder',

  };



  let effectiveHistory = Array.isArray(history) && history.length ? history : [];

  if (!effectiveHistory.length) {

    effectiveHistory = listWorkflowChatTurns(ownerUserId, workflowId, 50).map((t) => ({

      role: t.role,

      content: t.content,

    }));

  }



  const scheduleResult = tryScheduleQueryResponse(ownerUserId, workflowId, trimmed);
  if (scheduleResult) {
    const assistantText = scheduleResult.reply;
    if (persist) {
      appendWorkflowChatExchange(ownerUserId, scheduleResult.workflow_id || workflowId, trimmed, assistantText);
    }
    return {
      ...buildChatResultPayload({
        reply: assistantText,
        modelUsed: null,
        effectiveWorkflowId: scheduleResult.workflow_id || workflowId,
        workflow: scheduleResult.workflow,
        result: null,
        workflowTriggered: null,
      }),
      reply: assistantText,
      thread_workflow_id: workflowChatThreadKey(scheduleResult.workflow_id || workflowId),
    };
  }

  const describeResult = tryDescribeWorkflowResponse(ownerUserId, workflowId, trimmed);
  if (describeResult) {
    const assistantText = describeResult.reply;
    if (persist) {
      appendWorkflowChatExchange(ownerUserId, describeResult.workflow_id || workflowId, trimmed, assistantText);
    }
    return {
      ...buildChatResultPayload({
        reply: assistantText,
        modelUsed: null,
        effectiveWorkflowId: describeResult.workflow_id || workflowId,
        workflow: describeResult.workflow,
        result: null,
        workflowTriggered: null,
      }),
      reply: assistantText,
      thread_workflow_id: workflowChatThreadKey(describeResult.workflow_id || workflowId),
    };
  }

  const catalogResult = tryCatalogQueryResponse(trimmed);
  if (catalogResult) {
    const assistantText = catalogResult.reply;
    if (persist) {
      appendWorkflowChatExchange(ownerUserId, workflowId, trimmed, assistantText);
    }
    return {
      ...buildChatResultPayload({
        reply: assistantText,
        modelUsed: null,
        effectiveWorkflowId: workflowId,
        workflow: workflowId ? store.getDefinition(workflowId, ownerUserId) : null,
        result: null,
        workflowTriggered: null,
      }),
      reply: assistantText,
      thread_workflow_id: workflowChatThreadKey(workflowId),
    };
  }

  const troubleshootResult = tryTroubleshootWorkflowResponse(ownerUserId, workflowId, trimmed);
  if (troubleshootResult) {
    let result = { results: [] };
    let effectiveWorkflowId = troubleshootResult.workflow_id || workflowId;
    if (troubleshootResult.actions?.length) {
      result = await applyWorkflowBuilderActions(
        ownerUserId,
        effectiveWorkflowId,
        troubleshootResult.actions,
        actorNorm
      );
      effectiveWorkflowId = result.workflow_id || effectiveWorkflowId;
    }
    const workflow = effectiveWorkflowId ? store.getDefinition(effectiveWorkflowId, ownerUserId) : troubleshootResult.workflow;
    const diagnosis =
      workflow && troubleshootResult.actions?.length
        ? null
        : troubleshootResult.diagnosis;
    let reply = troubleshootResult.reply;
    if (troubleshootResult.actions?.length && workflow) {
      const { diagnoseWorkflowGraph, formatTroubleshootReply } = await import(
        './agent-workflow-agent-troubleshoot.js'
      );
      reply = formatTroubleshootReply(workflow, diagnoseWorkflowGraph(workflow), { applied: true });
    }
    const assistantText = formatAssistantReply(reply, result);
    if (persist) {
      appendWorkflowChatExchange(ownerUserId, effectiveWorkflowId || workflowId, trimmed, assistantText);
    }
    return {
      ...buildChatResultPayload({
        reply,
        modelUsed: null,
        effectiveWorkflowId,
        workflow,
        result,
        workflowTriggered: null,
      }),
      reply: assistantText,
      diagnosis,
      thread_workflow_id: workflowChatThreadKey(effectiveWorkflowId || workflowId),
    };
  }

  const failedRunResult = await tryFailedRunQueryResponse(ownerUserId, workflowId, trimmed);
  if (failedRunResult) {
    const assistantText = formatAssistantReply(failedRunResult.reply, {
      actions_applied: failedRunResult.actions_applied || [],
    });
    if (persist) {
      appendWorkflowChatExchange(ownerUserId, failedRunResult.workflow_id || workflowId, trimmed, assistantText);
    }
    return {
      ...buildChatResultPayload({
        reply: failedRunResult.reply,
        modelUsed: null,
        effectiveWorkflowId: failedRunResult.workflow_id || workflowId,
        workflow: failedRunResult.workflow || null,
        result: { results: failedRunResult.actions_applied || [] },
        workflowTriggered: null,
      }),
      reply: assistantText,
      thread_workflow_id: workflowChatThreadKey(failedRunResult.workflow_id || workflowId),
    };
  }

  const listRunsResult = await tryListRunsQueryResponse(ownerUserId, workflowId, trimmed);
  if (listRunsResult) {
    const assistantText = formatAssistantReply(listRunsResult.reply, {
      actions_applied: listRunsResult.actions_applied || [],
    });
    if (persist) {
      appendWorkflowChatExchange(ownerUserId, listRunsResult.workflow_id || workflowId, trimmed, assistantText);
    }
    return {
      ...buildChatResultPayload({
        reply: listRunsResult.reply,
        modelUsed: null,
        effectiveWorkflowId: listRunsResult.workflow_id || workflowId,
        workflow: listRunsResult.workflow || null,
        result: { results: listRunsResult.actions_applied || [] },
        workflowTriggered: null,
      }),
      reply: assistantText,
      thread_workflow_id: workflowChatThreadKey(listRunsResult.workflow_id || workflowId),
    };
  }

  const fastCommand = parseWorkflowAgentCommand(trimmed, { workflowId });

  if (fastCommand) {

    const fastResult = await executeFastPathCommand(ownerUserId, workflowId, fastCommand, actorNorm);

    if (fastResult) {

      const assistantText = formatAssistantReply(fastResult.reply, fastResult);

      if (persist) {

        appendWorkflowChatExchange(ownerUserId, fastResult.workflow_id || workflowId, trimmed, assistantText);

      }

      return {

        ...fastResult,

        reply: assistantText,

        thread_workflow_id: workflowChatThreadKey(fastResult.workflow_id || workflowId),

      };

    }

  }

  const recipeResult = await executeRecipePath(ownerUserId, workflowId, trimmed, actorNorm);

  if (recipeResult) {

    const assistantText = formatAssistantReply(recipeResult.reply, recipeResult);

    if (persist) {

      appendWorkflowChatExchange(ownerUserId, recipeResult.workflow_id || workflowId, trimmed, assistantText);

    }

    return {

      ...recipeResult,

      reply: assistantText,

      thread_workflow_id: workflowChatThreadKey(recipeResult.workflow_id || workflowId),

    };

  }



  const messages = [

    { role: 'system', content: SYSTEM_PROMPT },

    ...effectiveHistory.slice(-20).map((t) => ({

      role: t.role === 'assistant' ? 'assistant' : 'user',

      content: String(t.content || ''),

    })),

    { role: 'user', content: buildUserContext({ workflowId, ownerUserId, message: trimmed }) },

  ];



  const { content, modelUsed } = await chatCompletions({ messages, maxTokens: 4096, ownerUserId });

  const parsed = parseAgentJson(content);

  const reply = parsed.reply || content;

  let actions = Array.isArray(parsed.actions) ? parsed.actions : [];

  const runtime = buildWorkflowAgentRuntimeContext(ownerUserId);

  actions = enrichCreateWorkflowActions(trimmed, actions, runtime);

  const untilIntent = parseUntilSuccessIntent(trimmed);
  const certifyIntent =
    /\bcertif(?:y|ication|ied)\b/i.test(trimmed) ||
    /\bfully\s+autonomous\b/i.test(trimmed) ||
    /\bend\s*to\s*end\b.*\b(work|pass|ready)\b/i.test(trimmed);
  const hasUntilAction = actions.some((a) =>
    ['until_success', 'build_until_success', 'until_certified', 'certify_workflow'].includes(
      String(a?.action || a?.op || '').toLowerCase()
    )
  );
  if (!hasUntilAction) {
    if (certifyIntent) {
      actions = [
        ...actions,
        {
          action: 'until_certified',
          async: true,
          message: trimmed,
          max_attempts: untilIntent?.max_attempts || undefined,
        },
      ];
    } else if (untilIntent) {
      actions = [
        ...actions,
        {
          action: 'until_success',
          success_criteria: untilIntent.success_criteria || 'completed',
          input: untilIntent.input || undefined,
          max_attempts: untilIntent.max_attempts || 3,
        },
      ];
    }
  }

  let result = null;

  let effectiveWorkflowId = workflowId;



  if (actions.length) {
    // Apply non-until actions first, then run LLM-aware until_success loop
    const untilIdx = actions.findIndex((a) =>
      ['until_success', 'build_until_success'].includes(String(a?.action || a?.op || '').toLowerCase())
    );
    const untilAction = untilIdx >= 0 ? actions[untilIdx] : null;
    const prepActions = untilIdx >= 0 ? actions.filter((_, i) => i !== untilIdx) : actions;

    if (prepActions.length) {
      result = await applyWorkflowBuilderActions(ownerUserId, effectiveWorkflowId, prepActions, actorNorm, {
        message: trimmed,
      });
      effectiveWorkflowId = result.workflow_id || effectiveWorkflowId;

      // One automatic retry when mutations ran without a workflow context
      const contextMiss = (result.results || []).some(
        (r) =>
          r.ok === false &&
          /no workflow in context/i.test(String(r.error || ''))
      );
      if (contextMiss && !effectiveWorkflowId) {
        result = await applyWorkflowBuilderActions(ownerUserId, null, prepActions, actorNorm, {
          message: trimmed,
        });
        effectiveWorkflowId = result.workflow_id || effectiveWorkflowId;
      }
    }

    if (untilAction && effectiveWorkflowId) {
      const llmFixFn = async (ctx) => {
        const fixMessages = [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              'Fix the workflow so the next test meets success criteria. Return JSON { "reply": "...", "actions": [...] } only.',
              `Success criteria: ${ctx.successCriteria || untilAction.success_criteria || 'completed'}`,
              `Phase: ${ctx.phase}`,
              ctx.errors ? `Publish errors: ${JSON.stringify(ctx.errors).slice(0, 2000)}` : '',
              ctx.run ? `Failed run: ${JSON.stringify(ctx.run).slice(0, 3000)}` : '',
              ctx.diagnosis ? `Structural diagnosis: ${JSON.stringify(ctx.diagnosis.issues || []).slice(0, 2000)}` : '',
              ctx.graph_summary ? `Graph summary: ${JSON.stringify(ctx.graph_summary).slice(0, 2500)}` : '',
              'Do not include until_success or create_workflow. Prefer update_node, add_edge, delete_edge, set_metadata.',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ];
        try {
          const { content: fixContent } = await chatCompletions({
            messages: fixMessages,
            maxTokens: 2048,
            ownerUserId,
          });
          return parseAgentJson(fixContent).actions || [];
        } catch {
          return [];
        }
      };

      const outcome = await executeUntilSuccess({
        ownerUserId,
        workflowId: effectiveWorkflowId,
        actor: actorNorm,
        input: untilAction.input || untilAction.message || untilIntent?.input || 'Until-success validation run',
        successCriteria: untilAction.success_criteria || untilAction.criteria || untilIntent?.success_criteria || 'completed',
        maxAttempts: untilAction.max_attempts || untilIntent?.max_attempts || 3,
        timeoutMs: Number(untilAction.timeout_ms) || 45000,
        applyStructuralFixes: untilAction.apply_fixes !== false,
        llmFixFn,
      });
      effectiveWorkflowId = outcome.workflow_id || effectiveWorkflowId;
      const untilRow = {
        action: 'until_success',
        ok: outcome.success,
        success: outcome.success,
        attempts: outcome.attempts,
        last_run: outcome.last_run,
        success_criteria: outcome.success_criteria,
        workflow_id: effectiveWorkflowId,
      };
      result = {
        ...(result || {}),
        workflow_id: effectiveWorkflowId,
        workflow: outcome.workflow,
        draft_graph: outcome.workflow?.draft_graph,
        graph_summary: summarizeGraphForAgent(outcome.workflow?.draft_graph),
        results: [...(result?.results || []), untilRow],
        has_errors: !outcome.success || !!(result?.has_errors),
      };
    } else if (untilIdx >= 0 && !effectiveWorkflowId) {
      result = await applyWorkflowBuilderActions(ownerUserId, null, actions, actorNorm);
      effectiveWorkflowId = result.workflow_id;
    }
  }



  let workflowTriggered = null;

  if (actions.length && result?.results) {

    const tr = result.results.find((r) =>

      ['trigger_workflow', 'trigger_run', 'test_workflow', 'until_success', 'until_certified'].includes(r.action)

    );

    if (tr?.run_id || tr?.last_run?.run_id) {

      workflowTriggered = {

        run_id: tr.run_id || tr.last_run?.run_id,

        run_number: tr.run_number || tr.last_run?.run_number,

        definition_id: tr.definition_id || tr.last_run?.definition_id,

      };

    }

  }



  const workflow = effectiveWorkflowId ? store.getDefinition(effectiveWorkflowId, ownerUserId) : null;

  const payload = buildChatResultPayload({

    reply,

    modelUsed,

    effectiveWorkflowId,

    workflow,

    result,

    workflowTriggered,

  });

  const assistantText = formatAssistantReply(reply, payload);



  if (persist) {

    appendWorkflowChatExchange(ownerUserId, effectiveWorkflowId || workflowId, trimmed, assistantText);

  }



  return {

    ...payload,

    reply: assistantText,

    thread_workflow_id: workflowChatThreadKey(effectiveWorkflowId || workflowId),

  };

}



export function getWorkflowBuilderChatHistory(ownerUserId, workflowId = null, limit = 100) {

  return listWorkflowChatTurns(ownerUserId, workflowId, limit);

}



export { WORKFLOW_BUILDER_AGENT_ID };


