/**
 * SFTP transport for workflow filesystem nodes (Flolah server).
 */
import SftpClient from 'ssh2-sftp-client';

function encodePath(p) {
  const s = String(p || '/').replace(/\\/g, '/');
  if (!s.startsWith('/')) return `/${s}`;
  return s.replace(/\/{2,}/g, '/');
}

function matchGlob(name, pattern) {
  const p = String(pattern || '*').trim() || '*';
  if (p === '*') return true;
  const re = new RegExp(
    `^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
    'i'
  );
  return re.test(name);
}

export async function executeSftpOperations({
  host,
  port,
  user,
  pass,
  privateKey,
  passphrase,
  op,
  path: remotePath,
  glob,
  content,
  destination,
  maxBytes,
  timeoutMs,
}) {
  if (!host) throw new Error('SFTP host is required');
  const client = new SftpClient('workflow-sftp', {
    error: () => {},
    end: () => {},
    close: () => {},
  });
  const path = encodePath(remotePath || '/');
  try {
    await client.connect({
      host,
      port: Number(port) || 22,
      username: user || '',
      password: pass || undefined,
      privateKey: privateKey || undefined,
      passphrase: passphrase || undefined,
      readyTimeout: Number(timeoutMs) || 20000,
    });
    if (op === 'list') {
      const listing = await client.list(path);
      const entries = listing
        .filter((e) => e.type !== 'd' && matchGlob(e.name, glob))
        .map((e) => ({
          name: e.name,
          path: `${path.replace(/\/+$/, '')}/${e.name}`,
          size: e.size || 0,
          mtime: e.modifyTime ? new Date(e.modifyTime).toISOString() : undefined,
        }));
      return {
        ok: true,
        operation: 'list',
        transport: 'sftp',
        path,
        count: entries.length,
        files: entries,
        names: entries.map((f) => f.name).join('\n'),
        text: entries.map((f) => f.name).join('\n'),
        has_files: entries.length > 0,
      };
    }
    if (op === 'exists') {
      const ok = await client.exists(path);
      const exists = !!ok;
      return { ok: exists, operation: 'exists', transport: 'sftp', path, exists, text: exists ? 'true' : 'false' };
    }
    if (op === 'stat') {
      try {
        const s = await client.stat(path);
        return {
          ok: true,
          operation: 'stat',
          transport: 'sftp',
          path,
          is_file: s.isFile,
          is_directory: s.isDirectory,
          size: s.size,
          text: `${path} size=${s.size}`,
        };
      } catch {
        return { ok: false, operation: 'stat', transport: 'sftp', path, error: 'Not found' };
      }
    }
    if (op === 'read_text') {
      const cap = Math.min(Number(maxBytes) || 65536, 2 * 1024 * 1024);
      const buf = await client.get(path);
      const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      const truncated = raw.length > cap;
      const text = raw.slice(0, cap).toString('utf8');
      return {
        ok: true,
        operation: 'read_text',
        transport: 'sftp',
        path,
        size: raw.length,
        truncated,
        text,
        content: text,
      };
    }
    if (op === 'write_text') {
      const cap = Math.min(Number(maxBytes) || 65536, 2 * 1024 * 1024);
      const body = String(content ?? '');
      const bytes = Buffer.byteLength(body, 'utf8');
      if (bytes > cap) throw new Error(`write_text exceeds maxBytes (${cap})`);
      const parent = path.replace(/\/[^/]+$/, '') || '/';
      await client.mkdir(parent, true);
      await client.put(Buffer.from(body, 'utf8'), path);
      return { ok: true, operation: 'write_text', transport: 'sftp', path, bytes, text: 'written' };
    }
    if (op === 'move') {
      if (!destination) throw new Error('destination required for move');
      const dest = encodePath(destination);
      await client.rename(path, dest);
      return { ok: true, operation: 'move', transport: 'sftp', path, destination: dest, text: dest };
    }
    throw new Error(`Unknown filesystem operation: ${op}`);
  } finally {
    await client.end().catch(() => {});
  }
}
