/**
 * COO / parent-lead delegation to org leaf members (external agents and published A2A workflows).
 *
 * Leaf members run outside OpenClaw, so instead of a delegation cron we call them directly over
 * A2A, mirror the run on Kanban, and record the outcome for the member's error budget.
 *
 * Private A2A publications: public endpoints are denied. Only the COO or the leaf's reports-to
 * internal lead may invoke via this path (owner AgentExchange Test still bypasses separately).
 */
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { getOrgAgentMember, recordOrgMemberInvocation } from './org-agent-members.js';
import { enforceBudget } from './agent-budgets.js';
import { estimateTokens, recordTokenUsage } from './token-usage.js';
import { invokeExternalAgent } from './external-agents.js';
import { handleA2AJsonRpc } from './workflow-a2a-publish.js';
import { getCooAgentRow } from './org-context.js';
import { normalizeA2AVisibility } from './workflow-a2a-access.js';
import { extractA2AReply, findLocalA2APublication } from './a2a-local-invoke.js';
import { shouldCompleteKanbanForReply } from './kanban-reply-enrich.js';
import { applyPolicyEtaToTask } from './kanban-sla.js';

export { isOrgMemberKey, splitAllocationByKind } from './org-member-keys.js';

function createKanbanTask(ownerUserId, member, query, callerAgentId) {
  // Leaf members are not rows in `agents`, so the card is tracked by member key rather than
  // `assigned_agent_id` (which is foreign-keyed to `agents`).
  const info = getDb()
    .prepare(
      `INSERT INTO kanban_tasks (title, description, status, assigned_member_key, created_by, owner_user_id)
       VALUES (?, ?, 'in_progress', ?, ?, ?)`
    )
    .run(
      `${member.display_name}: ${String(query).slice(0, 80)}`,
      `[owner_user_id: ${ownerUserId}]\nDelegated by ${callerAgentId || 'coo'} to external/A2A agent ${member.id}.\n\n${query}`,
      member.id,
      callerAgentId || 'coo',
      String(ownerUserId)
    );
  const taskId = Number(info.lastInsertRowid);
  applyPolicyEtaToTask(taskId, ownerUserId, { context: query });
  return taskId;
}

function getPublicationVisibility(publishId) {
  const row = getDb()
    .prepare(`SELECT visibility FROM workflow_a2a_publications WHERE id = ? AND status = 'published'`)
    .get(String(publishId));
  return normalizeA2AVisibility(row?.visibility);
}

function getExternalAgentEndpoint(ownerUserId, externalAgentId) {
  const row = getDb()
    .prepare(`SELECT endpoint_url FROM external_agents WHERE id = ? AND owner_user_id = ?`)
    .get(String(externalAgentId), String(ownerUserId));
  return row?.endpoint_url || null;
}

/**
 * Publication behind an `external` leaf that is really one of this CEO's own A2A endpoints
 * (registered by URL rather than picked from the workflow list). Null for real third parties.
 */
function localPublicationForExternalMember(ownerUserId, member) {
  if (!member || member.kind !== 'external') return null;
  const endpoint = getExternalAgentEndpoint(ownerUserId, member.ref_id);
  if (!endpoint) return null;
  return findLocalA2APublication(endpoint, ownerUserId);
}

/**
 * Private A2A leaf members may only be invoked by the COO or their reports-to parent — including
 * leaves registered as External Agents that point back at one of this CEO's own publications.
 * Third-party external leaves and public A2A leaves are unrestricted at this layer.
 *
 * @returns {{ ok: boolean, reason?: string, visibility?: string }}
 */
export function canCallerInvokeOrgMember(ownerUserId, member, callerAgentId) {
  if (!member) return { ok: true, visibility: 'n/a' };
  let visibility;
  if (member.kind === 'a2a_publish') {
    visibility = getPublicationVisibility(member.ref_id);
  } else if (member.kind === 'external') {
    const pub = localPublicationForExternalMember(ownerUserId, member);
    visibility = pub ? normalizeA2AVisibility(pub.visibility) : 'n/a';
  } else {
    return { ok: true, visibility: 'n/a' };
  }
  if (visibility !== 'private') {
    return { ok: true, visibility };
  }
  const coo = getCooAgentRow();
  const caller = String(callerAgentId || '').trim();
  const parent = String(member.parent_id || '').trim();
  const cooId = coo?.id ? String(coo.id) : '';
  if (caller && (caller === cooId || caller === parent)) {
    return { ok: true, visibility };
  }
  // COO specialty / standup paths often omit an explicit caller — treat as COO when entitled.
  if (!caller && cooId) {
    return { ok: true, visibility, assumedCaller: cooId };
  }
  return {
    ok: false,
    visibility,
    reason: `Private A2A agent "${member.display_name}" can only be invoked by the COO or its reports-to lead (${parent || 'unset'}).`,
  };
}

function finishKanbanTask(taskId, out) {
  if (!taskId) return;
  try {
    const ok = out?.ok !== false && !out?.pending;
    const pending = !!out?.pending;
    const text = String(out?.text || '').trim();
    const state = String(out?.state || '').toLowerCase();
    // A2A / external leaves report a protocol terminal state (and usually task/run ids).
    // Trust that over the specialty-agent "status-only chatter" gate — otherwise a sync
    // workflow that returns "Workflow completed successfully." stays in_progress forever.
    const trustA2ATerminal =
      !!out?.taskId ||
      out?.runId != null ||
      ['completed', 'complete', 'success', 'failed', 'rejected', 'canceled', 'cancelled'].includes(state);
    let status = pending ? 'in_progress' : ok ? 'completed' : 'failed';
    if (status === 'completed' && !trustA2ATerminal && !shouldCompleteKanbanForReply(text)) {
      status = 'in_progress';
      console.warn(
        `[org-delegation] skip auto-complete kanban=${taskId} — status-only / empty A2A reply`
      );
    }
    const metaBits = [];
    if (out?.taskId) metaBits.push(`[a2a_task_id: ${out.taskId}]`);
    if (out?.runId != null) metaBits.push(`[workflow_run_id: ${out.runId}]`);
    const metaLine = metaBits.length ? `\n${metaBits.join(' ')}` : '';
    const resultBlock = `\n\n---\nResult:\n${text.slice(0, 2000)}${metaLine}`;
    getDb()
      .prepare(
        `UPDATE kanban_tasks
         SET status = ?,
             description = description || ?,
             a2a_task_id = COALESCE(?, a2a_task_id),
             workflow_run_id = COALESCE(?, workflow_run_id),
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        status,
        resultBlock,
        out?.taskId ? String(out.taskId) : null,
        out?.runId != null ? Number(out.runId) : null,
        taskId
      );
  } catch (e) {
    console.warn('[org-delegation] kanban finish failed', taskId, e?.message || e);
  }
}

async function invokeMember(ownerUserId, member, query) {
  if (member.kind === 'external') {
    // allowLocalBypass: leaves registered by URL may point back at one of this CEO's own
    // publications; a private / deny_all pub refuses the public hop, so invoke it in-process.
    // Entitlement is already enforced above by canCallerInvokeOrgMember.
    const out = await invokeExternalAgent(member.ref_id, ownerUserId, {
      message: query,
      waitForCompletion: true,
      allowLocalBypass: true,
    });
    return {
      ok: out.ok !== false,
      pending: !!out.pending,
      text: out.text || '',
      taskId: out.task_id || null,
      runId: out.run_id ?? null,
      state: out.task_state || null,
      raw: out,
    };
  }
  const rpc = {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'message/send',
    params: {
      message: { role: 'user', messageId: randomUUID(), parts: [{ kind: 'text', text: query }] },
      metadata: {},
    },
  };
  // Org path bypasses public IP / OAuth / private visibility — ACL is enforced above via
  // canCallerInvokeOrgMember (COO or reports-to lead only for private pubs).
  const result = await handleA2AJsonRpc(member.ref_id, rpc, {
    authHeader: null,
    clientIp: '127.0.0.1',
    bypassAccessChecks: true,
  });
  const body = result?.body ?? result;
  const reply = extractA2AReply(body);
  return { ...reply, raw: body };
}

/**
 * Run each allocated leaf member. Budget-blocked / ACL-blocked members are refused before the call.
 *
 * @param {string} ownerUserId
 * @param {Record<string,string>} allocation memberKey → task query
 * @param {{ callerAgentId?: string }} [opts]
 * @returns {Promise<{ delegated: Array, blocked: Array, failed: Array }>}
 */
export async function delegateToOrgMembers(ownerUserId, allocation = {}, opts = {}) {
  const delegated = [];
  const blocked = [];
  const failed = [];
  const callerAgentId = String(opts.callerAgentId || getCooAgentRow()?.id || '').trim();

  for (const [rawKey, query] of Object.entries(allocation)) {
    const member =
      getOrgAgentMember(ownerUserId, rawKey) ||
      getOrgAgentMember(ownerUserId, String(rawKey).toLowerCase());
    if (!member || !member.enabled) {
      console.warn(`[org-delegation] skipping unknown/disabled member=${rawKey} owner=${ownerUserId}`);
      continue;
    }

    // Refusals below are not recorded as invocations: the member never ran, so counting them
    // would spend its error budget and let one exhausted budget cascade into another.
    const acl = canCallerInvokeOrgMember(ownerUserId, member, callerAgentId);
    if (!acl.ok) {
      blocked.push({ member, reasons: [acl.reason], code: 'private_acl' });
      console.warn(
        `[org-delegation] private ACL blocked member=${member.id} caller=${callerAgentId || '-'} owner=${ownerUserId}`
      );
      continue;
    }

    const budget = enforceBudget(ownerUserId, member.id, {
      action: 'a2a_outbound',
      memberLabel: member.display_name,
      throwOnBlock: false,
    });
    if (budget?.state === 'blocked') {
      blocked.push({ member, reasons: budget.reasons });
      console.warn(
        `[org-delegation] budget blocked member=${member.id} owner=${ownerUserId} reasons="${budget.reasons.join('; ')}"`
      );
      continue;
    }

    const taskId = createKanbanTask(ownerUserId, member, query, callerAgentId || acl.assumedCaller);
    const started = Date.now();
    try {
      const out = await invokeMember(ownerUserId, member, query);
      const latency = Date.now() - started;
      recordOrgMemberInvocation(ownerUserId, member.id, {
        source: 'delegation',
        status: out.ok ? 'ok' : 'failed',
        errorMessage: out.ok ? null : out.text,
        latencyMs: latency,
        taskId: String(taskId),
      });
      recordTokenUsage(ownerUserId, {
        memberKey: member.id,
        source: 'a2a_outbound',
        inputTokens: estimateTokens(query),
        outputTokens: estimateTokens(out.text),
        estimated: true,
      });
      finishKanbanTask(taskId, out);
      console.log(
        `[org-delegation] member=${member.id} owner=${ownerUserId} ok=${out.ok} pending=${!!out.pending} latency_ms=${latency} kanban=${taskId} visibility=${acl.visibility}`
      );
      if (out.ok) delegated.push({ member, taskId, text: out.text, pending: !!out.pending });
      else failed.push({ member, taskId, error: out.text });
    } catch (e) {
      const latency = Date.now() - started;
      const msg = e?.message || String(e);
      recordOrgMemberInvocation(ownerUserId, member.id, {
        source: 'delegation',
        status: 'failed',
        errorMessage: msg,
        latencyMs: latency,
        taskId: String(taskId),
      });
      finishKanbanTask(taskId, { ok: false, text: msg });
      console.warn(`[org-delegation] member=${member.id} owner=${ownerUserId} failed: ${msg}`);
      failed.push({ member, taskId, error: msg });
    }
  }

  return { delegated, blocked, failed };
}

/** Direct invoke for an entitled caller (COO or reports-to lead). */
export async function invokeOrgMemberAsAgent(ownerUserId, memberKey, query, { callerAgentId } = {}) {
  const member = getOrgAgentMember(ownerUserId, memberKey);
  if (!member || !member.enabled) {
    throw new Error(`Org member not found or disabled: ${memberKey}`);
  }
  const caller = String(callerAgentId || '').trim();
  const acl = canCallerInvokeOrgMember(ownerUserId, member, caller);
  if (!acl.ok) {
    const err = new Error(acl.reason || 'Not allowed to invoke this private A2A agent');
    err.status = 403;
    err.code = 'private_acl';
    throw err;
  }
  enforceBudget(ownerUserId, member.id, {
    action: 'a2a_outbound',
    memberLabel: member.display_name,
    throwOnBlock: true,
  });
  const taskId = createKanbanTask(ownerUserId, member, query, caller || acl.assumedCaller);
  const started = Date.now();
  try {
    const out = await invokeMember(ownerUserId, member, query);
    const latency = Date.now() - started;
    recordOrgMemberInvocation(ownerUserId, member.id, {
      source: 'agent_lead',
      status: out.ok ? 'ok' : 'failed',
      errorMessage: out.ok ? null : out.text,
      latencyMs: latency,
      taskId: String(taskId),
    });
    recordTokenUsage(ownerUserId, {
      memberKey: member.id,
      source: 'a2a_outbound',
      inputTokens: estimateTokens(query),
      outputTokens: estimateTokens(out.text),
      estimated: true,
    });
    finishKanbanTask(taskId, out);
    return { ...out, taskId, member };
  } catch (e) {
    finishKanbanTask(taskId, { ok: false, text: e?.message || String(e) });
    throw e;
  }
}
