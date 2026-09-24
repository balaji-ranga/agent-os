import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ALLOWED_SECRET_NAMES = new Set(['tool_broker', 'openclaw_gateway']);

export function platformRuntimeSecretsPath() {
  return process.env.PLATFORM_RUNTIME_SECRETS_PATH ||
    join(
      process.env.OPENCLAW_DIR || join(process.env.USERPROFILE || process.env.HOME || '', '.openclaw'),
      'platform-runtime-secrets.json'
    );
}

function readStore() {
  try {
    const parsed = JSON.parse(readFileSync(platformRuntimeSecretsPath(), 'utf8'));
    return parsed?.version === 1 && parsed.secrets && typeof parsed.secrets === 'object'
      ? parsed
      : { version: 1, secrets: {} };
  } catch {
    return { version: 1, secrets: {} };
  }
}

function writeStore(store) {
  const path = platformRuntimeSecretsPath();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, path);
  try { chmodSync(path, 0o600); } catch {}
}

function assertName(name) {
  const key = String(name || '').trim();
  if (!ALLOWED_SECRET_NAMES.has(key)) throw new Error('Unsupported platform runtime secret');
  return key;
}

export function getPlatformRuntimeSecret(name, envFallback = '') {
  const key = assertName(name);
  const value = String(readStore().secrets?.[key]?.value || '').trim();
  return value || String(envFallback || '').trim();
}

export function getOpenClawGatewayRuntimeToken() {
  return getPlatformRuntimeSecret(
    'openclaw_gateway',
    process.env.OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_PASSWORD || ''
  );
}

export function ensurePlatformRuntimeSecret(name, { envFallback = '', bytes = 32 } = {}) {
  const key = assertName(name);
  const store = readStore();
  const existing = String(store.secrets?.[key]?.value || '').trim();
  if (existing) return existing;
  const value = String(envFallback || '').trim() || randomBytes(bytes).toString('base64url');
  store.secrets[key] = {
    value,
    created_at: new Date().toISOString(),
    rotated_at: null,
  };
  writeStore(store);
  return value;
}

export function rotatePlatformRuntimeSecret(name, { bytes = 32 } = {}) {
  const key = assertName(name);
  const store = readStore();
  const now = new Date().toISOString();
  const value = randomBytes(bytes).toString('base64url');
  store.secrets[key] = {
    value,
    created_at: store.secrets?.[key]?.created_at || now,
    rotated_at: now,
  };
  writeStore(store);
  return { name: key, rotated_at: now, value };
}

export function setPlatformRuntimeSecret(name, value, { rotatedAt = new Date().toISOString() } = {}) {
  const key = assertName(name);
  const secret = String(value || '').trim();
  if (!secret) throw new Error('Runtime secret value is required');
  const store = readStore();
  store.secrets[key] = {
    value: secret,
    created_at: store.secrets?.[key]?.created_at || rotatedAt,
    rotated_at: rotatedAt,
  };
  writeStore(store);
  return { name: key, rotated_at: rotatedAt };
}

export function platformRuntimeSecretStatus() {
  const store = readStore();
  return [...ALLOWED_SECRET_NAMES].map((name) => ({
    name,
    configured: Boolean(String(store.secrets?.[name]?.value || '').trim()),
    created_at: store.secrets?.[name]?.created_at || null,
    rotated_at: store.secrets?.[name]?.rotated_at || null,
  }));
}

export function removePlatformRuntimeSecret(name) {
  const key = assertName(name);
  const store = readStore();
  if (!store.secrets?.[key]) return false;
  delete store.secrets[key];
  if (!Object.keys(store.secrets).length && existsSync(platformRuntimeSecretsPath())) {
    unlinkSync(platformRuntimeSecretsPath());
  } else {
    writeStore(store);
  }
  return true;
}
