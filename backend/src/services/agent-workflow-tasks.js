/**
 * Built-in workflow tasks: Send Email, Call API, Filesystem.
 */
import { createConnection } from 'net';
import { connect as tlsConnect } from 'tls';
import { readdirSync, existsSync, statSync, readFileSync, renameSync, mkdirSync } from 'fs';
import { resolve, relative, join, basename, isAbsolute } from 'path';
import { renderWorkflowTemplates } from './agent-workflow-io.js';
import { buildApiRequestHeaders, renderApiNodeConfig } from './agent-workflow-api-auth.js';
import { assertHttpSuccess, wrapFetchError } from './workflow-http-errors.js';
import { resolveLiteralOrKeyRef } from './user-api-keys.js';

export function smtpFromEnv() {
  return {
    host: process.env.WORKFLOW_SMTP_HOST || '',
    port: Number(process.env.WORKFLOW_SMTP_PORT || 587),
    secure: process.env.WORKFLOW_SMTP_SECURE === '1' || process.env.WORKFLOW_SMTP_SECURE === 'true',
    user: (process.env.WORKFLOW_SMTP_USER || '').trim(),
    pass: (process.env.WORKFLOW_SMTP_PASS || '').trim(),
    from: process.env.WORKFLOW_SMTP_FROM || process.env.WORKFLOW_SMTP_USER || 'agent-os@localhost',
  };
}

function resolveSmtpConfig(nodeConfig = {}, ownerUserId = null) {
  if (nodeConfig.useEnvSmtp !== false) {
    const env = smtpFromEnv();
    return {
      host: nodeConfig.smtpHost || env.host,
      port: Number(nodeConfig.smtpPort || env.port || 587),
      secure: nodeConfig.smtpSecure ?? env.secure,
      user: nodeConfig.smtpUser || env.user,
      pass: resolveLiteralOrKeyRef(ownerUserId, {
        literal: nodeConfig.smtpPass || env.pass,
        keyRef: nodeConfig.smtpPassRef || nodeConfig.smtp_pass_ref,
      }),
      from: nodeConfig.fromAddress || env.from,
    };
  }
  return {
    host: nodeConfig.smtpHost || '',
    port: Number(nodeConfig.smtpPort || 587),
    secure: !!nodeConfig.smtpSecure,
    user: nodeConfig.smtpUser || '',
    pass: resolveLiteralOrKeyRef(ownerUserId, {
      literal: nodeConfig.smtpPass || '',
      keyRef: nodeConfig.smtpPassRef || nodeConfig.smtp_pass_ref,
    }),
    from: nodeConfig.fromAddress || nodeConfig.smtpUser || 'agent-os@localhost',
  };
}

/** True when this line is the final line of a multiline SMTP reply (code + space). */
function isSmtpReplyComplete(line) {
  return line.length >= 4 && line[3] === ' ';
}

function isSmtpSuccess(code) {
  return code >= 200 && code < 300;
}

/** Minimal SMTP client — attempts send; returns attempt result even on failure. */
export function sendSmtpMail({ host, port, secure, user, pass, from, to, cc, subject, body }) {
  return new Promise((resolve) => {
    const recipients = [to, cc].filter(Boolean).join(', ');
    const messageId = `<agent-os.${Date.now()}.${Math.random().toString(36).slice(2, 10)}@${String(from).split('@')[1] || 'localhost'}>`;
    const lines = [
      `From: ${from}`,
      `To: ${to}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      `Reply-To: ${from}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${messageId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ];
    const message = lines.join('\r\n');

    if (!host) {
      return resolve({
        sent: false,
        attempted: true,
        error: 'SMTP host not configured (set WORKFLOW_SMTP_HOST or node smtpHost)',
        messageId: null,
      });
    }

    const timeout = setTimeout(() => {
      cleanup();
      resolve({ sent: false, attempted: true, error: 'SMTP connection timeout', messageId: null });
    }, 15000);

    let socket;
    let buffer = '';
    let stage = 'connect';
    let finished = false;
    const useStartTls = port === 587 && !(secure && port === 465);

    function cleanup() {
      clearTimeout(timeout);
      try {
        socket?.destroy();
      } catch (_) {}
    }

    function fail(err) {
      if (finished) return;
      finished = true;
      cleanup();
      resolve({ sent: false, attempted: true, error: err, messageId: null });
    }

    function succeed(messageId, smtpReply) {
      if (finished) return;
      finished = true;
      cleanup();
      resolve({ sent: true, attempted: true, error: null, messageId, smtpReply: smtpReply || null, to: recipients });
    }

    function send(line) {
      socket.write(`${line}\r\n`);
    }

    function beginAuthOrMail() {
      if (user && pass) {
        send('AUTH LOGIN');
        stage = 'auth-user';
      } else {
        send(`MAIL FROM:<${from}>`);
        stage = 'mail-from';
      }
    }

    function onSmtpLine(line) {
      const code = parseInt(line.slice(0, 3), 10);
      if (Number.isNaN(code)) return;
      if (!isSmtpReplyComplete(line) && code !== 334 && code !== 354) return;

      if (stage === 'connect' && code === 220) {
        send('EHLO agent-os');
        stage = 'ehlo';
      } else if ((stage === 'ehlo' || stage === 'ehlo-tls') && isSmtpSuccess(code)) {
        if (useStartTls && stage === 'ehlo') {
          send('STARTTLS');
          stage = 'starttls';
        } else {
          beginAuthOrMail();
        }
      } else if (stage === 'starttls' && code === 220) {
        socket.removeListener('data', onData);
        const plain = socket;
        socket = tlsConnect({ socket: plain, servername: host, rejectUnauthorized: false }, () => {
          socket.on('data', onData);
          send('EHLO agent-os');
          stage = 'ehlo-tls';
        });
        socket.on('error', (e) => fail(e.message));
      } else if (stage === 'auth-user' && code === 334) {
        send(Buffer.from(user).toString('base64'));
        stage = 'auth-pass';
      } else if (stage === 'auth-pass' && code === 334) {
        send(Buffer.from(pass).toString('base64'));
        stage = 'auth-wait';
      } else if (stage === 'auth-wait' && isSmtpSuccess(code)) {
        send(`MAIL FROM:<${from}>`);
        stage = 'mail-from';
      } else if (stage === 'mail-from' && isSmtpSuccess(code)) {
        send(`RCPT TO:<${to}>`);
        stage = 'rcpt';
      } else if (stage === 'rcpt' && isSmtpSuccess(code)) {
        if (cc) {
          send(`RCPT TO:<${cc}>`);
          stage = 'rcpt-cc';
        } else {
          send('DATA');
          stage = 'data-wait';
        }
      } else if (stage === 'rcpt-cc' && isSmtpSuccess(code)) {
        send('DATA');
        stage = 'data-wait';
      } else if (stage === 'data-wait' && code === 354) {
        send(message);
        send('.');
        stage = 'data-done';
      } else if (stage === 'data-done' && isSmtpSuccess(code)) {
        send('QUIT');
        const mid = line.match(/queued as (\S+)/i)?.[1] || line.match(/<([^>]+)>/)?.[1] || messageId;
        succeed(mid, line);
      } else if (code >= 400) {
        fail(line);
      }
    }

    function onData(data) {
      buffer += data.toString();
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() || '';
      for (const line of parts) {
        if (!line) continue;
        onSmtpLine(line);
      }
    }

    try {
      if (secure && port === 465) {
        socket = tlsConnect({ host, port, rejectUnauthorized: false }, () => {});
      } else {
        socket = createConnection({ host, port }, () => {});
      }
      socket.on('data', onData);
      socket.on('error', (e) => fail(e.message));
      socket.on('close', () => {
        if (!finished && stage !== 'data-done') fail(`Connection closed (${stage})`);
      });
    } catch (e) {
      fail(e.message);
    }
  });
}

/**
 * Send email task. Always returns outputs object; does not throw on SMTP failure.
 */
export async function executeEmailTask(resolvedInputs, nodeConfig = {}, context = null) {
  const to = resolvedInputs.to?.trim();
  const subject = resolvedInputs.subject?.trim() || '(no subject)';
  const body = resolvedInputs.body?.trim() || '';
  const cc = resolvedInputs.cc?.trim() || '';

  if (!to) {
    return { sent: false, attempted: false, error: 'To address is required', messageId: null };
  }
  if (!body) {
    return { sent: false, attempted: false, error: 'Email body is required', messageId: null };
  }

  const owner =
    context?.owner_user_id || context?.ownerUserId || context?.ceo_user_id || context?.ceoUserId || null;
  const smtp = resolveSmtpConfig(nodeConfig, owner);
  const result = await sendSmtpMail({
    ...smtp,
    to,
    cc,
    subject,
    body,
  });

  return {
    sent: !!result.sent,
    attempted: !!result.attempted,
    messageId: result.messageId || null,
    smtpReply: result.smtpReply || null,
    error: result.error || null,
    to,
    subject,
    bodyLength: body.length,
  };
}

/**
 * HTTP API call task.
 */
export async function executeApiTask(resolvedInputs, nodeConfig = {}, context = null) {
  const render = (v) => (context && v != null ? renderWorkflowTemplates(String(v), context) : v);
  const cfg = context ? renderApiNodeConfig(nodeConfig, context) : nodeConfig;

  const url = render(resolvedInputs.url)?.trim();
  if (!url) throw new Error('API URL is required');

  const method = (cfg.method || 'POST').toUpperCase();
  const timeoutMs = Number(cfg.timeoutMs || 20 * 60 * 1000);
  const responseMode = String(cfg.responseMode || 'auto').toLowerCase();

  let headers = buildApiRequestHeaders(cfg, context, resolvedInputs.headers, url);

  let body = render(resolvedInputs.body);
  if (body && method !== 'GET' && method !== 'HEAD') {
    try {
      JSON.parse(body);
    } catch {
      headers['Content-Type'] = 'text/plain';
    }
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body || undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    wrapFetchError(err, `API ${method} ${url}`);
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const wantBinary =
    responseMode === 'binary' ||
    (responseMode === 'auto' &&
      contentType &&
      (contentType.startsWith('audio/') ||
        contentType.startsWith('video/') ||
        contentType.startsWith('image/') ||
        contentType.includes('octet-stream') ||
        contentType.includes('gltf') ||
        contentType.includes('model')));

  if (wantBinary) {
    const ab = await response.arrayBuffer();
    const buffer = Buffer.from(ab);
    if (!response.ok) {
      const snippet = buffer.slice(0, 400).toString('utf8');
      throw new Error(`API ${response.status}: ${snippet || response.statusText}`);
    }
    const owner = context?.owner_user_id || context?.actor?.id;
    if (!owner) throw new Error('API binary response requires workflow owner context');
    const { createMediaArtifact } = await import('./ceo-media-artifacts.js');
    const ext =
      contentType.includes('mpeg') || contentType.includes('mp3')
        ? 'mp3'
        : contentType.includes('wav')
          ? 'wav'
          : contentType.includes('ogg')
            ? 'ogg'
            : contentType.includes('mp4')
              ? 'mp4'
              : contentType.includes('webm')
                ? 'webm'
                : contentType.includes('glb')
                  ? 'glb'
                  : 'bin';
    const { ref } = createMediaArtifact(owner, {
      buffer,
      filename: `api-response.${ext}`,
      mimeType: contentType.split(';')[0].trim() || 'application/octet-stream',
    });
    const mediaKey = ref.kind === 'video' ? 'video' : ref.kind === 'model' ? 'model' : 'audio';
    return {
      ok: true,
      status: response.status,
      body: ref,
      [mediaKey]: ref,
      media: ref,
      responseMode: 'binary',
    };
  }

  let text;
  try {
    text = await response.text();
  } catch (err) {
    wrapFetchError(err, `API ${method} ${url}`);
  }

  assertHttpSuccess(response, text);

  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch (_) {}

  return {
    ok: true,
    status: response.status,
    body: parsed,
    // Keep full JSON for downstream API nodes (place/validate chains). Soft-cap huge payloads.
    bodyText: (typeof parsed === 'object' ? JSON.stringify(parsed) : String(text)).slice(0, 200000),
    responseMode: responseMode === 'text' ? 'text' : 'json',
  };
}

/**
 * Filesystem ops for scheduled/manual workflows (not a separate poller).
 * Paths must resolve under WORKFLOW_FS_ROOTS (comma-separated). If unset, uses <cwd>/tmp/workflow-fs.
 */
function workflowFsRoots() {
  const raw = String(process.env.WORKFLOW_FS_ROOTS || '').trim();
  if (raw) {
    return raw
      .split(',')
      .map((s) => resolve(s.trim()))
      .filter(Boolean);
  }
  const fallback = resolve(process.cwd(), 'tmp', 'workflow-fs');
  if (!existsSync(fallback)) mkdirSync(fallback, { recursive: true });
  return [fallback];
}

function assertPathInRoots(targetPath, roots) {
  const abs = resolve(targetPath);
  for (const root of roots) {
    const rel = relative(root, abs);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      return abs;
    }
  }
  throw new Error(`Path not allowed outside WORKFLOW_FS_ROOTS: ${abs}`);
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

export function executeFilesystemTask(resolvedInputs = {}, nodeConfig = {}, context = null) {
  const render = (v) =>
    context && v != null ? renderWorkflowTemplates(String(v), context) : v == null ? '' : String(v);
  const roots = workflowFsRoots();
  const op = String(nodeConfig.operation || resolvedInputs.operation || 'list').toLowerCase();
  const pathInput = render(resolvedInputs.path || nodeConfig.path || '.');
  const absPath = assertPathInRoots(pathInput || '.', roots);
  const glob = render(resolvedInputs.glob || nodeConfig.glob || '*') || '*';

  if (op === 'list') {
    if (!existsSync(absPath)) {
      return { ok: false, operation: 'list', path: absPath, count: 0, files: [], names: '', error: 'Directory not found' };
    }
    const st = statSync(absPath);
    if (!st.isDirectory()) {
      return { ok: false, operation: 'list', path: absPath, count: 0, files: [], names: '', error: 'Not a directory' };
    }
    const entries = readdirSync(absPath, { withFileTypes: true })
      .filter((e) => e.isFile() && matchSimpleGlob(e.name, glob))
      .map((e) => {
        const full = join(absPath, e.name);
        const s = statSync(full);
        return { name: e.name, path: full, size: s.size, mtime: s.mtime.toISOString() };
      });
    return {
      ok: true,
      operation: 'list',
      path: absPath,
      count: entries.length,
      files: entries,
      names: entries.map((f) => f.name).join('\n'),
      text: entries.map((f) => f.name).join('\n'),
      has_files: entries.length > 0,
    };
  }

  if (op === 'exists') {
    const ok = existsSync(absPath);
    return { ok, operation: 'exists', path: absPath, exists: ok, text: ok ? 'true' : 'false' };
  }

  if (op === 'stat') {
    if (!existsSync(absPath)) {
      return { ok: false, operation: 'stat', path: absPath, error: 'Not found' };
    }
    const s = statSync(absPath);
    return {
      ok: true,
      operation: 'stat',
      path: absPath,
      is_file: s.isFile(),
      is_directory: s.isDirectory(),
      size: s.size,
      mtime: s.mtime.toISOString(),
      text: `${absPath} size=${s.size}`,
    };
  }

  if (op === 'read_text') {
    if (!existsSync(absPath)) {
      return { ok: false, operation: 'read_text', path: absPath, error: 'Not found' };
    }
    const maxBytes = Math.min(Number(nodeConfig.maxBytes) || 65536, 1024 * 1024);
    const buf = readFileSync(absPath);
    const truncated = buf.length > maxBytes;
    const text = buf.slice(0, maxBytes).toString('utf8');
    return {
      ok: true,
      operation: 'read_text',
      path: absPath,
      size: buf.length,
      truncated,
      text,
      content: text,
    };
  }

  if (op === 'move') {
    const destInput = render(resolvedInputs.destination || nodeConfig.destination || '');
    if (!destInput) throw new Error('destination required for move');
    const destAbs = assertPathInRoots(destInput, roots);
    if (!existsSync(absPath)) {
      return { ok: false, operation: 'move', path: absPath, error: 'Source not found' };
    }
    const destDir = destAbs.endsWith('/') || destAbs.endsWith('\\') || (!existsSync(destAbs) && !basename(destAbs).includes('.'))
      ? destAbs
      : null;
    let finalDest = destAbs;
    if (existsSync(destAbs) && statSync(destAbs).isDirectory()) {
      finalDest = join(destAbs, basename(absPath));
    } else if (destDir) {
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      finalDest = join(destDir, basename(absPath));
    } else {
      const parent = resolve(destAbs, '..');
      if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    }
    renameSync(absPath, finalDest);
    return { ok: true, operation: 'move', path: absPath, destination: finalDest, text: finalDest };
  }

  throw new Error(`Unknown filesystem operation: ${op}`);
}
