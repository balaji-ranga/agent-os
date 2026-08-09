/**
 * Shared client-IP extraction and CIDR matching (no DB).
 */
export function normalizeClientIp(raw) {
  let ip = String(raw || '').trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

/**
 * Client IP from trusted reverse-proxy headers.
 * Prefer X-Real-IP (nginx $remote_addr). For XFF use the right-most hop.
 */
export function clientIpFromRequest(req) {
  const real = req.headers?.['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return normalizeClientIp(real);
  const xf = req.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    const parts = xf.split(',').map((value) => value.trim()).filter(Boolean);
    return normalizeClientIp(parts[parts.length - 1]);
  }
  if (Array.isArray(xf) && xf.length) {
    const parts = String(xf[xf.length - 1]).split(',').map((value) => value.trim()).filter(Boolean);
    return normalizeClientIp(parts[parts.length - 1]);
  }
  return normalizeClientIp(req.socket?.remoteAddress || req.ip || '');
}

function ipv4ToInt(ip) {
  const parts = String(ip).split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

export function ipMatchesCidrOrIp(clientIp, rule) {
  const ip = normalizeClientIp(clientIp);
  const r = String(rule || '').trim();
  if (!ip || !r) return false;
  if (!r.includes('/')) return ip === normalizeClientIp(r);
  const [base, bitsStr] = r.split('/');
  const bits = Number(bitsStr);
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt == null || baseInt == null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return ip === normalizeClientIp(base);
  }
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}