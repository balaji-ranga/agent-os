/**
 * Minimal RFC 6238 TOTP (SHA-1, 30s, 6 digits) — no external deps.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(bytes = 20) {
  const buf = randomBytes(bytes);
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(secret) {
  const cleaned = String(secret || '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of cleaned) {
    const idx = BASE32.indexOf(c);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1e6).padStart(6, '0');
}

export function generateTotp(secret, { step = 30, at = Date.now() } = {}) {
  const counter = Math.floor(at / 1000 / step);
  return hotp(base32Decode(secret), counter);
}

export function verifyTotp(secret, token, { step = 30, window = 1, at = Date.now() } = {}) {
  const expectedLen = 6;
  const code = String(token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code) || code.length !== expectedLen) return false;
  const secretBuf = base32Decode(secret);
  const counter = Math.floor(at / 1000 / step);
  for (let i = -window; i <= window; i++) {
    const candidate = hotp(secretBuf, counter + i);
    const a = Buffer.from(candidate, 'utf8');
    const b = Buffer.from(code, 'utf8');
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function totpOtpauthUrl({ secret, email, issuer = 'Agent OS' }) {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const iss = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${iss}&algorithm=SHA1&digits=6&period=30`;
}
