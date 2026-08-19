/**
 * Block private / link-local / metadata targets. HTTPS only unless WEB_SCRAPE_ALLOW_HTTP=1.
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

function allowHttp() {
  const v = String(process.env.WEB_SCRAPE_ALLOW_HTTP || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function isPrivateIp(ip) {
  const raw = String(ip || '').trim().replace(/^\[|\]$/g, '');
  if (!raw) return true;
  if (raw === '::1' || raw === '0:0:0:0:0:0:0:1') return true;
  if (/^fe80:/i.test(raw) || /^fc/i.test(raw) || /^fd/i.test(raw) || /^::ffff:127\./i.test(raw)) {
    return true;
  }
  const v4mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const v4 = v4mapped ? v4mapped[1] : net.isIP(raw) === 4 ? raw : null;
  if (!v4) {
    // Public IPv6 is allowed. Block multicast / documentation ranges only.
    if (net.isIP(raw) === 6) {
      if (/^ff/i.test(raw) || /^2001:db8:/i.test(raw)) return true;
      return false;
    }
    return true;
  }
  const p = v4.split('.').map((n) => Number(n));
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return true;
  if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
  if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true;
  return false;
}

export function parsePublicHttpsUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) throw Object.assign(new Error('url is required'), { status: 400 });
  let u;
  try {
    u = new URL(s);
  } catch {
    throw Object.assign(new Error('Invalid URL'), { status: 400 });
  }
  const proto = u.protocol.replace(':', '').toLowerCase();
  if (proto === 'http' && !allowHttp()) {
    throw Object.assign(new Error('Only HTTPS URLs are allowed'), { status: 400 });
  }
  if (proto !== 'https' && proto !== 'http') {
    throw Object.assign(new Error('Only HTTP(S) URLs are allowed'), { status: 400 });
  }
  if (u.username || u.password) {
    throw Object.assign(new Error('URL host is not allowed'), { status: 400 });
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.localhost')) {
    throw Object.assign(new Error('URL host is not allowed'), { status: 400 });
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    throw Object.assign(new Error('URL host is not allowed'), { status: 400 });
  }
  return u;
}

export async function assertPublicResolvedHost(urlObj) {
  const host = urlObj.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw Object.assign(new Error('URL host is not allowed'), { status: 400 });
    return;
  }
  let addrs = [];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch (e) {
    throw Object.assign(new Error(`DNS lookup failed for host`), { status: 400, cause: e });
  }
  if (!addrs.length) throw Object.assign(new Error('URL host is not allowed'), { status: 400 });
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw Object.assign(new Error('URL host is not allowed'), { status: 400 });
    }
  }
}

export function sameOrigin(a, b) {
  try {
    const ua = a instanceof URL ? a : new URL(String(a));
    const ub = b instanceof URL ? b : new URL(String(b));
    return ua.protocol === ub.protocol && ua.hostname.toLowerCase() === ub.hostname.toLowerCase();
  } catch {
    return false;
  }
}
