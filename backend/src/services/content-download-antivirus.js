import net from 'node:net';
import { createHash } from 'node:crypto';
import { getDb } from '../db/schema.js';

function scanError(message, code = 'SCAN_UNAVAILABLE') {
  return Object.assign(new Error(message), { status: 503, code });
}

/** clamd INSTREAM protocol. Fixed administrator-configured destination only.
 * Never pass a model-supplied host, filename, path or shell command to the scanner. */
export async function clamCommand(command, bytes, { host, port = 3310, timeoutMs = 30000 } = {}) {
  if (!host) throw scanError('Antivirus is not configured; attachment delivery is blocked.');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let reply = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; socket.destroy();
      error ? reject(error) : resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(scanError('Antivirus scan timed out; attachment delivery is blocked.')));
    socket.on('error', () => finish(scanError('Antivirus is unavailable; attachment delivery is blocked.')));
    socket.on('end', () => finish(scanError('Antivirus returned an incomplete response; attachment delivery is blocked.')));
    socket.on('data', chunk => {
      reply += chunk.toString('utf8');
      if (reply.length > 4096) return finish(scanError('Invalid antivirus response'));
      const end = reply.indexOf('\0');
      if (end >= 0) finish(null, reply.slice(0, end).trim());
    });
    socket.on('connect', async () => {
      try {
        const write = data => new Promise((yes, no) => socket.write(data, error => error ? no(error) : yes()));
        await write(Buffer.from(`z${command}\0`));
        if (bytes) {
          for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
            if (settled) return;
            const chunk = bytes.subarray(offset, offset + 64 * 1024);
            const size = Buffer.alloc(4); size.writeUInt32BE(chunk.length);
            await write(Buffer.concat([size, chunk]));
          }
          await write(Buffer.alloc(4));
        }
      } catch { finish(scanError('Antivirus stream failed; attachment delivery is blocked.')); }
    });
  });
}

export function validateClamVersion(version, { maxAgeHours = 72, now = Date.now() } = {}) {
  const match = String(version || '').match(/^ClamAV ([^/]+)\/(\d+)\/(.+)$/);
  const updated = match && Date.parse(match[3]);
  if (!match || !Number.isFinite(updated) || now - updated > maxAgeHours * 3600000 || updated > now + 3600000) {
    throw scanError('Antivirus signatures are missing, stale or invalid; attachment delivery is blocked.', 'SCAN_SIGNATURES_STALE');
  }
  return { engine_version: match[1], signature_version: match[2], signatures_updated_at: new Date(updated).toISOString() };
}

export async function scanDownloadBytes(bytes, { command = clamCommand, config = null } = {}) {
  const settings = config || {
    host: process.env.CONTENT_DOWNLOAD_CLAMAV_HOST,
    port: Number(process.env.CONTENT_DOWNLOAD_CLAMAV_PORT || 3310),
    timeoutMs: 30000,
  };
  const mode = config?.mode || process.env.CONTENT_DOWNLOAD_AV_MODE || 'required';
  if (mode !== 'required') throw scanError('Antivirus must be required for content downloads; attachment delivery is blocked.');
  const version = validateClamVersion(await command('VERSION', null, settings));
  const result = await command('INSTREAM', bytes, settings);
  if (/ FOUND$/.test(result)) throw Object.assign(new Error('Antivirus detected unsafe content; attachment delivery is blocked.'), { status: 422, code: 'MALWARE_DETECTED' });
  if (result !== 'stream: OK') throw scanError('Antivirus could not scan the complete file; attachment delivery is blocked.', 'SCAN_INCOMPLETE');
  return { status: 'clean', scanner: 'ClamAV', ...version, scanned_at: new Date().toISOString(), sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function recordDownloadScan(owner, scan, bytes) {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS content_download_scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, owner_user_id TEXT NOT NULL, sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL, status TEXT NOT NULL, scanner TEXT NOT NULL,
    engine_version TEXT, signature_version TEXT, scanned_at TEXT NOT NULL);`);
  const hash = scan.sha256 || createHash('sha256').update(bytes).digest('hex');
  db.prepare('INSERT INTO content_download_scans(owner_user_id,sha256,size_bytes,status,scanner,engine_version,signature_version,scanned_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(owner, hash, bytes.length, scan.status || 'blocked', 'ClamAV', scan.engine_version || null, scan.signature_version || null, scan.scanned_at || new Date().toISOString());
}
