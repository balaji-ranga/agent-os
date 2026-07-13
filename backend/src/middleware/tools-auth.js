/**
 * Auth for /api/tools/* — platform session OR TOOLS_API_KEY (OpenClaw plugin)
 * OR AGENT_OS_INTERNAL_TOKEN (workflow runner / same-host service).
 */
import { getToolsApiKey } from '../config/tools.js';
import { bearerToken, attachAuthUser } from '../middleware/auth.js';
import { getSessionUser } from '../services/auth/session.js';
import { isInternalRequest, internalServiceUser } from '../middleware/internal-auth.js';

export function requireToolsAccess(req, res, next) {
  if (isInternalRequest(req)) {
    req.isInternalService = true;
    req.authUser = req.authUser || internalServiceUser();
    return next();
  }

  const apiKey = getToolsApiKey();
  const token = bearerToken(req);

  if (apiKey && token === apiKey) {
    req.toolsApiAuth = true;
    return next();
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
    hint: 'Send Authorization: Bearer <platform-session-token>, TOOLS_API_KEY, or x-agent-os-internal',
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
    if (apiKey && token === apiKey) req.toolsApiAuth = true;
    next();
  });
}
