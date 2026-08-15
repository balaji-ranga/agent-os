/**
 * TOTP enrollment payload: otpauth URL includes the security key (never log the secret).
 */
import { generateTotpSecret, totpOtpauthUrl } from '../src/services/auth/totp.js';

const secret = generateTotpSecret();
const url = totpOtpauthUrl({ secret, email: 'ceo@example.com', issuer: 'Agent OS' });
if (!url.startsWith('otpauth://totp/')) {
  throw new Error(`expected otpauth URL, got ${url.slice(0, 40)}`);
}
if (!url.includes(`secret=${secret}`)) {
  throw new Error('otpauth URL missing security key');
}
if (!url.includes('issuer=')) {
  throw new Error('otpauth URL missing issuer');
}
console.log('totp enrollment fields ok');
