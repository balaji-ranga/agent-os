/**
 * Parse transient or workflow-node MCP auth (no .env dependency).
 * When `context` is provided, bearer + header values are rendered with {{nodeId.path}} templates.
 * @returns {{ headers: Record<string,string> }}
 */
import { renderWorkflowTemplates } from './agent-workflow-io.js';
import { renderHttpHeadersJson, parseHttpHeadersJson } from './http-headers.js';

export function parseMcpAuth(source = {}, context = null) {
  const auth = source.auth && typeof source.auth === 'object' ? source.auth : source;
  let bearer = String(auth.bearer || auth.bearerToken || auth.bearer_token || '').trim();
  if (context && bearer) bearer = renderWorkflowTemplates(bearer, context).trim();

  let headers = auth.headers || {};
  if (typeof headers === 'string') {
    headers = context ? renderHttpHeadersJson(headers, context) : parseHttpHeadersJson(headers);
  } else if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
    if (context) {
      const rendered = {};
      for (const [k, v] of Object.entries(headers)) {
        if (!String(k || '').trim()) continue;
        rendered[String(k).trim()] = renderWorkflowTemplates(String(v ?? ''), context);
      }
      headers = rendered;
    } else {
      headers = { ...headers };
    }
  } else {
    headers = {};
  }

  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v != null && String(v).trim()) out[k] = String(v).trim();
  }
  if (bearer) {
    out.Authorization = bearer.startsWith('Bearer ') ? bearer : `Bearer ${bearer}`;
  }
  return { headers: out };
}

export function parseMcpAuthFromNodeConfig(config = {}, context = null) {
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
      headers: headersRaw || '{}',
    },
    context
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
