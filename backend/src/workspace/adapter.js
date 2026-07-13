import { join, normalize, resolve } from 'path';
import { existsSync } from 'fs';

const FILE_MAP = {
  soul: 'SOUL.md',
  agents: 'AGENTS.md',
  memory: 'MEMORY.md',
  identity: 'IDENTITY.md',
  user: 'USER.md',
  tools: 'TOOLS.md',
};

const MAX_FILE_SIZE = 512 * 1024; // 500 KB

function getWorkspaceRoot() {
  const root = process.env.OPENCLAW_WORKSPACE_PATH || process.env.OPENCLAW_WORKSPACE;
  if (!root) throw new Error('OPENCLAW_WORKSPACE_PATH or OPENCLAW_WORKSPACE not set');
  return root;
}

function resolvePath(workspaceRoot, name, subpath = null) {
  if (subpath === 'daily' || name === 'daily') {
    return join(workspaceRoot, 'memory');
  }
  const file = FILE_MAP[name] || (name.endsWith('.md') ? name : null);
  if (!file) return null;
  return join(workspaceRoot, file);
}

/** Reject path traversal under a root directory. */
function safeJoinUnder(rootDir, relative) {
  const cleaned = String(relative || '').replace(/^[/\\]+/, '').replace(/\\/g, '/');
  if (!cleaned || cleaned.includes('..') || cleaned.includes('\0')) return null;
  const abs = normalize(resolve(join(rootDir, cleaned)));
  const rootNorm = normalize(resolve(rootDir));
  if (abs !== rootNorm && !abs.startsWith(rootNorm + '\\') && !abs.startsWith(rootNorm + '/')) {
    return null;
  }
  return abs;
}

export async function listWorkspaceFiles(workspaceRoot = null) {
  const root = workspaceRoot || getWorkspaceRoot();
  if (!existsSync(root)) return { files: [], daily: [] };

  const files = [];
  for (const [key, fileName] of Object.entries(FILE_MAP)) {
    const path = join(root, fileName);
    if (existsSync(path)) files.push({ name: key, path: fileName });
  }

  let daily = [];
  const memoryDir = join(root, 'memory');
  if (existsSync(memoryDir)) {
    try {
      const { readdir } = await import('fs/promises');
      const entries = await readdir(memoryDir, { withFileTypes: true });
      daily = entries
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => ({ name: e.name, path: `memory/${e.name}` }));
    } catch (_) {}
  }

  return { files, daily };
}

export async function readWorkspaceFile(name, options = {}) {
  const { readFile, readdir } = await import('fs/promises');
  const root = options.workspaceRoot || getWorkspaceRoot();
  let path;

  if (name.startsWith('memory/') || name === 'daily') {
    const memoryDir = join(root, 'memory');
    const file = name === 'daily' ? null : name.replace(/^memory\//, '');
    if (!file) {
      const entries = await readdir(memoryDir, { withFileTypes: true }).catch(() => []);
      const md = entries.filter((e) => e.isFile() && e.name.endsWith('.md'));
      return { files: md.map((e) => ({ name: e.name, path: `memory/${e.name}` })) };
    }
    path = safeJoinUnder(memoryDir, file);
    if (!path) throw new Error('Invalid memory path');
  } else {
    path = resolvePath(root, name);
  }

  if (!path || !existsSync(path)) return { text: '', path: path || name };

  const content = await readFile(path, 'utf8');
  if (content.length > MAX_FILE_SIZE) return { text: content.slice(0, MAX_FILE_SIZE), path, truncated: true };
  return { text: content, path };
}

export async function writeWorkspaceFile(name, text, options = {}) {
  const { readFile, writeFile, mkdir } = await import('fs/promises');
  const root = options.workspaceRoot || getWorkspaceRoot();
  if (text.length > MAX_FILE_SIZE) throw new Error(`File too large (max ${MAX_FILE_SIZE} bytes)`);

  let path;
  if (name.startsWith('memory/')) {
    const memoryDir = join(root, 'memory');
    try {
      await mkdir(memoryDir, { recursive: true });
    } catch (_) {}
    path = safeJoinUnder(memoryDir, name.replace(/^memory\//, ''));
    if (!path) throw new Error('Invalid memory path');
  } else {
    const fileName = FILE_MAP[name];
    if (!fileName) throw new Error(`Unknown file name: ${name}`);
    path = join(root, fileName);
  }

  const backup = options.backup !== false && existsSync(path);
  if (backup) {
    const backupPath = `${path}.bak.${Date.now()}`;
    await readFile(path).then((b) => writeFile(backupPath, b));
  }

  await writeFile(path, text, 'utf8');
  return { path, backup: backup };
}

export { getWorkspaceRoot, FILE_MAP, resolvePath, safeJoinUnder };
