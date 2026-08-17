/**
 * Minimal FTP/FTPS client (PASV) — no npm deps, shared by Flolah server and desktop runner.
 * Supports list / exists / stat / read_text / write_text / move.
 */
import { createConnection } from 'net';
import { connect as tlsConnect } from 'tls';

function encodePath(p) {
  const s = String(p || '/').replace(/\\/g, '/');
  if (!s.startsWith('/')) return `/${s}`;
  return s.replace(/\/{2,}/g, '/');
}

function joinRemote(dir, name) {
  const base = encodePath(dir).replace(/\/+$/, '');
  return `${base}/${String(name).replace(/^\/+/, '')}`;
}

function parsePasv(line) {
  const m = String(line).match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
  if (!m) throw new Error(`FTP PASV parse failed: ${line}`);
  return { host: `${m[1]}.${m[2]}.${m[3]}.${m[4]}`, port: Number(m[5]) * 256 + Number(m[6]) };
}

function connectSocket({ host, port, timeoutMs, tls }) {
  return new Promise((resolve, reject) => {
    const sock = tls
      ? tlsConnect({ host, port, rejectUnauthorized: false, timeout: timeoutMs })
      : createConnection({ host, port, timeout: timeoutMs });
    const fail = (e) => {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      reject(e);
    };
    sock.setTimeout(timeoutMs);
    sock.once('timeout', () => fail(new Error('FTP socket timeout')));
    sock.once('error', fail);
    sock.once('connect', () => {
      sock.setTimeout(0);
      resolve(sock);
    });
    if (tls) {
      sock.once('secureConnect', () => {
        sock.setTimeout(0);
        resolve(sock);
      });
    }
  });
}

class FtpSession {
  constructor(opts) {
    this.opts = opts;
    this.ctrl = null;
    this.buf = '';
    this.pending = [];
  }

  async open() {
    const { host, port, timeoutMs, implicitTls } = this.opts;
    this.ctrl = await connectSocket({ host, port, timeoutMs, tls: implicitTls });
    this.ctrl.setEncoding('utf8');
    this.ctrl.on('data', (chunk) => this._onData(chunk));
    this.ctrl.on('error', (e) => this._failAll(e));
    this.ctrl.on('close', () => this._failAll(new Error('FTP control closed')));
    await this._readGreeting();
    if (this.opts.explicitTls && !this.opts.implicitTls) {
      await this.cmd('AUTH TLS', [234, 334]);
      await this._upgradeCtrlTls();
    }
    await this.cmd(`USER ${this.opts.user}`, [230, 331]);
    if (this.opts.pass != null && this.opts.pass !== '') {
      await this.cmd(`PASS ${this.opts.pass}`, [230]);
    }
    await this.cmd('TYPE I', [200]);
  }

  _upgradeCtrlTls() {
    return new Promise((resolve, reject) => {
      const secure = tlsConnect({
        socket: this.ctrl,
        host: this.opts.host,
        rejectUnauthorized: false,
      });
      secure.once('error', reject);
      secure.once('secureConnect', () => {
        this.ctrl = secure;
        this.ctrl.setEncoding('utf8');
        this.ctrl.on('data', (chunk) => this._onData(chunk));
        resolve();
      });
    });
  }

  _onData(chunk) {
    this.buf += chunk;
    while (true) {
      const idx = this.buf.indexOf('\r\n');
      if (idx < 0) break;
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      if (line.length >= 4 && line[3] === '-' ) continue;
      if (line.length >= 4 && /\d{3} /.test(line.slice(0, 4))) {
        const code = Number(line.slice(0, 3));
        const waiter = this.pending.shift();
        if (waiter) waiter.resolve({ code, line });
      }
    }
  }

  _failAll(err) {
    while (this.pending.length) this.pending.shift().reject(err);
  }

  _readGreeting() {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
    }).then(({ code }) => {
      if (code >= 400) throw new Error(`FTP greeting ${code}`);
    });
  }

  cmd(line, okCodes) {
    return new Promise((resolve, reject) => {
      this.pending.push({
        resolve: (msg) => {
          if (okCodes && !okCodes.includes(msg.code)) {
            reject(new Error(`FTP ${line.split(' ')[0]} failed (${msg.code}): ${msg.line}`));
          } else resolve(msg);
        },
        reject,
      });
      this.ctrl.write(`${line}\r\n`);
    });
  }

  async pasvConnect() {
    const { line } = await this.cmd('PASV', [227]);
    const { host, port } = parsePasv(line);
    const dataHost = this.opts.preferControlHost ? this.opts.host : host;
    return connectSocket({
      host: dataHost,
      port,
      timeoutMs: this.opts.timeoutMs,
      tls: this.opts.implicitTls || this.opts.explicitTls,
    });
  }

  async withData(fn) {
    const sock = await this.pasvConnect();
    try {
      return await fn(sock);
    } finally {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
    }
  }

  async list(dir) {
    const remote = encodePath(dir);
    const raw = await this.withData(async (sock) => {
      const chunks = [];
      sock.on('data', (c) => chunks.push(c));
      const xfer = this.cmd(`LIST ${remote}`, [125, 150, 226, 250]);
      const body = await new Promise((resolve, reject) => {
        sock.once('error', reject);
        sock.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        sock.once('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      await xfer.catch(() => {});
      await this.cmd('NOOP', [200, 250]).catch(() => {});
      return body;
    });
    return parseList(raw, remote);
  }

  async retr(path, maxBytes) {
    const remote = encodePath(path);
    return this.withData(async (sock) => {
      const chunks = [];
      let size = 0;
      sock.on('data', (c) => {
        const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
        size += buf.length;
        if (size <= maxBytes) chunks.push(buf);
      });
      await this.cmd(`RETR ${remote}`, [125, 150]);
      const body = await new Promise((resolve, reject) => {
        sock.once('error', reject);
        sock.once('end', () => resolve(Buffer.concat(chunks)));
        sock.once('close', () => resolve(Buffer.concat(chunks)));
      });
      await this.cmd('NOOP', [200, 250]).catch(() => {});
      return { buf: body, size, truncated: size > maxBytes };
    });
  }

  async stor(path, content) {
    const remote = encodePath(path);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const sock = await this.pasvConnect();
    try {
      await this.cmd(`STOR ${remote}`, [125, 150]);
      await new Promise((resolve, reject) => {
        sock.once('error', reject);
        sock.end(buf, () => resolve());
      });
      await this.cmd('NOOP', [200, 226, 250]).catch(() => {});
    } finally {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
    }
    return buf.length;
  }

  async size(path) {
    const { line, code } = await this.cmd(`SIZE ${encodePath(path)}`, [213, 550]);
    if (code === 550) return null;
    const n = Number(String(line).slice(4).trim());
    return Number.isFinite(n) ? n : null;
  }

  async rename(from, to) {
    await this.cmd(`RNFR ${encodePath(from)}`, [350]);
    await this.cmd(`RNTO ${encodePath(to)}`, [250]);
  }

  async mkdirp(dir) {
    const parts = encodePath(dir).split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      cur += `/${p}`;
      await this.cmd(`MKD ${cur}`, [257, 250, 550]).catch(() => {});
    }
  }

  async close() {
    try {
      this.ctrl?.write('QUIT\r\n');
    } catch {
      /* ignore */
    }
    try {
      this.ctrl?.destroy();
    } catch {
      /* ignore */
    }
  }
}

function parseList(raw, dir) {
  const files = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('total ')) continue;
    const unix = t.match(/^([-dl])[rwx-]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+[\d:]+\s+(.+)$/);
    if (unix) {
      if (unix[1] === 'd') continue;
      const name = unix[3].split(' -> ')[0];
      if (name === '.' || name === '..') continue;
      files.push({ name, path: joinRemote(dir, name), size: Number(unix[2]) || 0 });
      continue;
    }
    const dos = t.match(/^\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}[AP]M\s+(\d+|<DIR>)\s+(.+)$/i);
    if (dos) {
      if (String(dos[1]).toUpperCase() === '<DIR>') continue;
      files.push({ name: dos[2], path: joinRemote(dir, dos[2]), size: Number(dos[1]) || 0 });
    }
  }
  return files;
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

export async function executeFtpOperations({
  host,
  port,
  user,
  pass,
  secure,
  op,
  path: remotePath,
  glob,
  content,
  destination,
  maxBytes,
  timeoutMs,
}) {
  const session = new FtpSession({
    host,
    port: Number(port) || (secure ? 990 : 21),
    user: user || 'anonymous',
    pass: pass || '',
    timeoutMs: Number(timeoutMs) || 30000,
    implicitTls: secure === 'implicit' || Number(port) === 990,
    explicitTls: secure === true || secure === 'explicit' || secure === 'ftps',
    preferControlHost: true,
  });
  const path = encodePath(remotePath || '/');
  try {
    await session.open();
    if (op === 'list') {
      const entries = (await session.list(path)).filter((f) => matchGlob(f.name, glob));
      return {
        ok: true,
        operation: 'list',
        transport: 'ftp',
        path,
        count: entries.length,
        files: entries,
        names: entries.map((f) => f.name).join('\n'),
        text: entries.map((f) => f.name).join('\n'),
        has_files: entries.length > 0,
      };
    }
    if (op === 'exists') {
      const sz = await session.size(path);
      const ok = sz != null;
      return { ok, operation: 'exists', transport: 'ftp', path, exists: ok, text: ok ? 'true' : 'false' };
    }
    if (op === 'stat') {
      const size = await session.size(path);
      if (size == null) return { ok: false, operation: 'stat', transport: 'ftp', path, error: 'Not found' };
      return {
        ok: true,
        operation: 'stat',
        transport: 'ftp',
        path,
        is_file: true,
        size,
        text: `${path} size=${size}`,
      };
    }
    if (op === 'read_text') {
      const cap = Math.min(Number(maxBytes) || 65536, 2 * 1024 * 1024);
      const { buf, size, truncated } = await session.retr(path, cap);
      const text = buf.toString('utf8');
      return {
        ok: true,
        operation: 'read_text',
        transport: 'ftp',
        path,
        size,
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
      await session.mkdirp(parent);
      await session.stor(path, body);
      return { ok: true, operation: 'write_text', transport: 'ftp', path, bytes, text: 'written' };
    }
    if (op === 'move') {
      if (!destination) throw new Error('destination required for move');
      await session.rename(path, encodePath(destination));
      return {
        ok: true,
        operation: 'move',
        transport: 'ftp',
        path,
        destination: encodePath(destination),
        text: encodePath(destination),
      };
    }
    throw new Error(`Unknown filesystem operation: ${op}`);
  } finally {
    await session.close();
  }
}
