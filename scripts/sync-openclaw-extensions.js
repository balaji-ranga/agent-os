/**
 * Sync Agent OS OpenClaw extensions from the repo image into ~/.openclaw/extensions.
 *
 * Idempotent — safe on every gateway start so Docker rebuilds refresh the volume
 * without a full `init` re-run.
 *
 * - Copies openclaw-extensions/* → $OPENCLAW_DIR/extensions/*
 * - Prefers index.js over index.ts (renames .ts → .ts.bak when both exist)
 * - Expands agent-os-content-tools contracts.tools from agent-os-tools.json when present
 * - Ensures plugins.load.paths + enabled entries for our extensions (when openclaw.json exists)
 *
 * Run: node scripts/sync-openclaw-extensions.js
 */
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  renameSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveOpenClawDir, resolveOpenClawExtensionsDir, resolveOpenClawConfigPath } from './lib/openclaw-paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_OS_ROOT = join(__dirname, '..');
const SOURCE_ROOT = join(AGENT_OS_ROOT, 'openclaw-extensions');
const EXTENSION_IDS = ['agent-os-content-tools', 'agent-os-bootstrap-watcher'];

function copyRecursive(src, dest) {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name);
    const d = join(dest, e.name);
    if (e.isDirectory()) {
      copyRecursive(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

/** Prefer compiled/shipped JS so OpenClaw does not load stale TypeScript sources. */
function preferJsOverTs(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts') || name.endsWith('.d.ts') || name.endsWith('.ts.bak')) continue;
    const base = name.slice(0, -3);
    const jsPath = join(dir, `${base}.js`);
    const tsPath = join(dir, name);
    if (!existsSync(jsPath)) continue;
    const bak = join(dir, `${name}.bak`);
    try {
      if (existsSync(bak)) unlinkSync(bak);
      renameSync(tsPath, bak);
      console.log(`  prefer JS: ${name} → ${name}.bak`);
    } catch (e) {
      console.warn(`  could not rename ${tsPath}:`, e.message);
    }
  }
}

function syncContentToolsContracts(extDir) {
  const pluginPath = join(extDir, 'openclaw.plugin.json');
  const toolsPath = join(resolveOpenClawDir(), 'agent-os-tools.json');
  if (!existsSync(pluginPath)) return;
  let plugin;
  try {
    plugin = JSON.parse(readFileSync(pluginPath, 'utf8'));
  } catch {
    return;
  }
  let names = Array.isArray(plugin.contracts?.tools) ? [...plugin.contracts.tools] : [];
  if (existsSync(toolsPath)) {
    try {
      const tools = JSON.parse(readFileSync(toolsPath, 'utf8'));
      if (Array.isArray(tools)) {
        names = tools.map((t) => t?.name).filter((n) => typeof n === 'string' && n.trim());
      }
    } catch {
      /* keep manifest defaults */
    }
  }
  if (names.length === 0) return;
  plugin.contracts = { ...(plugin.contracts || {}), tools: names };
  plugin.activation = { ...(plugin.activation || {}), onStartup: true };
  plugin.toolMetadata = plugin.toolMetadata || {};
  for (const name of names) {
    plugin.toolMetadata[name] = { ...(plugin.toolMetadata[name] || {}), optional: true };
  }
  writeFileSync(pluginPath, JSON.stringify(plugin, null, 2), 'utf8');
  console.log(`  contracts.tools: ${names.length} (agent_workflow_list=${names.includes('agent_workflow_list')})`);
}

function ensurePluginLoadPaths() {
  const configPath = resolveOpenClawConfigPath();
  if (!existsSync(configPath)) {
    console.log('openclaw.json not found — skip plugin path ensure (run init/bootstrap first)');
    return;
  }
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.warn('Could not parse openclaw.json:', e.message);
    return;
  }

  const openclawDir = resolveOpenClawDir();
  const extRoot = resolveOpenClawExtensionsDir();
  if (!config.plugins) config.plugins = {};
  if (!config.plugins.entries) config.plugins.entries = {};
  if (!config.plugins.load) config.plugins.load = {};
  const paths = new Set(
    (Array.isArray(config.plugins.load.paths) ? config.plugins.load.paths : []).map(String)
  );

  for (const id of EXTENSION_IDS) {
    const abs = join(extRoot, id);
    paths.add(abs);
    const prev = config.plugins.entries[id] || {};
    const next = { ...prev, enabled: true };
    if (id === 'agent-os-content-tools') {
      const internal =
        String(process.env.AGENT_OS_INTERNAL_API_URL || 'http://backend:3001').replace(/\/$/, '') ||
        'http://backend:3001';
      next.config = {
        ...(prev.config || {}),
        baseUrl: (prev.config && prev.config.baseUrl) || internal,
      };
      delete next.config.apiKey;
    } else {
      next.config = prev.config || {};
    }
    config.plugins.entries[id] = next;
  }

  // Remap Windows paths if a local home was restored into Linux; dedupe case-insensitively on win32.
  const remapped = [...paths].map((p) => {
    const s = String(p || '');
    if (/^[A-Za-z]:[\\/]/.test(s) || s.includes('\\Users\\') || s.includes('/Users/')) {
      const base = s.replace(/\\/g, '/').split('/extensions/').pop();
      if (base) return join(openclawDir, 'extensions', base);
    }
    return s;
  });
  const seen = new Set();
  const unique = [];
  for (const p of remapped) {
    const key = process.platform === 'win32' ? String(p).toLowerCase() : String(p);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  config.plugins.load.paths = unique;

  if (!Array.isArray(config.plugins.allow)) config.plugins.allow = [];
  for (const id of EXTENSION_IDS) {
    if (!config.plugins.allow.includes(id)) config.plugins.allow.push(id);
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  console.log('Ensured plugins.load.paths + enabled entries:', config.plugins.load.paths);
}

function main() {
  if (!existsSync(SOURCE_ROOT)) {
    console.error('Source not found:', SOURCE_ROOT);
    process.exit(1);
  }

  const destRoot = resolveOpenClawExtensionsDir();
  if (!existsSync(destRoot)) mkdirSync(destRoot, { recursive: true });

  console.log('Syncing OpenClaw extensions →', destRoot);
  for (const id of EXTENSION_IDS) {
    const src = join(SOURCE_ROOT, id);
    if (!existsSync(src)) {
      console.warn('Skip missing extension source:', src);
      continue;
    }
    const dest = join(destRoot, id);
    copyRecursive(src, dest);
    preferJsOverTs(dest);
    if (id === 'agent-os-content-tools') syncContentToolsContracts(dest);
    console.log('Synced', id);
  }

  ensurePluginLoadPaths();
  console.log('OpenClaw extension sync complete.');
}

main();
