/**
 * Build Windows desktop workflow package (PS1 + params JSON + Node runner + bundled Node 18).
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as store from './agent-workflow-store.js';
import { createDesktopToken } from './agent-workflow-desktop-auth.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import { buildZipBuffer } from './zip-store.js';
import { getBundledWindowsNodeFiles, DESKTOP_NODE_VERSION } from './desktop-windows-node-runtime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '../../desktop-workflow-runner');

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', '.runtime-cache', 'runtime', 'logs']);

function walkFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkFiles(full, base));
    else out.push({ abs: full, rel: relative(base, full).replace(/\\/g, '/') });
  }
  return out;
}

/**
 * @param {object} opts
 * @param {boolean} [opts.includeRuntime=true] — include portable Node 18 (runtime/node.exe)
 * @returns {Promise<{ zip: Buffer, filename: string, token_prefix: string, token_id: string, include_runtime: boolean }>}
 */
export async function buildDesktopPackageZip(
  definitionId,
  ownerUserId,
  { actor = null, tokenName = '', baseUrlOverride = null, includeRuntime = true } = {}
) {
  const def = store.getDefinition(definitionId, ownerUserId);
  if (!def) throw new Error('Workflow not found');
  if (def.status !== 'published' || !def.published_graph) {
    throw new Error('Publish the workflow before downloading a desktop package');
  }

  const withRuntime = includeRuntime !== false;

  const minted = createDesktopToken(definitionId, ownerUserId, {
    name: tokenName || `Package ${new Date().toISOString().slice(0, 10)}`,
  });

  const baseUrl = String(baseUrlOverride || getPublicBaseUrl() || '')
    .replace(/\/$/, '')
    .replace(/\/api$/i, '');
  if (!baseUrl) {
    throw new Error('AGENT_OS_PUBLIC_URL / AGENT_OS_BASE_URL is not configured');
  }

  const params = {
    format: 'agent-os-desktop-workflow',
    version: 1,
    exported_at: new Date().toISOString(),
    base_url: baseUrl,
    api_base: `${baseUrl}/api`,
    desktop_api_base: `${baseUrl}/api/agent-workflows/desktop/v1`,
    definition_id: definitionId,
    definition_name: def.name,
    owner_user_id: ownerUserId,
    desktop_token: minted.token,
    token_id: minted.id,
    bundled_node_version: withRuntime ? DESKTOP_NODE_VERSION : null,
    include_runtime: withRuntime,
    workflow: {
      name: def.name,
      description: def.description || '',
      variables: def.variables || {},
      graph: def.published_graph,
      input_schema: def.input_schema || null,
    },
    local_api_hosts: ['localhost', '127.0.0.1', '::1'],
    log: {
      directory: 'logs',
      redact_secrets: true,
    },
    created_by: actor?.id || null,
  };

  const runtimeFiles = withRuntime ? await getBundledWindowsNodeFiles() : [];
  if (withRuntime && !runtimeFiles.length && process.env.DESKTOP_PACKAGE_SKIP_NODE_RUNTIME !== '1') {
    throw new Error('Bundled Windows Node runtime is missing');
  }

  const files = [];
  for (const f of walkFiles(PACKAGE_ROOT)) {
    files.push({ name: f.rel, content: readFileSync(f.abs), compress: true });
  }
  for (const f of runtimeFiles) {
    files.push(f);
  }
  files.push({
    name: 'workflow.params.json',
    content: JSON.stringify(params, null, 2),
    compress: true,
  });

  const runtimeReadme = withRuntime
    ? [
        `Bundled runtime: Node.js ${DESKTOP_NODE_VERSION} (runtime\\node.exe)`,
        'No system Node.js or npm install is required.',
      ]
    : [
        'This package was downloaded WITHOUT portable Node.',
        'Install Node.js 18+ on PATH, or re-download with the runtime option.',
        'Run-Workflow.ps1 will use system node if runtime\\node.exe is missing.',
      ];

  files.push({
    name: 'README-DESKTOP.txt',
    content: [
      'Flolah desktop workflow package',
      '==============================',
      '',
      `Workflow: ${def.name} (${definitionId})`,
      '',
      ...runtimeReadme,
      'Runner has no extra npm dependencies.',
      '',
      'Run:',
      '  .\\Run-Workflow.ps1',
      '  .\\Run-Workflow.ps1 -InputJson "{\\"key\\":\\"value\\"}"',
      '',
      'Auth: workflow.params.json contains a desktop token (dsk_...).',
      'Keep this folder private. Revoke tokens from the workflow editor if leaked.',
      'Optional: configure IP whitelist in Flolah so only allowed client IPs can call APIs.',
      '',
      'Logs: .\\logs\\ (secrets redacted)',
      '',
    ].join('\n'),
    compress: true,
  });

  const zip = buildZipBuffer(files);
  const safeName =
    String(def.name || 'workflow')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'workflow';
  const suffix = withRuntime ? 'desktop' : 'desktop-lite';
  return {
    zip,
    filename: `${safeName}-${suffix}.zip`,
    token_id: minted.id,
    token_prefix: minted.token_prefix,
    include_runtime: withRuntime,
  };
}
