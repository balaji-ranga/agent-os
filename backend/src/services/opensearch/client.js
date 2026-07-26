/**
 * OpenSearch HTTP client - internal Docker network only (no public ports).
 * Optional basic auth via OPENSEARCH_USERNAME / OPENSEARCH_PASSWORD when the
 * security plugin is enabled; default compose uses network isolation only.
 */
import https from 'https';
import http from 'http';
import { URL } from 'url';

const DEFAULT_URL = 'http://opensearch:9200';

let warnedMissing = false;

export function getOpenSearchConfig() {
  const url = String(process.env.OPENSEARCH_URL || DEFAULT_URL).replace(/\/$/, '');
  const username = String(process.env.OPENSEARCH_USERNAME || 'admin').trim();
  const password = String(
    process.env.OPENSEARCH_PASSWORD || process.env.OPENSEARCH_ADMIN_PASSWORD || ''
  ).trim();
  const enabled =
    String(process.env.OPENSEARCH_ENABLED || '1').trim() !== '0' &&
    String(process.env.OPENSEARCH_ENABLED || '1').toLowerCase() !== 'false';
  return { url, username, password, enabled };
}

export function isOpenSearchConfigured() {
  const { enabled, url } = getOpenSearchConfig();
  return Boolean(enabled && url);
}

function authHeader() {
  const { username, password } = getOpenSearchConfig();
  if (!password) return {};
  const token = Buffer.from(`${username}:${password}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

function requestOnce(method, fullUrl, headers, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(fullUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method,
      headers,
      timeout: timeoutMs,
      rejectUnauthorized: false,
    };
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            json = { raw: text };
          }
        }
        resolve({ status: res.statusCode || 0, json, text });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      const err = new Error(`OpenSearch request timed out after ${timeoutMs}ms`);
      err.code = 'OPENSEARCH_TIMEOUT';
      reject(err);
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * @param {string} method
 * @param {string} path
 * @param {object|string|Buffer|null} body
 * @param {{ timeoutMs?: number, contentType?: string, allowStatuses?: number[] }} [opts]
 */
export async function opensearchRequest(method, path, body = null, opts = {}) {
  const { url, enabled } = getOpenSearchConfig();
  if (!enabled) {
    const err = new Error('OpenSearch is disabled (OPENSEARCH_ENABLED=0)');
    err.code = 'OPENSEARCH_DISABLED';
    throw err;
  }
  const p = path.startsWith('/') ? path : `/${path}`;
  const timeoutMs = Math.max(Number(opts.timeoutMs) || 30000, 1000);
  const methodUpper = String(method || 'GET').toUpperCase();
  const headers = {
    Accept: 'application/json',
    ...authHeader(),
  };
  let payload = null;
  // HEAD must not send a body; GET typically has none either.
  if (body != null && methodUpper !== 'HEAD' && methodUpper !== 'GET') {
    if (Buffer.isBuffer(body) || typeof body === 'string') {
      payload = body;
      headers['Content-Type'] = opts.contentType || 'application/json';
    } else {
      headers['Content-Type'] = opts.contentType || 'application/json';
      payload = JSON.stringify(body);
    }
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  const { status, json, text } = await requestOnce(
    methodUpper,
    `${url}${p}`,
    headers,
    payload,
    timeoutMs
  );
  const allow = Array.isArray(opts.allowStatuses) ? opts.allowStatuses : [];
  if ((status < 200 || status >= 300) && !allow.includes(status)) {
    const msg =
      json?.error?.reason ||
      json?.error?.type ||
      (typeof json?.error === 'string' ? json.error : null) ||
      text.slice(0, 300) ||
      `OpenSearch HTTP ${status}`;
    const err = new Error(msg);
    err.status = status;
    err.code = 'OPENSEARCH_ERROR';
    err.body = json;
    throw err;
  }
  return json;
}

/**
 * POST /_bulk with NDJSON body (application/x-ndjson).
 * @param {string|Buffer} ndjsonString
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function opensearchBulk(ndjsonString, opts = {}) {
  let body = typeof ndjsonString === 'string' ? ndjsonString : Buffer.from(ndjsonString || '');
  if (typeof body === 'string' && body.length && !body.endsWith('\n')) {
    body += '\n';
  }
  if (Buffer.isBuffer(body) && body.length && body[body.length - 1] !== 0x0a) {
    body = Buffer.concat([body, Buffer.from('\n')]);
  }
  const json = await opensearchRequest('POST', '/_bulk', body, {
    ...opts,
    contentType: 'application/x-ndjson',
    timeoutMs: opts.timeoutMs || 60000,
  });
  if (json?.errors) {
    const first = (json.items || []).find(
      (it) => it.index?.error || it.create?.error || it.update?.error || it.delete?.error
    );
    const errInfo =
      first?.index?.error || first?.create?.error || first?.update?.error || first?.delete?.error;
    console.warn(
      '[opensearch] bulk completed with item errors: %s',
      errInfo?.reason || errInfo?.type || 'unknown'
    );
  }
  return json;
}

export async function opensearchPing() {
  if (!isOpenSearchConfigured()) {
    if (!warnedMissing) {
      console.warn(
        '[opensearch] not configured - document RAG will fail until OPENSEARCH_URL is set'
      );
      warnedMissing = true;
    }
    return { ok: false, status: 'disabled' };
  }
  try {
    const health = await opensearchRequest('GET', '/_cluster/health', null, { timeoutMs: 8000 });
    return {
      ok: true,
      status: health?.status || 'unknown',
      cluster_name: health?.cluster_name,
      number_of_nodes: health?.number_of_nodes,
    };
  } catch (e) {
    return { ok: false, status: 'unreachable', error: e.message };
  }
}

export async function waitForOpenSearch({ attempts = 30, delayMs = 2000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const ping = await opensearchPing();
    if (ping.ok) {
      console.info('[opensearch] ready status=%s cluster=%s', ping.status, ping.cluster_name);
      return ping;
    }
    if (i === 0 || (i + 1) % 5 === 0) {
      console.info(
        '[opensearch] waiting attempt=%d/%d err=%s',
        i + 1,
        attempts,
        ping.error || ping.status
      );
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  const last = await opensearchPing();
  console.warn('[opensearch] not ready after %d attempts: %s', attempts, last.error || last.status);
  return last;
}
