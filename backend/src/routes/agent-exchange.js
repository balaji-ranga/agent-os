/**
 * AgentExchange — browse all published A2A workflow agents (union across users).
 */
import { randomUUID } from 'crypto';
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin } from '../middleware/auth.js';
import { getDb } from '../db/schema.js';
import {
  getPublicationById,
  handleA2AJsonRpc,
  listAllPublishedA2AAgents,
  unpublishA2APublicationById,
} from '../services/workflow-a2a-publish.js';
import {
  addA2AIpWhitelistEntry,
  getA2AAccessSettings,
  removeA2AIpWhitelistEntry,
  setA2AAccessPolicy,
  setA2AVisibility,
} from '../services/workflow-a2a-access.js';
import { clientIpFromRequest } from '../services/agent-workflow-desktop-auth.js';
import {
  logA2AInvocation,
  outcomeFromHttp,
  publicationLogContext,
} from '../services/workflow-a2a-invocation-log.js';

const router = Router();

router.use(requireAuth);
router.use(requireCeoOrAdmin);

function entitledOwnerUserId(req) {
  if (req.authUser?.role === 'ceo') return String(req.authUser.id);
  if (req.authUser?.role === 'admin' && req.authUser.impersonation) {
    return String(req.authUser.id);
  }
  return null;
}

function requireEntitledOwner(req, res) {
  const ownerUserId = entitledOwnerUserId(req);
  if (!ownerUserId) {
    res.status(403).json({ error: 'An entitled CEO session is required to manage this agent' });
    return null;
  }
  return ownerUserId;
}

function actor(req) {
  return {
    id: req.authUser?.id,
    name: req.authUser?.name || req.authUser?.email || req.authUser?.id,
    type: 'user',
  };
}

router.get('/', (req, res) => {
  try {
    const ownerUserId = entitledOwnerUserId(req);
    const agents = listAllPublishedA2AAgents({ includePrivateForOwnerId: ownerUserId }).map(
      (agent) => ({
        ...agent,
        can_manage: !!ownerUserId && agent.owner_user_id === ownerUserId,
      })
    );
    res.json({ agents, count: agents.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:publishId/access', (req, res) => {
  try {
    const ownerUserId = requireEntitledOwner(req, res);
    if (!ownerUserId) return;
    const settings = getA2AAccessSettings(req.params.publishId, ownerUserId);
    if (!settings) return res.status(404).json({ error: 'Agent not found or not owned by this user' });
    res.json({ ...settings, current_ip: clientIpFromRequest(req) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/:publishId/access', (req, res) => {
  try {
    const ownerUserId = requireEntitledOwner(req, res);
    if (!ownerUserId) return;
    let settings = null;
    if (req.body?.visibility != null || req.body?.Visibility != null) {
      settings = setA2AVisibility(
        req.params.publishId,
        ownerUserId,
        req.body?.visibility ?? req.body?.Visibility
      );
      if (!settings) return res.status(404).json({ error: 'Agent not found or not owned by this user' });
    }
    if (req.body?.access_policy != null || req.body?.accessPolicy != null) {
      settings = setA2AAccessPolicy(
        req.params.publishId,
        ownerUserId,
        req.body?.access_policy ?? req.body?.accessPolicy
      );
      if (!settings) return res.status(404).json({ error: 'Agent not found or not owned by this user' });
    }
    if (!settings) {
      settings = getA2AAccessSettings(req.params.publishId, ownerUserId);
    }
    if (!settings) return res.status(404).json({ error: 'Agent not found or not owned by this user' });
    res.json({ ...settings, current_ip: clientIpFromRequest(req) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/:publishId/visibility', (req, res) => {
  try {
    const ownerUserId = requireEntitledOwner(req, res);
    if (!ownerUserId) return;
    const settings = setA2AVisibility(
      req.params.publishId,
      ownerUserId,
      req.body?.visibility ?? req.body?.Visibility
    );
    if (!settings) return res.status(404).json({ error: 'Agent not found or not owned by this user' });
    res.json({ ...settings, current_ip: clientIpFromRequest(req) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:publishId/ip-whitelist', (req, res) => {
  try {
    const ownerUserId = requireEntitledOwner(req, res);
    if (!ownerUserId) return;
    const settings = addA2AIpWhitelistEntry(req.params.publishId, ownerUserId, req.body || {});
    if (!settings) return res.status(404).json({ error: 'Agent not found or not owned by this user' });
    res.status(201).json({ ...settings, current_ip: clientIpFromRequest(req) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:publishId/ip-whitelist/:entryId', (req, res) => {
  try {
    const ownerUserId = requireEntitledOwner(req, res);
    if (!ownerUserId) return;
    const settings = removeA2AIpWhitelistEntry(
      req.params.publishId,
      req.params.entryId,
      ownerUserId
    );
    if (!settings) return res.status(404).json({ error: 'Whitelist entry not found' });
    res.json({ ...settings, current_ip: clientIpFromRequest(req) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * Build sample input from agent card / input_schema for Test UI autofill.
 * GET /agent-exchange/:publishId/test-sample?skillId=enquire-progress
 */
router.get('/:publishId/test-sample', (req, res) => {
  try {
    const pub = listAllPublishedA2AAgents({
      includePrivateForOwnerId: entitledOwnerUserId(req),
    }).find((a) => a.id === req.params.publishId);
    if (!pub) return res.status(404).json({ error: 'Agent not found or unpublished' });

    const skills = Array.isArray(pub.agent_card?.skills) ? pub.agent_card.skills : [];
    const wantSkill = String(req.query.skillId || req.query.skill_id || '').trim();
    const primary =
      (wantSkill && skills.find((s) => s?.id === wantSkill)) ||
      skills.find((s) => s?.id && s.id === pub.skill_id) ||
      skills.find((s) => s?.id && s.id !== 'enquire-progress') ||
      null;

    let mode = 'text';
    let sample = `Test invoke for ${pub.name || 'agent'}`;
    let schema = null;
    let help = '';

    if (primary?.id === 'enquire-progress') {
      mode = 'json';
      schema = primary.inputSchema || primary.input_schema || null;
      sample = { taskId: '<uuid from async accept / result.task.id>' };
      help =
        'Enquiry polls an async run. Paste taskId from the async accept (result.task.id). Optional: runId. Same as JSON-RPC tasks/get.';
    } else {
      schema =
        primary?.inputSchema ||
        primary?.input_schema ||
        pub.input_schema ||
        null;
      if (schema && typeof schema === 'object') {
        mode = 'json';
        sample = exampleFromSchema(schema);
        help =
          'Primary agent skill — send this JSON as the message body. Async agents return working + task id first; then poll enquire-progress.';
      } else if (Array.isArray(primary?.examples) && primary.examples.length) {
        sample = String(primary.examples[0]);
        help = 'No inputSchema — using skill examples from the agent card.';
      }
    }

    const ownerUserId = entitledOwnerUserId(req);
    res.json({
      publish_id: pub.id,
      name: pub.name,
      skill_id: primary?.id || pub.skill_id || 'default',
      skills: skills
        .filter((s) => s?.id)
        .map((s) => ({ id: s.id, name: s.name || s.id, description: s.description || '' })),
      invoke_mode: pub.invoke_mode || 'sync',
      auth_mode: pub.auth_mode || 'public',
      access_policy: pub.access_policy || 'deny_all',
      visibility: pub.visibility || 'public',
      can_bypass_access: !!ownerUserId && pub.owner_user_id === ownerUserId,
      mode,
      sample,
      help,
      input_schema: schema,
      enquire_response_sample: {
        jsonrpc: '2.0',
        id: '<rpc id>',
        result: {
          kind: 'message',
          role: 'agent',
          parts: [{ kind: 'text', text: 'Workflow still running. / Final output' }],
          task: { id: '<taskId>', status: { state: 'working | completed | failed' } },
          metadata: { run: { run_id: 123, status: 'running', progress_pct: 40 } },
        },
      },
      callback_sample: {
        event: 'a2a.workflow.completed',
        task_id: '<uuid>',
        publish_id: pub.id,
        final_output: '…',
        status: { state: 'completed' },
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Authenticated test invoke. Owners bypass IP deny/whitelist and OAuth so they can
 * exercise the agent from AgentExchange even when public endpoints deny all.
 * Non-owners still go through IP + OAuth policy on the public A2A path.
 * POST /agent-exchange/:publishId/test
 * Body: { skillId?, input?|message?, access_token?, callbackUrl?, rpc? }
 */
router.post('/:publishId/test', async (req, res) => {
  const started = Date.now();
  const clientIp = clientIpFromRequest(req);
  try {
    const publishId = req.params.publishId;
    const db = getDb();
    const row = db
      .prepare(`SELECT * FROM workflow_a2a_publications WHERE id = ? AND status = 'published'`)
      .get(publishId);
    if (!row) {
      logA2AInvocation({
        publish_id: publishId,
        client_ip: clientIp,
        endpoint: 'invoke',
        outcome: 'error',
        reason_code: 'not_found',
        reason_message: 'Agent not found or unpublished',
        http_status: 404,
        latency_ms: Date.now() - started,
        source: 'agent_exchange_test',
      });
      return res.status(404).json({ error: 'Agent not found or unpublished' });
    }

    const ownerUserId = entitledOwnerUserId(req);
    const isOwner = !!ownerUserId && String(row.owner_user_id) === String(ownerUserId);
    const bypassAccessChecks = isOwner;
    const pub = getPublicationById(publishId);
    const ctx = publicationLogContext(pub || row);

    let body = req.body?.rpc;
    if (!body || typeof body !== 'object') {
      const skillId =
        req.body?.skillId || req.body?.skill_id || row.skill_id || 'default';
      const input = req.body?.input ?? req.body?.message ?? '';
      const parts =
        input !== null && typeof input === 'object' && !Array.isArray(input)
          ? [{ kind: 'data', data: input }]
          : [{ kind: 'text', text: String(input) }];
      const metadata = { skillId };
      const callbackUrl = req.body?.callbackUrl || req.body?.callback_url;
      if (callbackUrl) metadata.callbackUrl = String(callbackUrl).trim();
      body = {
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            messageId: randomUUID(),
            parts,
          },
          metadata,
        },
      };
    }

    let authHeader = null;
    if (!bypassAccessChecks) {
      const token = req.body?.access_token || req.body?.accessToken;
      authHeader = token
        ? `Bearer ${String(token).trim()}`
        : req.headers.authorization || null;
    }

    const result = await handleA2AJsonRpc(publishId, body, {
      authHeader,
      clientIp,
      bypassAccessChecks,
    });

    const taskId = result?.result?.task?.id || null;
    const runId =
      result?.result?.metadata?.run_id || result?.result?.metadata?.run?.run_id || null;
    const state = result?.result?.task?.status?.state || null;

    if (result?.error) {
      const code = result.error.code;
      const status =
        code === -32001 || code === -32002 || code === -32004
          ? 404
          : code === -32003 || code === -32005
            ? 403
            : 400;
      logA2AInvocation({
        ...ctx,
        client_ip: clientIp,
        endpoint: 'invoke',
        rpc_method: body?.method || null,
        skill_id: body?.params?.metadata?.skillId || null,
        outcome: outcomeFromHttp(status, { jsonrpcCode: code }),
        reason_code:
          code === -32005 ? 'ip_denied' : code === -32003 ? 'unauthorized' : String(code),
        reason_message: result.error.message,
        http_status: status,
        jsonrpc_code: code,
        jsonrpc_id: result.id != null ? String(result.id) : null,
        latency_ms: Date.now() - started,
        source: 'agent_exchange_test',
        bypass_access: bypassAccessChecks,
        request: body,
        response: result.error,
      });
      return res.status(status).json({
        error: result.error.message,
        code,
        data: result.error.data || null,
        result,
        bypassed_access: bypassAccessChecks,
      });
    }

    logA2AInvocation({
      ...ctx,
      client_ip: clientIp,
      endpoint: 'invoke',
      rpc_method: body?.method || null,
      skill_id: body?.params?.metadata?.skillId || null,
      outcome: outcomeFromHttp(200, {
        runFailed: state === 'failed' || state === 'cancelled',
      }),
      reason_code: bypassAccessChecks ? 'owner_test_bypass' : 'invoke_ok',
      reason_message: state ? `task ${state}` : 'invoke ok',
      http_status: 200,
      task_id: taskId,
      run_id: runId,
      latency_ms: Date.now() - started,
      source: 'agent_exchange_test',
      bypass_access: bypassAccessChecks,
      request: body,
      response: { task_id: taskId, state, run_id: runId },
    });

    res.json({
      ok: true,
      bypassed_access: bypassAccessChecks,
      result,
    });
  } catch (e) {
    logA2AInvocation({
      publish_id: req.params.publishId,
      client_ip: clientIp,
      endpoint: 'invoke',
      outcome: 'error',
      reason_code: 'exception',
      reason_message: e.message,
      http_status: 500,
      latency_ms: Date.now() - started,
      source: 'agent_exchange_test',
    });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:publishId', (req, res) => {
  try {
    const ownerUserId = requireEntitledOwner(req, res);
    if (!ownerUserId) return;
    res.json(
      unpublishA2APublicationById(ownerUserId, req.params.publishId, actor(req))
    );
  } catch (e) {
    const status = e.message.includes('not found') || e.message.includes('not owned') ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

/** Minimal JSON Schema → sample (mirrors frontend a2aTestSample). */
function exampleFromSchema(schema) {
  if (!schema || typeof schema !== 'object') return {};
  if (Object.prototype.hasOwnProperty.call(schema, 'const')) return schema.const;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) {
    return exampleFromSchema(schema.anyOf[0] || {});
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    return exampleFromSchema(schema.oneOf[0] || {});
  }
  const type = schema.type;
  if (type === 'object' || schema.properties) {
    const out = {};
    for (const [key, prop] of Object.entries(schema.properties || {})) {
      out[key] = exampleFromSchema(prop || {});
    }
    return out;
  }
  if (type === 'array') return [exampleFromSchema(schema.items || { type: 'string' })];
  if (type === 'integer' || type === 'number') {
    if (typeof schema.minimum === 'number') {
      return schema.exclusiveMinimum === true ? schema.minimum + 1 : schema.minimum;
    }
    return type === 'integer' ? 0 : 0;
  }
  if (type === 'boolean') return false;
  if (type === 'null') return null;
  if (schema.format === 'email') return 'user@example.com';
  if (schema.format === 'uri' || schema.format === 'url') return 'https://example.com';
  return 'sample';
}

export default router;
