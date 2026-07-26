/**
 * Ensure deploy/runtime secrets exist in an env file.
 *
 * Docker deploy (before init):
 *   node scripts/ensure-deploy-secrets.js --env-file deploy/.env
 *
 * Ensures:
 *   TOOLS_API_KEY           — OpenClaw content-tools plugin ↔ backend
 *   AGENT_OS_INTERNAL_TOKEN — workflow runner / tools / cron-callback (stable across restarts)
 *   TOOLS_BASE_URL          — backend tool self-dispatch loopback (default http://127.0.0.1:3001)
 *   USER_API_KEYS_KEK       — wraps optional API Key vault encryption phrases
 *
 * For local openclaw.json sync of TOOLS_API_KEY, use ensure-tools-api-key.js.
 */
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_OS_ROOT = join(__dirname, '..');

function parseArgs(argv) {
  let envFile = join(AGENT_OS_ROOT, 'deploy', '.env');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--env-file' && argv[i + 1]) {
      envFile = argv[++i];
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      console.log(`Usage: node scripts/ensure-deploy-secrets.js [--env-file PATH]

Ensures TOOLS_API_KEY, AGENT_OS_INTERNAL_TOKEN, TOOLS_BASE_URL, and USER_API_KEYS_KEK in the env file.
Default: deploy/.env`);
      process.exit(0);
    }
    console.error('Unknown argument:', arg);
    process.exit(1);
  }
  return { envFile };
}

function readEnv(envPath) {
  return existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
}

function getEnvValue(content, key) {
  const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!match) return null;
  return match[1].trim();
}

function isPlaceholder(value) {
  if (!value) return true;
  if (value.length < 24) return true;
  const v = value.toLowerCase();
  return (
    v.startsWith('change-me') ||
    v === 'generate-a-long-random-secret' ||
    v === 'generate-a-long-random-token'
  );
}

function upsertEnvKey(envPath, key, value, comment) {
  let content = readEnv(envPath);
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) {
    content = content.replace(re, line);
  } else {
    const prefix = content.length && !content.endsWith('\n') ? '\n' : '';
    content = `${content}${prefix}\n# ${comment}\n${line}\n`;
  }
  writeFileSync(envPath, content, 'utf8');
}

function ensureSecret(envPath, key, bytes, comment) {
  const content = readEnv(envPath);
  const existing = getEnvValue(content, key);
  if (existing && !isPlaceholder(existing)) {
    console.log(`${envPath} already has ${key}`);
    return existing;
  }
  const value = randomBytes(bytes).toString('hex');
  upsertEnvKey(envPath, key, value, comment);
  console.log(existing == null ? `Added ${key} to ${envPath}` : `Replaced placeholder ${key} in ${envPath}`);
  return value;
}

const { envFile } = parseArgs(process.argv.slice(2));
if (!existsSync(envFile)) {
  console.error(`Env file not found: ${envFile}`);
  process.exit(1);
}

ensureSecret(envFile, 'TOOLS_API_KEY', 24, 'OpenClaw content-tools plugin auth (auto-generated)');
ensureSecret(
  envFile,
  'AGENT_OS_INTERNAL_TOKEN',
  32,
  'Internal service auth — workflow runner / tools / cron (auto-generated)'
);
ensureSecret(
  envFile,
  'USER_API_KEYS_KEK',
  32,
  'API Key vault KEK — wraps optional per-key encryption phrases (auto-generated)'
);

// Loopback self-dispatch for /api/tools/invoke (avoid public HTTPS / self-signed hairpin).
{
  const content = readEnv(envFile);
  const existing = getEnvValue(content, 'TOOLS_BASE_URL');
  const desired = 'http://127.0.0.1:3001';
  if (!existing) {
    upsertEnvKey(
      envFile,
      'TOOLS_BASE_URL',
      desired,
      'Backend tool self-dispatch (loopback; do not use public HTTPS)'
    );
    console.log(`Added TOOLS_BASE_URL=${desired} to ${envFile}`);
  } else {
    console.log(`${envFile} already has TOOLS_BASE_URL`);
  }
}

console.log('Deploy secrets ready. Restart backend (and re-run init if TOOLS_API_KEY was new) for changes to take effect.');
