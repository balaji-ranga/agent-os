/** Build an owner-scoped Windows package from the maintained IBKRNew bridge source. */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { getPublicBaseUrl } from '../config/public-url.js';
import { buildZipBuffer } from './zip-store.js';
import { getBundledWindowsNodeFiles, DESKTOP_NODE_VERSION } from './desktop-windows-node-runtime.js';
import { registerBridge, revokeBridge } from './ibkrnew-event-trader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(__dirname, '../..');
const PACKAGE_ROOT = join(BACKEND_ROOT, 'ibkrnew-event-bridge');
const DEPENDENCIES_ROOT = join(PACKAGE_ROOT, 'node_modules');
const SOURCE_SKIP_DIRS = new Set(['node_modules', 'data', 'logs', '.git']);
const SOURCE_SKIP_FILES = new Set(['.env']);

function walkFiles(root, { skipDirs = new Set(), skipFiles = new Set() } = {}, current = root) {
  const out = [];
  for (const name of readdirSync(current)) {
    if (skipDirs.has(name) || skipFiles.has(name)) continue;
    const absolute = join(current, name);
    const entry = statSync(absolute);
    if (entry.isDirectory()) out.push(...walkFiles(root, { skipDirs, skipFiles }, absolute));
    else out.push({ absolute, relative: relative(root, absolute).replace(/\\/g, '/') });
  }
  return out;
}

function normalizedApiUrl(value) {
  const raw = String(value || '').trim().replace(/\/$/, '').replace(/\/api$/i, '');
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('A valid Flolah public URL is required to build the IBKRNew bridge package');
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}/api/ibkrnew-event-trader`;
}

/**
 * The credential is issued only after package source, dependencies, and runtime prerequisites pass.
 * The real IBKR account identifier is deliberately never accepted by this function.
 */
export async function buildIbkrNewEventBridgePackageZip({ ownerUserId, includeRuntime = true, baseUrlOverride = null } = {}) {
  if (!ownerUserId) throw new Error('Owner is required');
  if (!existsSync(PACKAGE_ROOT)) throw new Error('IBKRNew event bridge package source is missing');
  const withRuntime = includeRuntime !== false;
  if (withRuntime && !existsSync(DEPENDENCIES_ROOT)) throw new Error('IBKRNew production dependencies are missing from the backend image');

  const runtimeFiles = withRuntime ? await getBundledWindowsNodeFiles() : [];
  if (withRuntime && !runtimeFiles.length && process.env.DESKTOP_PACKAGE_SKIP_NODE_RUNTIME !== '1') throw new Error('Bundled Windows Node runtime is missing');
  const apiUrl = normalizedApiUrl(baseUrlOverride || getPublicBaseUrl());
  const credentials = registerBridge(ownerUserId);

  const files = walkFiles(PACKAGE_ROOT, { skipDirs: SOURCE_SKIP_DIRS, skipFiles: SOURCE_SKIP_FILES }).map((file) => ({
    name: file.relative,
    content: readFileSync(file.absolute),
    compress: true,
  }));
  if (withRuntime) {
    for (const file of walkFiles(DEPENDENCIES_ROOT)) {
      files.push({ name: `node_modules/${file.relative}`, content: readFileSync(file.absolute), compress: true });
    }
  }

  files.push({
    name: '.env',
    compress: true,
    content: [
      `IBKRNEW_API_URL=${apiUrl}`,
      `IBKRNEW_BRIDGE_ID=${credentials.bridge_id}`,
      `IBKRNEW_BRIDGE_TOKEN=${credentials.token}`,
      'IBKRNEW_GATEWAY_HOST=127.0.0.1',
      'IBKRNEW_GATEWAY_PORT=4002',
      'IBKRNEW_CLIENT_ID=41',
      'IBKRNEW_ACCOUNT_ID=',
      'IBKRNEW_SPOOL_DIR=./data',
      'IBKRNEW_INSTRUMENT_PROFILES_FILE=./IBKRNew-instrument-profiles.json',
      'IBKRNEW_MOCK=0',
      'IBKRNEW_PAPER_EXECUTION_ENABLED=0',
      '',
    ].join('\n'),
  });
  files.push({
    name: 'bridge.meta.json',
    compress: true,
    content: `${JSON.stringify({
      format: 'flolah-ibkrnew-event-bridge',
      version: 1,
      exported_at: new Date().toISOString(),
      bridge_id: credentials.bridge_id,
      account_ref: credentials.account_ref,
      token_prefix: credentials.token.slice(0, 12),
      api_url: apiUrl,
      environment: 'paper',
      include_runtime: withRuntime,
      dependencies_included: withRuntime,
      bundled_node_version: withRuntime ? DESKTOP_NODE_VERSION : null,
    }, null, 2)}\n`,
  });
  files.push(...runtimeFiles);

  try {
    return {
      zip: buildZipBuffer(files),
      filename: withRuntime ? 'IBKRNewBridge-desktop.zip' : 'IBKRNewBridge-lite.zip',
      bridge_id: credentials.bridge_id,
      account_ref: credentials.account_ref,
      token_prefix: credentials.token.slice(0, 12),
      include_runtime: withRuntime,
    };
  } catch (error) {
    revokeBridge(ownerUserId, credentials.bridge_id);
    throw error;
  }
}
