/**
 * OpenClaw Chrome extension pack for Browser Session "Load unpacked".
 * Vendored under deploy/assets/openclaw-chrome-extension (synced from OpenClaw image).
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
const __dirname = dirname(fileURLToPath(import.meta.url));

function agentOsRoot() {
  return process.env.AGENT_OS_ROOT || join(__dirname, '../../..');
}

/** Prefer vendored Flolah asset; fall back to OpenClaw npm install path. */
export function resolveChromeExtensionDir() {
  const candidates = [
    process.env.OPENCLAW_CHROME_EXTENSION_DIR,
    join(agentOsRoot(), 'deploy/assets/openclaw-chrome-extension'),
    join(__dirname, '../../../deploy/assets/openclaw-chrome-extension'),
    '/usr/local/lib/node_modules/openclaw/dist/extensions/browser/chrome-extension',
    join(process.env.OPENCLAW_DIR || '/root/.openclaw', 'chrome-extension'),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (dir && existsSync(join(dir, 'manifest.json'))) return dir;
    } catch {
      /* skip */
    }
  }
  return null;
}

export function resolveChromeExtensionZipPath() {
  const preferred = join(agentOsRoot(), 'deploy/assets/openclaw-chrome-extension.zip');
  if (existsSync(preferred)) return preferred;
  const alt = join(__dirname, '../../../deploy/assets/openclaw-chrome-extension.zip');
  if (existsSync(alt)) return alt;
  return preferred;
}

function extensionMeta(dir) {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    return {
      name: manifest.name || 'OpenClaw Browser Relay',
      version: manifest.version || null,
      manifest_version: manifest.manifest_version || null,
    };
  } catch {
    return { name: 'OpenClaw Browser Relay', version: null, manifest_version: null };
  }
}

/**
 * Ensure a zip exists with top-level folder `chrome-extension/` (Load unpacked target).
 * Uses system `zip` when available; otherwise returns null so caller can 503.
 */
export function ensureChromeExtensionZip() {
  const dir = resolveChromeExtensionDir();
  if (!dir) {
    console.warn('[browser-session] chrome-extension folder missing under deploy/assets');
    return null;
  }
  const zipPath = resolveChromeExtensionZipPath();
  const assetsDir = dirname(zipPath);
  mkdirSync(assetsDir, { recursive: true });

  const manifestMtime = statSync(join(dir, 'manifest.json')).mtimeMs;
  if (existsSync(zipPath) && statSync(zipPath).mtimeMs >= manifestMtime && statSync(zipPath).size > 100) {
    return { zipPath, dir, meta: extensionMeta(dir) };
  }

  const staging = join(assetsDir, '.chrome-extension-zip-staging');
  try {
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    // Copy tree into staging/chrome-extension
    const dest = join(staging, 'chrome-extension');
    mkdirSync(dest, { recursive: true });
    copyTree(dir, dest);

    if (existsSync(zipPath)) rmSync(zipPath, { force: true });

    const zipBin = spawnSync('zip', ['-r', '-q', zipPath, 'chrome-extension'], {
      cwd: staging,
      encoding: 'utf8',
    });
    if (zipBin.status !== 0) {
      // Fallback: try PowerShell Compress-Archive (Windows local)
      const ps = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Compress-Archive -Path '${dest.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
        ],
        { encoding: 'utf8' }
      );
      if (ps.status !== 0 || !existsSync(zipPath)) {
        console.error(
          '[browser-session] zip chrome-extension failed zip=%s ps=%s',
          zipBin.stderr || zipBin.error,
          ps.stderr || ps.error
        );
        return null;
      }
    }
    console.info('[browser-session] built chrome-extension zip path=%s bytes=%s', zipPath, statSync(zipPath).size);
    return { zipPath, dir, meta: extensionMeta(dir) };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    const st = statSync(from);
    if (st.isDirectory()) copyTree(from, to);
    else writeFileSync(to, readFileSync(from));
  }
}

export function getChromeExtensionDownloadInfo() {
  const dir = resolveChromeExtensionDir();
  const zipInfo = dir ? ensureChromeExtensionZip() : null;
  return {
    available: Boolean(zipInfo?.zipPath && existsSync(zipInfo.zipPath)),
    download_path: '/api/browser-session/chrome-extension.zip',
    folder_name: 'chrome-extension',
    ...(zipInfo?.meta || {}),
    source_dir: dir || null,
  };
}

export function openChromeExtensionZipStream() {
  const info = ensureChromeExtensionZip();
  if (!info?.zipPath || !existsSync(info.zipPath)) {
    const err = new Error(
      'OpenClaw chrome-extension pack not available. Run deploy/scripts/sync-openclaw-chrome-extension.sh (or rebuild openclaw image + sync assets).'
    );
    err.status = 503;
    throw err;
  }
  return {
    stream: createReadStream(info.zipPath),
    filename: 'openclaw-chrome-extension.zip',
    bytes: statSync(info.zipPath).size,
    meta: info.meta,
  };
}

