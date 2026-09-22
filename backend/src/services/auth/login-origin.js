import { isIP } from 'net';
import geoip from 'geoip-lite';
import { getIsoCountry } from '../../lib/iso-country-region.js';
import { normalizeClientIp } from '../ip-match.js';

function isTrustedProxyPeer(raw) {
  const ip = normalizeClientIp(raw);
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  const match = ip.match(/^172\.(\d{1,3})\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return ip.startsWith('fc') || ip.startsWith('fd');
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) return value[0] || '';
  return String(value || '').split(',')[0].trim();
}

/** Resolve the client address without trusting headers from a public peer. */
export function loginClientIp(req) {
  const peer = normalizeClientIp(req?.socket?.remoteAddress || '');
  if (isTrustedProxyPeer(peer)) {
    const real = normalizeClientIp(firstHeaderValue(req?.headers?.['x-real-ip']));
    if (isIP(real)) return real;
    const forwarded = normalizeClientIp(firstHeaderValue(req?.headers?.['x-forwarded-for']));
    if (isIP(forwarded)) return forwarded;
  }
  return isIP(peer) ? peer : '';
}

/** Local, fail-open GeoIP lookup. Login never depends on network I/O. */
export function resolveIpCountry(clientIp) {
  if (!isIP(clientIp)) return { country_code: '', country_name: '' };
  try {
    const countryCode = String(geoip.lookup(clientIp)?.country || '').toUpperCase();
    const country = getIsoCountry(countryCode);
    return { country_code: country?.code || countryCode, country_name: country?.name || '' };
  } catch (_) {
    return { country_code: '', country_name: '' };
  }
}

export function loginOriginFromRequest(req) {
  const clientIp = loginClientIp(req);
  const country = resolveIpCountry(clientIp);
  return {
    clientIp,
    ipCountryCode: country.country_code,
    ipCountryName: country.country_name,
  };
}
