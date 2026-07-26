#!/usr/bin/env node
/**
 * Manual encrypt / decrypt for the API Keys vault (same crypto as user-api-keys.js).
 *
 * Env:
 *   USER_API_KEYS_KEK  — platform key-encryption-key (required for wrap/unwrap phrase)
 *
 * Encrypt a secret with a passphrase (produces row fields):
 *   USER_API_KEYS_KEK=... node scripts/vault-crypto-cli.js encrypt \
 *     --secret 'sk-...' --phrase 'my-phrase'
 *
 * Decrypt from vault row fields (or JSON):
 *   USER_API_KEYS_KEK=... node scripts/vault-crypto-cli.js decrypt \
 *     --secret-b64 '...' --salt-b64 '...' --iv-b64 '...' --tag-b64 '...' \
 *     --phrase-wrapped '...'
 *
 *   USER_API_KEYS_KEK=... node scripts/vault-crypto-cli.js decrypt --json '{...}'
 *
 * Wrap / unwrap passphrase alone (platform KEK layer):
 *   USER_API_KEYS_KEK=... node scripts/vault-crypto-cli.js wrap-phrase --phrase 'my-phrase'
 *   USER_API_KEYS_KEK=... node scripts/vault-crypto-cli.js unwrap-phrase --phrase-wrapped '...'
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';

function usage(code = 1) {
  console.error(`Usage:
  encrypt        --secret <plain> --phrase <phrase>
  decrypt        --secret-b64 <b64> --salt-b64 <b64> --iv-b64 <b64> --tag-b64 <b64> --phrase-wrapped <b64>
  decrypt        --json '<row json with those fields>'
  wrap-phrase    --phrase <phrase>
  unwrap-phrase  --phrase-wrapped <b64>

Env: USER_API_KEYS_KEK (sha256 -> 32-byte AES key)

Algorithms (matches backend/src/services/user-api-keys.js):
  phrase wrap:  AES-256-GCM(key=SHA256(USER_API_KEYS_KEK), iv=12B) -> base64(iv||tag||ciphertext)
  secret:       scrypt(phrase, salt16) -> AES-256-GCM -> secret_value/salt_b64/iv_b64/tag_b64 + phrase_wrapped
`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '1';
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

function platformKek() {
  const raw = String(process.env.USER_API_KEYS_KEK || '').trim();
  if (!raw) {
    console.error('USER_API_KEYS_KEK is not set');
    process.exit(2);
  }
  return createHash('sha256').update(raw, 'utf8').digest();
}

function wrapPhrase(phrase) {
  const kek = platformKek();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  const enc = Buffer.concat([cipher.update(String(phrase), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function unwrapPhrase(wrappedB64) {
  const kek = platformKek();
  const buf = Buffer.from(String(wrappedB64 || ''), 'base64');
  if (buf.length < 28) throw new Error('Invalid wrapped phrase (too short)');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function encryptSecretWithPhrase(secret, phrase) {
  const salt = randomBytes(16);
  const key = scryptSync(String(phrase), salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    secret_value: enc.toString('base64'),
    salt_b64: salt.toString('base64'),
    iv_b64: iv.toString('base64'),
    tag_b64: tag.toString('base64'),
    phrase_wrapped: wrapPhrase(phrase),
    is_encrypted: 1,
  };
}

function decryptSecretRow(row) {
  if (!row.is_encrypted || row.is_encrypted === 0 || row.is_encrypted === '0') {
    return String(row.secret_value || row.secret || '');
  }
  const phrase = unwrapPhrase(row.phrase_wrapped);
  const salt = Buffer.from(row.salt_b64, 'base64');
  const iv = Buffer.from(row.iv_b64, 'base64');
  const tag = Buffer.from(row.tag_b64, 'base64');
  const key = scryptSync(phrase, salt, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const data = Buffer.from(row.secret_value || row.secret_b64, 'base64');
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args._[0]) usage(args.help ? 0 : 1);
const cmd = args._[0];

try {
  if (cmd === 'encrypt') {
    const secret = args.secret;
    const phrase = args.phrase;
    if (!secret || !phrase) usage(1);
    console.log(JSON.stringify(encryptSecretWithPhrase(secret, phrase), null, 2));
  } else if (cmd === 'decrypt') {
    let row;
    if (args.json) {
      row = JSON.parse(args.json);
    } else {
      row = {
        is_encrypted: 1,
        secret_value: args['secret-b64'] || args.secret_b64,
        salt_b64: args['salt-b64'] || args.salt_b64,
        iv_b64: args['iv-b64'] || args.iv_b64,
        tag_b64: args['tag-b64'] || args.tag_b64,
        phrase_wrapped: args['phrase-wrapped'] || args.phrase_wrapped,
      };
    }
    if (!row.secret_value && args.secret) {
      console.log(args.secret);
      process.exit(0);
    }
    console.log(decryptSecretRow(row));
  } else if (cmd === 'wrap-phrase') {
    if (!args.phrase) usage(1);
    console.log(wrapPhrase(args.phrase));
  } else if (cmd === 'unwrap-phrase') {
    const w = args['phrase-wrapped'] || args.phrase_wrapped;
    if (!w) usage(1);
    console.log(unwrapPhrase(w));
  } else {
    usage(1);
  }
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}