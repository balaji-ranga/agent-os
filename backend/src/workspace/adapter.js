import { join, normalize, resolve } from 'path';
import { existsSync } from 'fs';
import { getOpenClawDir } from '../config/openclaw-paths.js';

const FILE_MAP = {
  soul: 'SOUL.md',
  agents: 'AGENTS.md',
  org: 'ORG.md',
  memory: 'MEMORY.md',
  identity: 'IDENTITY.md',
  user: 'USER.md',
  tools: 'TOOLS.md',
};

const MAX_FILE_SIZE = 512 * 1024; // 500 KB

function expandHomePath(raw) {
  const path = String(raw || '').trim();
  if (!path) return null;
  if (path.startsWith('~')) {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    return join(home, path.slice(1).replace(/^[/\\]/, '') || '');
  }
  return path;
}

/**
 * Remap a stored workspace path onto the local OPENCLAW_DIR.
 * Handles Windows host paths (C:/Users/.../.openclaw/...) that were copied into a Linux VPS DB.
 */
function remapOpenClawRelative(storedPath, openclawDir) {
  const posix = String(storedPath || '').replace(/\\/g, '/');
  const m = posix.match(/\.openclaw\/(.+)$/i);
  if (!m?.[1]) return null;
  return join(openclawDir, m[1]);
}

function looksForeignToHost(absPath) {
  const p = String(absPath || '').replace(/\\/g, '/');
  // Windows drive letter while running on non-Windows
  if (/^[A-Za-z]:\//.test(p) && process.platform !== 'win32') return true;
  return false;
}

/**
 * Resolve the on-disk OpenClaw workspace root for an agent row.
 * Prefers an existing path among: tenant workspace (when ceoUserId), stored path,
 * remapped .openclaw suffix, default workspace-{ocId}.
 *
 * Multi-CEO: pass `ceoUserId` so Workspace UI / edits use
 * `tenants/{ceo}/workspace-{id}` (where Resync ORG.md & AGENTS.md writes),
 * not the shared legacy `workspace-{id}` template copy.
 *
 * @param {object} agent
 * @param {{ healDb?: boolean, ceoUserId?: string }} [options]
 * @returns {string}
 */
export function resolveAgentWorkspaceRoot(agent, options = {}) {
  const openclawDir = getOpenClawDir();
  const baseOcId = String(agent?.openclaw_agent_id || agent?.id || '')
    .trim()
    .toLowerCase();
  const ceoUserId = String(options.ceoUserId || agent?.owner_user_id || '').trim();
  const candidates = [];

  // Prefer per-CEO tenant workspace when known (synced ORG.md / AGENTS.md live here).
  if (ceoUserId && baseOcId) {
    candidates.push(
      join(openclawDir, 'tenants', ceoUserId.toLowerCase(), `workspace-${baseOcId}`)
    );
  }

  const stored = expandHomePath(agent?.workspace_path);
  if (stored) {
    candidates.push(stored);
    const remapped = remapOpenClawRelative(stored, openclawDir);
    if (remapped && remapped !== stored) candidates.push(remapped);
  }

  if (baseOcId) {
    candidates.push(join(openclawDir, `workspace-${baseOcId}`));
    if (baseOcId === 'main' || baseOcId === 'bala') {
      candidates.push(join(openclawDir, 'workspace'));
    }
  }

  const envRoot = expandHomePath(process.env.OPENCLAW_WORKSPACE_PATH || process.env.OPENCLAW_WORKSPACE);
  if (envRoot) candidates.push(envRoot);

  const unique = [...new Set(candidates.filter(Boolean))];
  let chosen = unique.find((p) => !looksForeignToHost(p) && existsSync(p));
  if (!chosen) {
    chosen = unique.find((p) => !looksForeignToHost(p)) || unique[0] || null;
  }
  if (!chosen) {
    throw new Error('No workspace path for agent and OPENCLAW_WORKSPACE_PATH not set');
  }

  // Never heal DB workspace_path to a tenant path — agents are shared across CEOs.
  const chosenIsTenant = /\/tenants\//i.test(String(chosen).replace(/\\/g, '/'));
  if (options.healDb !== false && agent?.id && !chosenIsTenant) {
    const posix = chosen.replace(/\\/g, '/');
    const storedPosix = String(agent.workspace_path || '').replace(/\\/g, '/');
    if (posix !== storedPosix && existsSync(chosen)) {
      try {
        agent.workspace_path = posix;
      } catch (_) {}
    }
  }

  return chosen;
}

/** Rewrite agents.workspace_path to locally existing OpenClaw dirs (fixes host→VPS path drift). */
export function healAgentWorkspacePaths(db) {
  if (!db) throw new Error('db required');
  const rows = db.prepare('SELECT * FROM agents').all();
  let healed = 0;
  const upd = db.prepare('UPDATE agents SET workspace_path = ? WHERE id = ?');
  for (const agent of rows) {
    try {
      const root = resolveAgentWorkspaceRoot(agent, { healDb: false });
      const posix = root.replace(/\\/g, '/');
      const prev = String(agent.workspace_path || '').replace(/\\/g, '/');
      if (existsSync(root) && posix !== prev) {
        upd.run(posix, agent.id);
        healed += 1;
      } else if (!agent.workspace_path && existsSync(root)) {
        upd.run(posix, agent.id);
        healed += 1;
      }
    } catch (_) {}
  }
  return { scanned: rows.length, healed };
}

function getWorkspaceRoot() {
  const root = process.env.OPENCLAW_WORKSPACE_PATH || process.env.OPENCLAW_WORKSPACE;
  if (!root) throw new Error('OPENCLAW_WORKSPACE_PATH or OPENCLAW_WORKSPACE not set');
  return expandHomePath(root);
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

export { getWorkspaceRoot, FILE_MAP, resolvePath, safeJoinUnder, expandHomePath, remapOpenClawRelative };
