/**
 * Parse transient or workflow-node MCP auth (no .env dependency).
 * When `context` is provided, bearer + header values are rendered with {{nodeId.path}} templates.
 * When ownerUserId is available, authBearerRef and header { $keyRef } values are resolved from vault.
 * @returns {{ headers: Record<string,string> }}
 */
import { renderWorkflowTemplates } from './agent-workflow-io.js';
import { parseHttpHeadersJson } from './http-headers.js';
import { resolveLiteralOrKeyRef, resolveHeadersObject } from './user-api-keys.js';

function ownerFromContext(context, ownerUserId) {
  return (
    String(ownerUserId || context?.owner_user_id || context?.ownerUserId || context?.ceo_user_id || '').trim() ||
    null
  );
}

/** Render string header values; leave { $keyRef } objects for vault resolution. */
function renderHeadersPreserveKeyRef(headers, context = null) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const name = String(k || '').trim();
    if (!name) continue;
    if (v != null && typeof v === 'object' && !Array.isArray(v) && v.$keyRef) {
      out[name] = v;
    } else if (v != null) {
      const s = String(v);
      out[name] = context ? renderWorkflowTemplates(s, context) : s;
    }
  }
  return out;
}

export function parseMcpAuth(source = {}, context = null, ownerUserId = null) {
  const auth = source.auth && typeof source.auth === 'object' ? source.auth : source;
  const owner = ownerFromContext(context, ownerUserId);

  let literalBearer = String(auth.bearer || auth.bearerToken || auth.bearer_token || '').trim();
  if (context && literalBearer) literalBearer = renderWorkflowTemplates(literalBearer, context).trim();
  const bearer = resolveLiteralOrKeyRef(owner, {
    literal: literalBearer,
    keyRef:
      auth.authBearerRef ||
      auth.auth_bearer_ref ||
      auth.bearerTokenRef ||
      auth.bearer_token_ref ||
      '',
  });

  let headers = auth.headers || {};
  if (typeof headers === 'string') {
    headers = parseHttpHeadersJson(headers);
  } else if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
    headers = { ...headers };
  } else {
    headers = {};
  }
  headers = renderHeadersPreserveKeyRef(headers, context);
  headers = owner ? resolveHeadersObject(owner, headers) : (() => {
    const plain = {};
    for (const [k, v] of Object.entries(headers)) {
      if (v != null && typeof v === 'object' && v.$keyRef) continue;
      if (v != null && String(v).trim()) plain[k] = String(v).trim();
    }
    return plain;
  })();

  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v != null && String(v).trim()) out[k] = String(v).trim();
  }
  if (bearer) {
    out.Authorization = bearer.startsWith('Bearer ') ? bearer : `Bearer ${bearer}`;
  }
  return { headers: out };
}

export function parseMcpAuthFromNodeConfig(config = {}, context = null, ownerUserId = null) {
  let headersRaw =
    config.httpHeadersJson ||
    config.http_headers_json ||
    config.authHeadersJson ||
    config.auth_headers_json ||
    '';
  if (config.authHeaders && typeof config.authHeaders === 'object') {
    headersRaw = JSON.stringify(config.authHeaders);
  }
  return parseMcpAuth(
    {
      bearer: config.authBearer || config.auth_bearer || config.bearerToken || config.bearer_token || '',
      authBearerRef:
        config.authBearerRef ||
        config.auth_bearer_ref ||
        config.bearerTokenRef ||
        config.bearer_token_ref ||
        '',
      headers: headersRaw || '{}',
    },
    context,
    ownerUserId
  );
}

export function redactMcpAuthForLog(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const copy = JSON.parse(JSON.stringify(obj));
  if (copy.auth) {
    copy.auth = { bearer: copy.auth.bearer ? '***' : '', headers: '***' };
  }
  if (copy.headers?.Authorization) copy.headers.Authorization = '***';
  return copy;
}
