/**
 * OpenClaw Admin HTTP RPC client (POST /api/v1/admin/rpc).
 * Used for operator methods that are not on the chat-completions HTTP API
 * (e.g. web.login.start / web.login.wait for WhatsApp QR).
 *
 * Requires the bundled `admin-http-rpc` plugin enabled on the gateway.
 * Call only from the backend on the private Docker network — never expose
 * this route through public nginx.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_PORT = 18789;
let _cachedGatewayToken = null;

function getGatewayUrl() {
  const base = process.env.OPENCLAW_GATEWAY_URL || `http://127.0.0.1:${DEFAULT_PORT}`;
  return base.replace(/\/$/, '');
}

function getGatewayToken() {
  if (_cachedGatewayToken) return _cachedGatewayToken;
  const fromEnv = process.env.OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_PASSWORD || '';
  if (fromEnv) {
    _cachedGatewayToken = fromEnv;
    return fromEnv;
  }
  const homedir = process.env.USERPROFILE || process.env.HOME || '';
  const cfgPath = process.env.OPENCLAW_CONFIG_PATH || join(homedir, '.openclaw', 'openclaw.json');
  if (existsSync(cfgPath)) {
    try {
      const token = JSON.parse(readFileSync(cfgPath, 'utf8'))?.gateway?.auth?.token || '';
      if (token) {
        _cachedGatewayToken = token;
        return token;
      }
    } catch (_) {}
  }
  return '';
}

/**
 * @param {string} method
 * @param {object} [params]
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ id: string, ok: boolean, payload?: any, error?: any }>}
 */
export async function openclawAdminRpc(method, params = {}, opts = {}) {
  const name = String(method || '').trim();
  if (!name) throw new Error('Admin RPC method is required');

  const timeoutMs = Number(opts.timeoutMs || process.env.OPENCLAW_ADMIN_RPC_TIMEOUT_MS || 90000);
  const url = `${getGatewayUrl()}/api/v1/admin/rpc`;
  const token = getGatewayToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method: name, params: params ?? {} }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const msg = e?.message || String(e);
    console.error('[openclaw-admin-rpc] unreachable method=%s err=%s', name, msg);
    throw new Error(`OpenClaw admin RPC unreachable (${getGatewayUrl()}): ${msg}`);
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, error: { message: text || res.statusText } };
  }

  if (!res.ok && data?.ok !== true) {
    const errMsg = data?.error?.message || text || res.statusText;
    console.warn('[openclaw-admin-rpc] http=%s method=%s err=%s', res.status, name, errMsg);
    const err = new Error(errMsg);
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.code = data?.error?.code || null;
    err.rpc = data;
    throw err;
  }

  if (data?.ok === false) {
    const errMsg = data?.error?.message || `Admin RPC ${name} failed`;
    console.warn('[openclaw-admin-rpc] method=%s failed: %s', name, errMsg);
    const err = new Error(errMsg);
    err.status = 400;
    err.code = data?.error?.code || null;
    err.rpc = data;
    throw err;
  }

  console.info('[openclaw-admin-rpc] ok method=%s', name);
  return data;
}
