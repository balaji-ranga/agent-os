import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, relative, isAbsolute, join, dirname } from 'path';
import { renderWorkflowTemplates, resolveNodeInputs } from './templates.js';
import { executeFtpOperations } from './workflow-ftp-client.js';

export function isLoopbackUrl(url, localHosts = ['localhost', '127.0.0.1', '::1']) {
  try {
    const u = new URL(String(url));
    const host = (u.hostname || '').toLowerCase();
    if (localHosts.map((h) => h.toLowerCase()).includes(host)) return true;
    if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

export async function executeLocalApi(node, graph, context, params) {
  const { resolved } = resolveNodeInputs(node, graph, context);
  const cfg = node.data?.taskConfig || node.data?.config || {};
  const render = (v) => (v != null ? renderWorkflowTemplates(String(v), context) : v);
  const url = render(resolved.url || cfg.url)?.trim();
  if (!url) throw new Error('API URL is required');
  if (!isLoopbackUrl(url, params.local_api_hosts)) {
    throw new Error('Local API executor only handles localhost / 127.* URLs');
  }

  const method = (cfg.method || 'POST').toUpperCase();
  const headers = {};
  const rawHeaders = cfg.headers || resolved.headers;
  if (rawHeaders && typeof rawHeaders === 'object') {
    for (const [k, v] of Object.entries(rawHeaders)) {
      headers[k] = render(String(v));
    }
  } else if (typeof rawHeaders === 'string' && rawHeaders.trim()) {
    try {
      const parsed = JSON.parse(render(rawHeaders));
      Object.assign(headers, parsed);
    } catch {
      /* ignore */
    }
  }
  if (cfg.authType === 'bearer' && cfg.bearerToken) {
    headers.Authorization = `Bearer ${render(cfg.bearerToken)}`;
  }
  if (cfg.authType === 'api_key' && cfg.apiKeyHeader && cfg.apiKeyValue) {
    headers[cfg.apiKeyHeader] = render(cfg.apiKeyValue);
  }

  let body = render(resolved.body);
  const timeoutMs = Number(cfg.timeoutMs || 20 * 60 * 1000);
  const response = await fetch(url, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body || undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API ${method} ${url} failed (${response.status}): ${text.slice(0, 400)}`);
  }
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return {
    ok: true,
    status: response.status,
    body: parsed,
    bodyText: (typeof parsed === 'object' ? JSON.stringify(parsed) : String(text)).slice(0, 200000),
    text: typeof parsed === 'object' ? JSON.stringify(parsed) : String(text),
  };
}

function assertAllowedPath(targetPath, packageRoot) {
  const abs = resolve(targetPath);
  // Desktop: allow absolute paths and paths under package root / cwd
  return abs;
}

export function shouldRunFilesystemLocally(node) {
  const cfg = node?.data?.taskConfig || node?.data?.config || {};
  const transport = String(cfg.transport || cfg.protocol || 'local').trim().toLowerCase();
  const executeOn = String(cfg.executeOn || cfg.execute_on || 'auto').trim().toLowerCase();
  if (executeOn === 'server' || executeOn === 'remote') return false;
  if (executeOn === 'local' || executeOn === 'desktop') return true;
  if (transport === 'sftp' || transport === 'ssh') return false;
  if (transport === 'ftp' || transport === 'ftps') return true;
  return true;
}

export async function executeLocalFilesystem(node, graph, context, packageRoot) {
  const { resolved } = resolveNodeInputs(node, graph, context);
  const cfg = node.data?.taskConfig || node.data?.config || {};
  const render = (v) => (v != null ? renderWorkflowTemplates(String(v), context) : v == null ? '' : String(v));
  const transport = String(cfg.transport || cfg.protocol || resolved.transport || 'local').trim().toLowerCase();
  const op = String(cfg.operation || resolved.operation || 'list').toLowerCase();
  const pathInput = render(resolved.path || cfg.path || (transport === 'sftp' || transport === 'ftp' || transport === 'ftps' ? '/' : '.'));
  const glob = render(resolved.glob || cfg.glob || '*') || '*';
  const content = render(resolved.content || resolved.body || resolved.text || cfg.content || '');
  const destination = render(resolved.destination || resolved.dest || cfg.destination || cfg.dest || '');

          if (transport === 'ftp' || transport === 'ftps') {
    const host = render(cfg.host || resolved.host || '');
    if (!host) throw new Error('FTP host is required');
    return executeFtpOperations({
      host,
      port: Number(cfg.port || resolved.port || 0) || undefined,
      user: render(cfg.username || cfg.user || resolved.username || ''),
      pass: render(cfg.password || resolved.password || ''),
      secure: transport === 'ftps' || cfg.ftpSecure || cfg.secure,
      op,
      path: pathInput,
      glob,
      content,
      destination,
      maxBytes: Number(cfg.maxBytes || 65536),
      timeoutMs: Number(cfg.timeoutMs) || 30000,
    });
  }

  if (transport === 'sftp' || transport === 'ssh') {
    throw new Error(
      'SFTP from a desktop package runs on Flolah (password/key stay in vault). Set Execute on = Flolah, or leave Auto.'
    );
  }

  const absPath = assertAllowedPath(pathInput || '.', packageRoot);

  if (op === 'list') {
    if (!existsSync(absPath)) {
      return { ok: false, operation: 'list', path: absPath, count: 0, files: [], names: '', error: 'Directory not found' };
    }
    const st = statSync(absPath);
    if (!st.isDirectory()) {
      return { ok: false, operation: 'list', path: absPath, count: 0, files: [], names: '', error: 'Not a directory' };
    }
    const names = readdirSync(absPath).filter((n) => matchSimpleGlob(n, glob));
    return { ok: true, operation: 'list', path: absPath, count: names.length, files: names, names: names.join('\n'), text: names.join('\n') };
  }
  if (op === 'exists') {
    const ok = existsSync(absPath);
    return { ok, operation: 'exists', path: absPath, text: String(ok) };
  }
  if (op === 'stat') {
    if (!existsSync(absPath)) return { ok: false, operation: 'stat', path: absPath, error: 'Not found' };
    const st = statSync(absPath);
    return {
      ok: true,
      operation: 'stat',
      path: absPath,
      size: st.size,
      isFile: st.isFile(),
      isDirectory: st.isDirectory(),
      text: JSON.stringify({ size: st.size, isFile: st.isFile(), isDirectory: st.isDirectory() }),
    };
  }
  if (op === 'read_text') {
    if (!existsSync(absPath)) return { ok: false, operation: 'read_text', path: absPath, error: 'Not found' };
    const maxBytes = Number(cfg.maxBytes || 2_000_000);
    const buf = readFileSync(absPath);
    const text = buf.slice(0, maxBytes).toString('utf8');
    return { ok: true, operation: 'read_text', path: absPath, text, body: text, truncated: buf.length > maxBytes };
  }
  if (op === 'write_text') {
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, 'utf8');
    return { ok: true, operation: 'write_text', path: absPath, bytes: Buffer.byteLength(content, 'utf8'), text: 'written' };
  }
  if (op === 'move') {
    const destRaw = destination || render(resolved.dest || cfg.dest || '');
    if (!destRaw) throw new Error('destination required for move');
    const dest = assertAllowedPath(destRaw, packageRoot);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(absPath, dest);
    return { ok: true, operation: 'move', path: absPath, dest, destination: dest, text: dest };
  }
  throw new Error(`Unsupported filesystem operation: ${op}`);
}

function matchSimpleGlob(name, pattern) {
  const p = String(pattern || '*').trim() || '*';
  if (p === '*') return true;
  const re = new RegExp(
    `^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
    'i'
  );
  return re.test(name);
}

export function shouldRunApiLocally(node, graph, context, params) {
  const { resolved } = resolveNodeInputs(node, graph, context);
  const cfg = node.data?.taskConfig || node.data?.config || {};
  const executeOn = String(cfg.executeOn || cfg.execute_on || '').toLowerCase();
  if (cfg.forceRemote === true || executeOn === 'server' || executeOn === 'remote') return false;
  if (cfg.forceLocal === true || executeOn === 'local') return true;

  const url = renderWorkflowTemplates(String(resolved.url || cfg.url || ''), context)?.trim();
  if (!url || !isLoopbackUrl(url, params.local_api_hosts)) return false;

  try {
    const u = new URL(url);
    const port = u.port
      ? Number(u.port)
      : u.protocol === 'https:'
        ? 443
        : 80;
    // Local IBKR bridge (and similar) must stay on the laptop.
    const vars = params.workflow?.variables || {};
    const bridgePort = Number(
      params.local_bridge_port || vars.local_bridge_port || vars.bridge_port || 3010
    );
    if (Number.isFinite(bridgePort) && port === bridgePort) return true;

    // Agent OS platform API is always on Flolah — even when URL is 127.0.0.1:3001 in the seed.
    // Desktop packages remote-execute those nodes so the fetch runs inside the backend container.
    if (port === 3001 || u.pathname.startsWith('/api/')) return false;

    // Other loopback ports (custom local services) stay on the laptop.
    return true;
  } catch {
    return false;
  }
}
