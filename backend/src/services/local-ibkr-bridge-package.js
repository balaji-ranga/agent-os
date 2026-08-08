/**
 * Build Windows zip of local-ibkr-bridge (optional portable Node + vendored IBKR client).
 */
import { randomBytes } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { getPublicBaseUrl } from '../config/public-url.js';
import { buildZipBuffer } from './zip-store.js';
import { getBundledWindowsNodeFiles, DESKTOP_NODE_VERSION } from './desktop-windows-node-runtime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(__dirname, '../..');
const PACKAGE_ROOT = join(BACKEND_ROOT, 'local-ibkr-bridge');
const BACKEND_PKG = join(BACKEND_ROOT, 'package.json');

const SKIP_DIR_NAMES = new Set(['node_modules', 'data', 'logs', '.git']);
const SKIP_FILE_NAMES = new Set(['.env', 'package-lock.json']);

const VENDOR_SOURCES = [
  'ibkr-gateway-client.js',
  'ibkr-trading-rules.js',
  'ibkr-workflow-variables.js',
  'trading-plan-bridge-map.js',
];

/** Slim order-events for standalone zip — gateway only needs pure helpers (no SQLite). */
const VENDOR_ORDER_EVENTS_STUB = `/**
 * Standalone vendor stub for local-ibkr-bridge packages.
 * Full ibkr-order-events.js needs Agent OS DB — bridge only needs these helpers.
 */
export const IBKR_ORDER_REASON = Object.freeze({
  PLACED_ACK: 'placed_ack',
  PLACE_FAILED: 'place_failed',
  PLACE_REJECTED_IB: 'place_rejected_ib',
  WORKFLOW_CANCEL_BEFORE_SELL: 'workflow_cancel_before_sell',
  WORKFLOW_DAYPLAN_CANCEL: 'workflow_dayplan_cancel',
  WORKFLOW_POLLER_CANCEL: 'workflow_poller_cancel',
  WORKFLOW_E2E_CANCEL_ALL: 'workflow_e2e_cancel_all',
  WORKFLOW_CANCEL: 'workflow_cancel',
  IB_SYSTEM_CANCEL: 'ib_system_cancel',
  IB_COMMISSION_FREE_REJECT: 'ib_commission_free_reject',
  IB_TIF_DAY_EXPIRED: 'ib_tif_day_expired',
  IB_TIF_MINUTES_EXPIRED: 'ib_tif_minutes_expired',
  RECONCILE_MISSING: 'reconcile_missing_from_open_orders',
  FILLED: 'filled',
  RESERVATION_RELEASED: 'reservation_released',
});

export function isCommissionFreeRejectText(text = '') {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  return (
    t.includes('commission free') ||
    t.includes('commission-free') ||
    t.includes('not eligible for commission') ||
    (t.includes('regular commission') && (t.includes('resubmit') || t.includes('eligible'))) ||
    (t.includes('fixed commission') && (t.includes('resubmit') || t.includes('eligible')))
  );
}

export function extractAdvancedErrorOverride(reject) {
  if (reject == null || reject === '') return null;
  let obj = reject;
  if (typeof reject === 'string') {
    const s = reject.trim();
    if (!s) return null;
    try {
      obj = JSON.parse(s);
    } catch {
      if (/^[A-Za-z0-9_,]+$/.test(s) && s.length < 200) return s;
      return null;
    }
  }
  if (typeof obj !== 'object') return null;
  if (typeof obj.advancedErrorOverride === 'string' && obj.advancedErrorOverride.trim()) {
    return obj.advancedErrorOverride.trim();
  }
  if (typeof obj['8229'] === 'string' && obj['8229'].trim()) return obj['8229'].trim();
  const tags = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (s && !tags.includes(s)) tags.push(s);
  };
  for (const row of obj.rules || obj.errors || obj.args || []) {
    if (!row || typeof row !== 'object') continue;
    if (row.id != null) push(row.id);
    if (row.tag != null) push(row.tag);
    if (row.value != null && String(row.key || row.id || '') === '8229') push(row.value);
    if (row.key === '8229' || row.key === 8229) push(row.value);
  }
  return tags.length ? tags.join(',') : null;
}
`;

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

function resolveStoqeyIbVersion() {
  try {
    const pkg = JSON.parse(readFileSync(BACKEND_PKG, 'utf8'));
    const v = pkg?.dependencies?.['@stoqey/ib'] || pkg?.devDependencies?.['@stoqey/ib'];
    if (v) return String(v);
  } catch {
    /* fall through */
  }
  return '^1.6.3';
}

function patchPackageJson(raw) {
  let pkg;
  try {
    pkg = JSON.parse(String(raw));
  } catch {
    pkg = {
      name: 'local-ibkr-bridge',
      version: '1.0.0',
      private: true,
      type: 'module',
      main: 'server.js',
    };
  }
  pkg.dependencies = {
    ...(pkg.dependencies || {}),
    '@stoqey/ib': resolveStoqeyIbVersion(),
    dotenv: pkg.dependencies?.dotenv || '^16.4.5',
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/**
 * @param {object} opts
 * @param {string} opts.ownerUserId
 * @param {boolean} [opts.includeRuntime=true]
 * @param {string|null} [opts.baseUrlOverride]
 * @returns {Promise<{ zip: Buffer, filename: string, token_prefix: string, include_runtime: boolean }>}
 */
export async function buildLocalIbkrBridgePackageZip({
  ownerUserId,
  includeRuntime = true,
  baseUrlOverride = null,
} = {}) {
  if (!existsSync(PACKAGE_ROOT)) {
    throw new Error('local-ibkr-bridge package source is missing');
  }

  const withRuntime = includeRuntime !== false;
  const token = randomBytes(24).toString('hex');
  const tokenPrefix = token.slice(0, 8);

  const baseUrl = String(baseUrlOverride || getPublicBaseUrl() || '')
    .replace(/\/$/, '')
    .replace(/\/api$/i, '');

  const runtimeFiles = withRuntime ? await getBundledWindowsNodeFiles() : [];
  if (withRuntime && !runtimeFiles.length && process.env.DESKTOP_PACKAGE_SKIP_NODE_RUNTIME !== '1') {
    throw new Error('Bundled Windows Node runtime is missing');
  }

  const files = [];
  for (const f of walkFiles(PACKAGE_ROOT)) {
    if (f.rel === 'package.json') {
      files.push({
        name: 'package.json',
        content: patchPackageJson(readFileSync(f.abs, 'utf8')),
        compress: true,
      });
      continue;
    }
    files.push({ name: f.rel, content: readFileSync(f.abs), compress: true });
  }

  for (const name of VENDOR_SOURCES) {
    const abs = join(BACKEND_ROOT, 'src', 'services', name);
    if (!existsSync(abs)) {
      throw new Error(`Missing IBKR vendor source: ${name}`);
    }
    files.push({
      name: `vendor/${name}`,
      content: readFileSync(abs),
      compress: true,
    });
  }
  files.push({
    name: 'vendor/ibkr-order-events.js',
    content: VENDOR_ORDER_EVENTS_STUB,
    compress: true,
  });

  const w3Id = 'monthly-trading-w3-events';
  // Prefer durable direct ingest endpoint (order events without W3 custom-script risk).
  // W3 event hook still works; eod_snapshot can be routed via?fanout or separate W3 URL.
  const w3Hint = baseUrl
    ? `${baseUrl}/api/ibkr-trading/local-bridge-webhook`
    : `(set AGENT_OS_PUBLIC_URL)/api/ibkr-trading/local-bridge-webhook`;
  const w3EventHook = baseUrl
    ? `${baseUrl}/api/agent-workflows/hooks/${w3Id}`
    : `(set AGENT_OS_PUBLIC_URL)/api/agent-workflows/hooks/${w3Id}`;

  // Prefill laptop WEBHOOK_* from owner W3 event hook (desktop-side .env — not VPS).
  let webhookSecret = '';
  try {
    if (ownerUserId) {
      const { registerEventHook, getHookInfo } = await import('./agent-workflow-webhooks.js');
      const def = (await import('./agent-workflow-store.js')).getDefinition(w3Id, ownerUserId);
      if (def) {
        const info =
          registerEventHook(w3Id, ownerUserId, {
            id: ownerUserId,
            name: 'ibkr-bridge-package',
            type: 'system',
          }) || getHookInfo(w3Id, ownerUserId);
        webhookSecret = String(info?.webhook_secret || '').trim();
      }
    }
  } catch (e) {
    console.warn(
      '[local-ibkr-bridge-package] W3 webhook secret prefill skipped: %s',
      e.message || e
    );
  }

  const envContent = [
    'LOCAL_BRIDGE_TOKEN=' + token,
    'BRIDGE_HOST=127.0.0.1',
    'BRIDGE_PORT=3010',
    'IBKR_HOST=127.0.0.1',
    'IBKR_PORT=4002',
    'IBKR_IS_PAPER=true',
    'IBKR_TRADING_ENABLED=0',
    // VPS W3 hook — filled here; laptop bridge POSTs fill/status events with header secret.
    baseUrl ? `WEBHOOK_URL=${w3Hint}` : 'WEBHOOK_URL=',
    webhookSecret ? `WEBHOOK_SECRET=${webhookSecret}` : 'WEBHOOK_SECRET=',
    '',
  ].join('\n');
  files.push({ name: '.env', content: envContent, compress: true });

  const meta = {
    format: 'agent-os-local-ibkr-bridge',
    version: 1,
    exported_at: new Date().toISOString(),
    owner_user_id: ownerUserId || null,
    public_base_url: baseUrl || null,
    token_prefix: tokenPrefix,
    include_runtime: withRuntime,
    bundled_node_version: withRuntime ? DESKTOP_NODE_VERSION : null,
    webhook_url_prefill: baseUrl ? w3Hint : null,
    webhook_event_hook_url: baseUrl ? w3EventHook : null,
    webhook_secret_prefilled: Boolean(webhookSecret),
  };
  files.push({
    name: 'bridge.meta.json',
    content: `${JSON.stringify(meta, null, 2)}\n`,
    compress: true,
  });

  const runtimeReadme = withRuntime
    ? [
        `Bundled runtime: Node.js ${DESKTOP_NODE_VERSION} (runtime\\node.exe)`,
        'scripts\\run-bridge.ps1 prefers runtime\\node.exe when present.',
        'You still need npm once to install dependencies (@stoqey/ib, dotenv).',
      ]
    : [
        'This package was downloaded WITHOUT portable Node (lite).',
        'Install Node.js 18+ on PATH, then npm install.',
        'Or re-download with the runtime option from Connectors.',
      ];

  files.push({
    name: 'README-BRIDGE.txt',
    content: [
      'Flolah local IBKR bridge (Windows)',
      '=================================',
      '',
      '1. Unzip this folder somewhere private on your trading laptop.',
      '2. Install / open IB Gateway or TWS (paper socket API port 4002 by default).',
      '3. Edit .env:',
      '   - LOCAL_BRIDGE_TOKEN is already minted — keep it private.',
      '   - Paste the same token into W2 workflow variable local_bridge_token.',
      '   - WEBHOOK_URL + WEBHOOK_SECRET are laptop-side only (bridge POSTs to VPS).',
      `   - Prefill WEBHOOK_URL (direct order-event ingest):`,
      `     ${w3Hint}`,
      `   - Optional alternate (W3 workflow graph hook): ${w3EventHook}`,
      webhookSecret
        ? '   - WEBHOOK_SECRET was prefilled from your W3 event secret — keep .env private.'
        : '   - If secret empty: Workflows → Monthly Trading W3 → Event → copy webhook secret.',
      '4. Install deps (package.json lists @stoqey/ib + dotenv):',
      '     npm install',
      '5. Start:',
      '     .\\scripts\\run-bridge.ps1',
      '   Mock (no Gateway):',
      '     .\\scripts\\run-bridge.ps1 -Mock',
      '6. Optional always-on: .\\scripts\\register-task-scheduler.ps1',
      '',
      ...runtimeReadme,
      '',
      'Security',
      '-------',
      '- Binds 127.0.0.1 only by default (loopback).',
      '- Every route except GET /health requires Authorization: Bearer <LOCAL_BRIDGE_TOKEN>.',
      '- Never commit .env or share the full token. bridge.meta.json stores only token_prefix.',
      '',
      'Used by Monthly Trading W2 (laptop) calling http://127.0.0.1:3010',
      '',
    ].join('\n'),
    compress: true,
  });

  for (const f of runtimeFiles) {
    files.push(f);
  }

  const zip = buildZipBuffer(files);
  const filename = withRuntime ? 'local-ibkr-bridge-desktop.zip' : 'local-ibkr-bridge-lite.zip';
  return {
    zip,
    filename,
    token_prefix: tokenPrefix,
    include_runtime: withRuntime,
  };
}
