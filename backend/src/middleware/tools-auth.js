/**
 * Auth for /api/tools/* — platform session OR TOOLS_API_KEY (OpenClaw plugin)
 * OR AGENT_OS_INTERNAL_TOKEN (workflow runner / same-host service).
 */
import { getToolsApiKey } from '../config/tools.js';
import { bearerToken, attachAuthUser } from '../middleware/auth.js';
import { getSessionUser } from '../services/auth/session.js';
import { isInternalRequest, internalServiceUser } from '../middleware/internal-auth.js';
import { verifyToolScopedToken } from '../services/tool-scoped-token.js';

function applyScopedToolAuth(req, token) {
  const scoped = verifyToolScopedToken(token);
  if (!scoped) return false;
  const requestedOwner = String(
    req.headers?.['x-ceo-user-id'] || req.headers?.['x-agent-os-user-id'] || ''
  ).trim();
  const headerAgent = String(req.headers?.['x-openclaw-agent-id'] || req.headers?.['x-agent-id'] || '').trim();
  const bodyAgent = String(req.body?.caller_agent_id || req.body?.x_openclaw_agent_id || '').trim();
  const requestedAgent = headerAgent || bodyAgent;
  if (requestedOwner && requestedOwner !== scoped.ownerUserId) return false;
  if (!scoped.agentId || !requestedAgent || requestedAgent !== scoped.agentId) return false;
  if (headerAgent && bodyAgent && headerAgent !== bodyAgent) return false;
  req.toolsApiAuth = true;
  req.toolsOwnerUserId = scoped.ownerUserId;
  req.toolsAgentId = scoped.agentId;
  return true;
}

function isDirectServiceRequest(req) {
  if (req.headers?.['x-forwarded-for'] || req.headers?.forwarded) return false;
  const ip = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('10.') || ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

export function requireToolsAccess(req, res, next) {
  if (isInternalRequest(req)) {
    req.isInternalService = true;
    req.authUser = req.authUser || internalServiceUser();
    return next();
  }

  const apiKey = getToolsApiKey();
  const token = bearerToken(req);

  if (token && applyScopedToolAuth(req, token)) return next();

  if (apiKey && token === apiKey) {
    if (isDirectServiceRequest(req)) {
      req.toolsApiAuth = true;
      req.legacyToolsApiAuth = true;
      return next();
    }
    return res.status(401).json({
      error: 'Owner-scoped tool credential required',
      hint: 'Update the Flolah/OpenClaw content-tools extension to the current version',
    });
  }

  if (token) {
    const user = getSessionUser(token);
    if (user) {
      req.authUser = user;
      req.sessionToken = token;
      return next();
    }
  }

  return res.status(401).json({
    error: 'Authentication required',
    hint: 'Send a platform session, owner-scoped tool credential, or x-agent-os-internal',
  });
}

export function attachToolsAuth(req, res, next) {
  attachAuthUser(req, res, () => {
    if (isInternalRequest(req)) {
      req.isInternalService = true;
      req.authUser = req.authUser || internalServiceUser();
    }
    const apiKey = getToolsApiKey();
    const token = bearerToken(req);
    if (token) applyScopedToolAuth(req, token);
    if (apiKey && token === apiKey) req.legacyToolsApiAuth = true;
    next();
  });
}
