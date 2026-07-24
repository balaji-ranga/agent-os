/**
 * Cache + supply portable Node.js for Windows desktop packages.
 * Downloaded once from nodejs.org into AGENT_OS_DATA_DIR (not committed to git).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { extractZipEntryBySuffix } from './zip-store.js';

/** LTS 18.x — matches desktop package requirement. */
export const DESKTOP_NODE_VERSION = process.env.DESKTOP_NODE_VERSION || '18.20.8';

function cacheRoot() {
  const base =
    process.env.AGENT_OS_DATA_DIR ||
    process.env.DESKTOP_NODE_CACHE_DIR ||
    join(process.cwd(), 'data');
  return join(base, 'cache', 'desktop-node-win-x64', DESKTOP_NODE_VERSION);
}

function distUrl() {
  return (
    process.env.DESKTOP_NODE_DIST_URL ||
    `https://nodejs.org/dist/v${DESKTOP_NODE_VERSION}/node-v${DESKTOP_NODE_VERSION}-win-x64.zip`
  );
}

/**
 * Ensure runtime/node.exe is available; return files to embed in the package zip.
 * @returns {Promise<Array<{ name: string, content: Buffer|string, compress?: boolean }>>}
 */
export async function getBundledWindowsNodeFiles() {
  if (process.env.DESKTOP_PACKAGE_SKIP_NODE_RUNTIME === '1') {
    return [];
  }

  const dir = cacheRoot();
  mkdirSync(dir, { recursive: true });
  const exePath = join(dir, 'node.exe');
  const metaPath = join(dir, 'NODE_VERSION.txt');

  if (!existsSync(exePath)) {
    const url = distUrl();
    console.log(`[desktop-package] Downloading portable Node ${DESKTOP_NODE_VERSION} for Windows…`);
    const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!res.ok) {
      throw new Error(`Failed to download Node runtime (${res.status}): ${url}`);
    }
    const zipBuf = Buffer.from(await res.arrayBuffer());
    const nodeExe = extractZipEntryBySuffix(zipBuf, '/node.exe');
    if (!nodeExe || nodeExe.length < 1_000_000) {
      throw new Error('node.exe not found in Node.js Windows distribution zip');
    }
    const tmp = join(dir, 'node.exe.part');
    writeFileSync(tmp, nodeExe);
    renameSync(tmp, exePath);
    writeFileSync(metaPath, `${DESKTOP_NODE_VERSION}\n${url}\n`, 'utf8');
    console.log(`[desktop-package] Cached node.exe (${nodeExe.length} bytes) at ${exePath}`);
  }

  const nodeExe = readFileSync(exePath);
  const versionText = existsSync(metaPath)
    ? readFileSync(metaPath, 'utf8')
    : `${DESKTOP_NODE_VERSION}\n`;

  return [
    { name: 'runtime/node.exe', content: nodeExe, compress: true },
    {
      name: 'runtime/NODE_VERSION.txt',
      content: versionText,
      compress: true,
    },
    {
      name: 'runtime/README.txt',
      content: [
        'Bundled Node.js (Windows x64) for Flolah desktop workflows.',
        `Version: ${DESKTOP_NODE_VERSION}`,
        'Run-Workflow.ps1 uses this runtime\\node.exe — no system Node install required.',
        'The workflow runner under ..\\runner\\ has no npm dependencies.',
        '',
      ].join('\n'),
      compress: true,
    },
  ];
}
