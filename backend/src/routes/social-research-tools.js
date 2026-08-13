/**
 * Social Research + Business Discovery content tools.
 * Owner-scoped; never trust body ceo_user_id for authorization.
 */
import { Router } from 'express';
import { getDb } from '../db/schema.js';
import { resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { assertCallerMayUseTool } from '../services/openclaw-agent-tools.js';
import {
  resolveToolOwnerUserIdOrNull,
  bodyWithoutSpoofedOwner,
} from '../services/tool-owner-scope.js';
import {
  researchSearch,
  researchProfile,
  researchInstagram,
  researchFacebook,
  geocodeLocality,
  nearbySearch,
  discoverBusinesses,
} from '../services/social-research/index.js';

const router = Router();

function logTool(req, toolName, requestPayload, responsePayload, status, source = null) {
  try {
    const ownerUserId = resolveToolOwnerUserIdOrNull(
      req,
      requestPayload,
      resolveAuthenticatedCeoUserId
    );
    getDb()
      .prepare(
        `INSERT INTO content_tool_logs (tool_name, source, request_payload, response_payload, status, owner_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        toolName,
        source || null,
        JSON.stringify(redact(requestPayload) || {}),
        JSON.stringify(redact(responsePayload) || {}),
        status,
        ownerUserId || null
      );
  } catch (_) {}
}

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (/key|token|secret|password|authorization/i.test(k)) out[k] = '[redacted]';
  }
  return out;
}

function callerSource(req) {
  return req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || req.headers['x-request-source'] || null;
}

function requireOwner(req, payload) {
  const ownerUserId = resolveToolOwnerUserIdOrNull(req, payload, resolveAuthenticatedCeoUserId);
  if (!ownerUserId) {
    const err = new Error('Could not resolve entitled CEO for this session');
    err.status = 403;
    throw err;
  }
  return ownerUserId;
}

function assertGrant(source, toolName) {
  if (!source) return;
  const grantCheck = assertCallerMayUseTool(source, toolName);
  if (!grantCheck.ok) {
    const err = new Error(grantCheck.error || 'Tool not allowed for this agent');
    err.status = 403;
    throw err;
  }
}

function wrap(toolName, handler) {
  return async (req, res) => {
    const source = callerSource(req);
    const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
    try {
      assertGrant(source, toolName);
      const ownerUserId = requireOwner(req, requestPayload);
      const out = await handler(ownerUserId, requestPayload, { source, req });
      logTool(req, toolName, requestPayload, { ok: true }, 'ok', source);
      res.json(out);
    } catch (e) {
      const status = e.status || 500;
      const err = { error: e.message || 'Internal error', code: e.code };
      if (e.google_places_byok_key_name) {
        err.google_places_byok_key_name = e.google_places_byok_key_name;
      }
      logTool(req, toolName, requestPayload, err, 'error', source);
      res.status(status).json(err);
    }
  };
}

router.post(
  '/social-research-search',
  wrap('social_research_search', (owner, body) => researchSearch(owner, body))
);

router.post(
  '/social-research-instagram',
  wrap('social_research_instagram', (owner, body) =>
    researchInstagram(owner, {
      handle: body.handle || body.username,
      brand: body.brand || body.query,
      days: body.days,
      limit: body.limit,
    })
  )
);

router.post(
  '/social-research-facebook',
  wrap('social_research_facebook', (owner, body) =>
    researchFacebook(owner, { brand: body.brand || body.query, days: body.days, limit: body.limit })
  )
);

router.post(
  '/social-research-profile',
  wrap('social_research_profile', (owner, body) => researchProfile(owner, body))
);

router.post(
  '/google-places-geocode',
  wrap('google_places_geocode', (owner, body) =>
    geocodeLocality(owner, { locality: body.locality || body.address || body.query })
  )
);

router.post(
  '/google-places-nearby',
  wrap('google_places_nearby', (owner, body) => nearbySearch(owner, body))
);

router.post(
  '/business-discover',
  wrap('business_discover', (owner, body, ctx) => {
    const createdBy =
      String(ctx.source || '')
        .split('--')
        .pop()
        ?.replace(/^agent:/, '') || 'businessdiscovery';
    return discoverBusinesses(owner, body, { createdByAgentId: createdBy });
  })
);

export default router;
