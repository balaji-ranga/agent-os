/**
 * Outbound URL guard (SSRF). Keep IP/host rules aligned with tools/web-scrape-mcp/ssrf.js:
 * HTTPS by default, block loopback / RFC1918 / link-local / metadata; public IPv6 allowed.
 */
import dns from 'node:dns/promises';
import net from 'node:net';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

export class SafeOutboundUrlError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'SafeOutboundUrlError';
    this.status = status;
  }
}

function fail(message, status = 400) {
  throw new SafeOutboundUrlError(message, status);
}

function normalizeHost(host) {
  return String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

export function isPrivateIp(ip) {
  const raw = String(ip || '').trim().replace(/^\[|\]$/g, '');
  if (!raw) return true;
  if (raw === '::1' || raw === '0:0:0:0:0:0:0:1') return true;
  if (/^fe80:/i.test(raw) || /^fc/i.test(raw) || /^fd/i.test(raw) || /^::ffff:127\./i.test(raw)) {
    return true;
  }
  const v4mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const v4 = v4mapped ? v4mapped[1] : net.isIP(raw) === 4 ? raw : decodeIpv4Literal(raw);
  if (!v4) {
    if (net.isIP(raw) === 6) {
      if (/^ff/i.test(raw) || /^2001:db8:/i.test(raw)) return true;
      return false;
    }
    return true;
  }
  const p = v4.split('.').map((n) => Number(n));
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;
  if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
  if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true;
  return false;
}

/** Integer / octal / hex IPv4 literals (SSRF encodings of 127.0.0.1). */
function decodeIpv4Literal(host) {
  const h = String(host || '').trim();
  if (!h) return null;
  if (/^\d+$/.test(h)) {
    const n = Number(h);
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }
  if (/^(0x)?[0-9a-f.]+$/i.test(h) && /[.]/.test(h)) {
    const parts = h.split('.');
    if (parts.length !== 4) return null;
    const nums = parts.map((p) => {
      if (/^0x/i.test(p)) return parseInt(p, 16);
      if (/^0[0-7]+$/.test(p)) return parseInt(p, 8);
      if (/^\d+$/.test(p)) return parseInt(p, 10);
      return NaN;
    });
    if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
    return nums.join('.');
  }
  return null;
}

function hostLooksBlocked(host) {
  const h = normalizeHost(host);
  if (!h) return true;
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith('.local') || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  const asIp = net.isIP(h) ? h : decodeIpv4Literal(h);
  if (asIp && isPrivateIp(asIp)) return true;
  return false;
}

export function hostMatchesAllowedDomains(hostname, allowedDomains) {
  if (!allowedDomains || !allowedDomains.length) return true;
  const host = normalizeHost(hostname);
  return allowedDomains.some((d) => {
    const dom = normalizeHost(d);
    if (!dom) return false;
    return host === dom || host.endsWith('.' + dom);
  });
}

/**
 * Parse and statically validate an outbound URL. Does not DNS-resolve.
 * @param {string} raw
 * @param {{ allowedDomains?: string[] | null, httpsOnly?: boolean }} [opts]
 */
export function parsePublicHttpsUrl(raw, opts = {}) {
  const s = String(raw || '').trim();
  if (!s) fail('url is required');
  let u;
  try {
    u = new URL(s);
  } catch {
    fail('Invalid URL');
  }
  const httpsOnly = opts.httpsOnly !== false;
  const proto = u.protocol.replace(':', '').toLowerCase();
  if (httpsOnly && proto !== 'https') fail('Only HTTPS URLs are allowed');
  if (proto !== 'https' && proto !== 'http') fail('Only HTTPS URLs are allowed');
  if (u.username || u.password) fail('URL host is not allowed');
  const host = normalizeHost(u.hostname);
  if (hostLooksBlocked(host)) fail('URL host is not allowed');
  if (opts.allowedDomains?.length && !hostMatchesAllowedDomains(host, opts.allowedDomains)) {
    fail('URL domain not allowed');
  }
  return u;
}

/** Rebuild href from validated parts so credentials / weird encodings cannot leak into fetch. */
export function toSafeHref(urlObj) {
  const proto = urlObj.protocol === 'http:' ? 'http:' : 'https:';
  const host = normalizeHost(urlObj.hostname);
  if (!host) fail('URL host is not allowed');
  const port = urlObj.port ? `:${urlObj.port}` : '';
  const path = urlObj.pathname || '/';
  const search = urlObj.search || '';
  return `${proto}//${host}${port}${path}${search}`;
}

export async function assertPublicResolvedHost(urlObj) {
  const host = normalizeHost(urlObj.hostname);
  if (net.isIP(host) || decodeIpv4Literal(host)) {
    const ip = net.isIP(host) ? host : decodeIpv4Literal(host);
    if (isPrivateIp(ip)) fail('URL host is not allowed');
    return;
  }
  let addrs = [];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch (e) {
    const err = new SafeOutboundUrlError('Failed to fetch URL', 400);
    err.cause = e;
    throw err;
  }
  if (!addrs.length) fail('URL host is not allowed');
  for (const a of addrs) {
    if (isPrivateIp(a.address)) fail('URL host is not allowed');
  }
}

/**
 * Validate protocol/host/allowlist, resolve DNS, return a credential-free href.
 * @returns {Promise<string>}
 */
export async function assertSafeOutboundHttpsUrl(raw, opts = {}) {
  const parsed = parsePublicHttpsUrl(raw, opts);
  await assertPublicResolvedHost(parsed);
  const href = toSafeHref(parsed);
  return href;
}
