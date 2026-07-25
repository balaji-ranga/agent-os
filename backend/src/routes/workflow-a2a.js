/**
 * Public A2A endpoints for published workflow agents.
 * All card / token / invoke attempts are written to workflow_a2a_invocation_logs
 * (including IP/auth denials that never start a workflow).
 */
import { Router, json as jsonParser, urlencoded } from 'express';
import {
  getPublicationById,
  handleA2AJsonRpc,
  issueA2AAccessToken,
} from '../services/workflow-a2a-publish.js';
import { checkA2AClientIp } from '../services/workflow-a2a-access.js';
import { clientIpFromRequest } from '../services/agent-workflow-desktop-auth.js';
import {
  logA2AInvocation,
  outcomeFromHttp,
  publicationLogContext,
} from '../services/workflow-a2a-invocation-log.js';

const router = Router();

function extractInvokeMeta(out) {
  const result = out?.result || {};
  const taskId = result?.task?.id || result?.metadata?.task_id || null;
  const runId =
    result?.metadata?.run_id ||
    result?.metadata?.run?.run_id ||
    null;
  const state = result?.task?.status?.state || null;
  return { taskId, runId, state };
}

function cardHandler(req, res) {
  const started = Date.now();
  const clientIp = clientIpFromRequest(req);
  const publishId = req.params.publishId;
  try {
    const pub = getPublicationById(publishId);
    if (!pub) {
      logA2AInvocation({
        publish_id: publishId,
        client_ip: clientIp,
        endpoint: 'card',
        outcome: 'error',
        reason_code: 'not_found',
        reason_message: 'A2A agent not found',
        http_status: 404,
        latency_ms: Date.now() - started,
        source: 'public',
        response: { error: 'A2A agent not found' },
      });
      return res.status(404).json({ error: 'A2A agent not found' });
    }
    const ctx = publicationLogContext(pub);
    const ipAccess = checkA2AClientIp(pub, clientIp);
    if (!ipAccess.ok) {
      const body = {
        error: ipAccess.reason,
        access_policy: ipAccess.policy,
      };
      logA2AInvocation({
        ...ctx,
        client_ip: clientIp,
        endpoint: 'card',
        outcome: 'denied',
        reason_code: 'ip_denied',
        reason_message: ipAccess.reason,
        http_status: 403,
        latency_ms: Date.now() - started,
        source: 'public',
        response: body,
      });
      return res.status(403).json(body);
    }
    logA2AInvocation({
      ...ctx,
      client_ip: clientIp,
      endpoint: 'card',
      outcome: 'success',
      reason_code: 'card_ok',
      reason_message: 'Agent card served',
      http_status: 200,
      latency_ms: Date.now() - started,
      source: 'public',
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(pub.agent_card);
  } catch (e) {
    logA2AInvocation({
      publish_id: publishId,
      client_ip: clientIp,
      endpoint: 'card',
      outcome: 'error',
      reason_code: 'exception',
      reason_message: e.message,
      http_status: 500,
      latency_ms: Date.now() - started,
      source: 'public',
    });
    res.status(500).json({ error: e.message });
  }
}

function parseClientCredentials(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  let clientId = body.client_id || body.clientId || '';
  let clientSecret = body.client_secret || body.clientSecret || '';

  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx >= 0) {
        if (!clientId) clientId = decoded.slice(0, idx);
        if (!clientSecret) clientSecret = decoded.slice(idx + 1);
      }
    } catch (_) {
      /* ignore malformed basic */
    }
  }

  return { clientId, clientSecret, grantType: body.grant_type || body.grantType || '' };
}

router.get('/:publishId/.well-known/agent-card.json', cardHandler);
router.get('/:publishId/.well-known/agent.json', cardHandler);

router.post(
  '/:publishId/oauth/token',
  urlencoded({ extended: false }),
  jsonParser(),
  (req, res) => {
    const started = Date.now();
    const clientIp = clientIpFromRequest(req);
    const publishId = req.params.publishId;
    const { clientId, clientSecret, grantType } = parseClientCredentials(req);
    const reqSnap = {
      grant_type: grantType || 'client_credentials',
      client_id: clientId || null,
      client_secret: clientSecret ? '[redacted]' : null,
    };
    try {
      const pub = getPublicationById(publishId);
      if (!pub) {
        const body = {
          error: 'invalid_client',
          error_description: 'A2A agent not found',
        };
        logA2AInvocation({
          publish_id: publishId,
          client_ip: clientIp,
          endpoint: 'oauth_token',
          outcome: 'error',
          reason_code: 'not_found',
          reason_message: 'A2A agent not found',
          http_status: 404,
          latency_ms: Date.now() - started,
          source: 'public',
          request: reqSnap,
          response: body,
        });
        return res.status(404).json(body);
      }
      const ctx = publicationLogContext(pub);
      const ipAccess = checkA2AClientIp(pub, clientIp);
      if (!ipAccess.ok) {
        const body = {
          error: 'access_denied',
          error_description: ipAccess.reason,
          access_policy: ipAccess.policy,
        };
        logA2AInvocation({
          ...ctx,
          client_ip: clientIp,
          endpoint: 'oauth_token',
          outcome: 'denied',
          reason_code: 'ip_denied',
          reason_message: ipAccess.reason,
          http_status: 403,
          latency_ms: Date.now() - started,
          source: 'public',
          request: reqSnap,
          response: body,
        });
        return res.status(403).json(body);
      }
      const gt = String(grantType || 'client_credentials').trim().toLowerCase();
      if (gt && gt !== 'client_credentials') {
        const body = {
          error: 'unsupported_grant_type',
          error_description: 'Only client_credentials is supported',
        };
        logA2AInvocation({
          ...ctx,
          client_ip: clientIp,
          endpoint: 'oauth_token',
          outcome: 'error',
          reason_code: 'unsupported_grant_type',
          reason_message: body.error_description,
          http_status: 400,
          latency_ms: Date.now() - started,
          source: 'public',
          request: reqSnap,
          response: body,
        });
        return res.status(400).json(body);
      }
      const token = issueA2AAccessToken(publishId, { clientId, clientSecret });
      logA2AInvocation({
        ...ctx,
        client_ip: clientIp,
        endpoint: 'oauth_token',
        outcome: 'success',
        reason_code: 'token_issued',
        reason_message: 'Access token issued',
        http_status: 200,
        latency_ms: Date.now() - started,
        source: 'public',
        request: reqSnap,
        response: { token_type: token.token_type, expires_in: token.expires_in },
      });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.json(token);
    } catch (e) {
      const status = e.status || 400;
      const body =
        e.oauth || {
          error: status === 401 ? 'invalid_client' : 'invalid_request',
          error_description: e.message,
        };
      const pub = getPublicationById(publishId);
      logA2AInvocation({
        ...publicationLogContext(pub),
        publish_id: publishId,
        client_ip: clientIp,
        endpoint: 'oauth_token',
        outcome: status === 401 ? 'denied' : 'error',
        reason_code: body.error || 'invalid_request',
        reason_message: body.error_description || e.message,
        http_status: status,
        latency_ms: Date.now() - started,
        source: 'public',
        request: reqSnap,
        response: body,
      });
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(status).json(body);
    }
  }
);

router.post('/:publishId', async (req, res) => {
  const started = Date.now();
  const clientIp = clientIpFromRequest(req);
  const publishId = req.params.publishId;
  const authHeader = req.headers.authorization || req.headers['x-a2a-auth'] || null;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const pub = getPublicationById(publishId);
  const ctx = publicationLogContext(pub);
  try {
    const out = await handleA2AJsonRpc(publishId, body, {
      authHeader,
      clientIp,
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const httpStatus =
      out.error?.code === -32001
        ? 404
        : out.error?.code === -32003
          ? 401
          : out.error?.code === -32005
            ? 403
            : out.error
              ? 400
              : 200;
    const { taskId, runId, state } = extractInvokeMeta(out);
    const reasonCode =
      out.error?.code === -32005
        ? 'ip_denied'
        : out.error?.code === -32003
          ? 'unauthorized'
          : out.error?.code != null
            ? String(out.error.code)
            : state === 'failed' || state === 'cancelled'
              ? state
              : 'invoke_ok';
    logA2AInvocation({
      ...ctx,
      publish_id: publishId,
      client_ip: clientIp,
      endpoint: 'invoke',
      rpc_method: body?.method || null,
      skill_id: body?.params?.metadata?.skillId || body?.params?.skillId || null,
      outcome: outcomeFromHttp(httpStatus, {
        jsonrpcCode: out.error?.code,
        runFailed: state === 'failed' || state === 'cancelled',
      }),
      reason_code: reasonCode,
      reason_message: out.error?.message || (state ? `task ${state}` : 'invoke ok'),
      http_status: httpStatus,
      jsonrpc_code: out.error?.code ?? null,
      jsonrpc_id: out.id != null ? String(out.id) : body?.id != null ? String(body.id) : null,
      task_id: taskId,
      run_id: runId,
      latency_ms: Date.now() - started,
      source: 'public',
      request: body,
      response: out.error || { task_id: taskId, state, run_id: runId },
    });
    res.status(httpStatus).json(out);
  } catch (e) {
    const errBody = {
      jsonrpc: '2.0',
      id: body?.id ?? null,
      error: { code: -32603, message: e.message },
    };
    logA2AInvocation({
      ...ctx,
      publish_id: publishId,
      client_ip: clientIp,
      endpoint: 'invoke',
      rpc_method: body?.method || null,
      outcome: 'error',
      reason_code: 'exception',
      reason_message: e.message,
      http_status: 500,
      jsonrpc_code: -32603,
      latency_ms: Date.now() - started,
      source: 'public',
      request: body,
      response: errBody,
    });
    res.status(500).json(errBody);
  }
});

export default router;
