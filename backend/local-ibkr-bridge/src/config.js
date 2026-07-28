/**
 * Env config for local IBKR bridge.
 * Loads backend/.env then local .env (local wins).
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROOT = resolve(__dirname, '..');
const BACKEND_ROOT = resolve(BRIDGE_ROOT, '..');

const backendEnv = join(BACKEND_ROOT, '.env');
const localEnv = join(BRIDGE_ROOT, '.env');
if (existsSync(backendEnv)) dotenv.config({ path: backendEnv });
if (existsSync(localEnv)) dotenv.config({ path: localEnv, override: true });

function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolve bridge token; may mint ephemeral for smoke when allowed.
 * @returns {{ token: string, ephemeral: boolean }}
 */
export function resolveBridgeToken() {
  let token = String(process.env.LOCAL_BRIDGE_TOKEN || '').trim();
  let ephemeral = false;
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (!token) {
    if (isProd) {
      throw new Error('LOCAL_BRIDGE_TOKEN is required when NODE_ENV=production');
    }
    if (truthy(process.env.BRIDGE_ALLOW_EPHEMERAL_TOKEN)) {
      token = randomBytes(24).toString('hex');
      ephemeral = true;
      process.env.LOCAL_BRIDGE_TOKEN = token;
    } else {
      throw new Error(
        'LOCAL_BRIDGE_TOKEN is empty — set it, or BRIDGE_ALLOW_EPHEMERAL_TOKEN=1 for local smoke'
      );
    }
  }
  return { token, ephemeral };
}

export function loadConfig() {
  const { token, ephemeral } = resolveBridgeToken();
  const host = String(process.env.BRIDGE_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const port = intEnv('BRIDGE_PORT', 3010);
  const retryRel = String(process.env.WEBHOOK_RETRY_FILE || 'data/webhook-retry.json').trim();
  const retryFile = resolve(BRIDGE_ROOT, retryRel);

  return {
    bridgeRoot: BRIDGE_ROOT,
    backendRoot: BACKEND_ROOT,
    host,
    port,
    token,
    ephemeralToken: ephemeral,
    mockIbkr: truthy(process.env.BRIDGE_MOCK_IBKR),
    webhookUrl: String(process.env.WEBHOOK_URL || '').trim(),
    webhookSecret: String(process.env.WEBHOOK_SECRET || '').trim(),
    webhookRetryFile: retryFile,
    webhookMaxAttempts: Math.max(1, intEnv('WEBHOOK_MAX_ATTEMPTS', 8)),
    webhookBaseBackoffMs: Math.max(100, intEnv('WEBHOOK_BASE_BACKOFF_MS', 1000)),
    equityMarkIntervalSec: Math.max(0, intEnv('EQUITY_MARK_INTERVAL_SEC', 300)),
    ibkr: {
      host: String(process.env.IBKR_HOST || '127.0.0.1').trim(),
      port: intEnv('IBKR_PORT', 4002),
      clientId: intEnv('IBKR_CLIENT_ID', 18),
      accountId: String(process.env.IBKR_ACCOUNT_ID || '').trim() || null,
      isPaper: isPaperAccount(),
      tradingEnabled: truthy(process.env.IBKR_TRADING_ENABLED),
    },
  };
}

/** True unless IBKR_IS_PAPER is explicitly off. */
export function isPaperAccount() {
  const v = String(process.env.IBKR_IS_PAPER ?? 'true').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

export function isTradingEnabled() {
  return truthy(process.env.IBKR_TRADING_ENABLED);
}

export { BRIDGE_ROOT, BACKEND_ROOT };
