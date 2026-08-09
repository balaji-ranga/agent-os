/**
 * Build Windows zip of local-browser-worker (owner-specific token + optional Node).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { getPublicBaseUrl } from '../config/public-url.js';
import { buildZipBuffer } from './zip-store.js';
import { getBundledWindowsNodeFiles, DESKTOP_NODE_VERSION } from './desktop-windows-node-runtime.js';
import { createBrowserWorkerToken } from './browser-worker-auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(__dirname, '../..');
const PACKAGE_ROOT = join(BACKEND_ROOT, 'local-browser-worker');

const SKIP_DIR_NAMES = new Set(['node_modules', 'data', 'logs', '.git']);
const SKIP_FILE_NAMES = new Set(['.env', 'package-lock.json']);

function walkFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    if (SKIP_FILE_NAMES.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkFiles(full, base));
    else out.push({ abs: full, rel: relative(base, full).replace(/\\/g, '/') });
  }
  return out;
}

/**
 * @param {object} opts
 * @param {string} opts.ownerUserId
 * @param {boolean} [opts.includeRuntime=true]
 * @param {string|null} [opts.baseUrlOverride]
 */
export async function buildLocalBrowserWorkerPackageZip({
  ownerUserId,
  includeRuntime = true,
  baseUrlOverride = null,
} = {}) {
  if (!ownerUserId) throw new Error('ownerUserId required');
  if (!existsSync(PACKAGE_ROOT)) {
    throw new Error('local-browser-worker package source is missing');
  }

  const withRuntime = includeRuntime !== false;
  const minted = createBrowserWorkerToken(ownerUserId, {
    name: withRuntime ? 'Browser Session package (full)' : 'Browser Session package (lite)',
  });

  const baseUrl = String(baseUrlOverride || getPublicBaseUrl() || '')
    .replace(/\/$/, '')
    .replace(/\/api$/i, '');

  const runtimeFiles = withRuntime ? await getBundledWindowsNodeFiles() : [];
  if (withRuntime && !runtimeFiles.length && process.env.DESKTOP_PACKAGE_SKIP_NODE_RUNTIME !== '1') {
    throw new Error('Bundled Windows Node runtime is missing');
  }

  const files = [];
  for (const f of walkFiles(PACKAGE_ROOT)) {
    files.push({ name: f.rel, content: readFileSync(f.abs), compress: true });
  }

  for (const rf of runtimeFiles) {
    files.push(rf);
  }

  const envContent = [
    `BROWSER_WORKER_TOKEN=${minted.token}`,
    baseUrl ? `AGENT_OS_BASE_URL=${baseUrl}` : 'AGENT_OS_BASE_URL=',
    'LOOPBACK_HOST=127.0.0.1',
    'LOOPBACK_PORT=3020',
    'BROWSER_HEADLESS=0',
    'HEARTBEAT_MS=30000',
    '',
  ].join('\n');
  files.push({ name: '.env', content: envContent, compress: true });

  const meta = {
    format: 'agent-os-local-browser-worker',
    version: 1,
    exported_at: new Date().toISOString(),
    owner_user_id: ownerUserId,
    public_base_url: baseUrl || null,
    token_id: minted.id,
    token_prefix: minted.token_prefix,
    include_runtime: withRuntime,
    bundled_node_version: withRuntime ? DESKTOP_NODE_VERSION : null,
    loopback_port: 3020,
    api_base: baseUrl ? `${baseUrl}/api/browser-worker/v1` : null,
  };
  files.push({
    name: 'worker.meta.json',
    content: `${JSON.stringify(meta, null, 2)}\n`,
    compress: true,
  });

  const setup = [
    'Flolah Local Browser Worker (Windows)',
    '=====================================',
    '',
    'This package is bound to YOUR Flolah account only. The BROWSER_WORKER_TOKEN in .env',
    'is minted for you — keep the zip private. Revoke tokens from Connectors if lost.',
    '',
    'Setup',
    '-----',
    '1. Unzip to a private folder on your PC.',
    '2. Confirm .env:',
    '   - BROWSER_WORKER_TOKEN (already set; starts with bwk_)',
    '   - AGENT_OS_BASE_URL (your Flolah origin, no /api suffix)',
    '   - LOOPBACK_PORT=3020',
    '3. First run installs Playwright Chromium (npm once) if node_modules is missing:',
    '     .\\scripts\\Start-BrowserWorker.ps1',
    '4. Leave the window open (long-lived). Agents and recipes route here while online.',
    '5. Optional: .\\scripts\\Register-TaskScheduler.ps1  (start at Windows logon)',
    '',
    'Connectors → Browser Session package',
    '------------------------------------',
    '- Download this package (owner-scoped token).',
    '- Optionally add client IP allowlist (your public IP / CIDR). Empty = any IP + token.',
    '- Status shows online after register/heartbeat.',
    '- Revoke old tokens from the same panel; re-download mints a new token.',
    '',
    'Loopback for workflows (optional)',
    '--------------------------------',
    `POST http://127.0.0.1:3020/v1/open  Authorization: Bearer <same token>`,
    'Body: {"url":"https://example.com"}',
    'Also: /v1/snapshot, /v1/act, /v1/status  ·  GET /health (no auth)',
    '',
    'Security',
    '--------',
    '- Token is hashed on Flolah; only your owner_user_id receives jobs.',
    '- Loopback binds 127.0.0.1 only by default.',
    '- IP whitelist applies to worker → cloud calls when configured.',
    '',
    withRuntime
      ? `Bundled Node ${DESKTOP_NODE_VERSION} under runtime\\node.exe`
      : 'Lite pack: install Node.js 18+ on PATH.',
    '',
  ].join('\n');
  files.push({ name: 'README-BROWSER-WORKER.txt', content: setup, compress: true });

  const zip = await buildZipBuffer(files);
  const filename = withRuntime
    ? 'local-browser-worker-desktop.zip'
    : 'local-browser-worker-lite.zip';

  console.info(
    '[local-browser-worker-package] built owner=%s prefix=%s runtime=%s bytes=%s',
    ownerUserId,
    minted.token_prefix,
    withRuntime ? '1' : '0',
    zip.length
  );

  return {
    zip,
    filename,
    token_id: minted.id,
    token_prefix: minted.token_prefix,
    include_runtime: withRuntime,
  };
}
