import { createHash } from 'node:crypto';
import { getDb } from '../db/schema.js';

let ready = false;

function ensureTable() {
  if (ready) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS auth_rate_limits (
      bucket_key TEXT PRIMARY KEY,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      window_started_ms INTEGER NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  ready = true;
}

function digest(value) {
  return createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex');
}

function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',').map((v) => v.trim()).filter(Boolean);
  return forwarded.at(-1) || String(req.socket?.remoteAddress || req.ip || 'unknown').replace(/^::ffff:/, '');
}

function consume(bucketKey, limit, windowMs) {
  ensureTable();
  const db = getDb();
  const now = Date.now();
  const transaction = db.transaction(() => {
    const row = db.prepare('SELECT attempt_count, window_started_ms FROM auth_rate_limits WHERE bucket_key = ?').get(bucketKey);
    if (!row || now - Number(row.window_started_ms) >= windowMs) {
      db.prepare(`INSERT INTO auth_rate_limits (bucket_key, attempt_count, window_started_ms, updated_at)
        VALUES (?, 1, ?, datetime('now'))
        ON CONFLICT(bucket_key) DO UPDATE SET attempt_count = 1, window_started_ms = excluded.window_started_ms, updated_at = datetime('now')`)
        .run(bucketKey, now);
      return { allowed: true, remaining: Math.max(0, limit - 1), retryAfter: Math.ceil(windowMs / 1000) };
    }
    if (Number(row.attempt_count) >= limit) {
      return { allowed: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((windowMs - (now - row.window_started_ms)) / 1000)) };
    }
    db.prepare(`UPDATE auth_rate_limits SET attempt_count = attempt_count + 1, updated_at = datetime('now') WHERE bucket_key = ?`).run(bucketKey);
    return { allowed: true, remaining: Math.max(0, limit - Number(row.attempt_count) - 1), retryAfter: 0 };
  });
  return transaction();
}

export function authRateLimit(name, { ipLimit, accountLimit = ipLimit, windowMs, accountField = 'email', resetOnSuccess = false }) {
  return (req, res, next) => {
    const ipKey = `ip:${name}:${digest(clientIp(req))}`;
    const ipResult = consume(ipKey, ipLimit, windowMs);
    const accountValue = req.body?.[accountField];
    const accountKey = accountValue ? `account:${name}:${digest(accountValue)}` : null;
    const accountResult = accountValue
      ? consume(accountKey, accountLimit, windowMs)
      : { allowed: true, remaining: accountLimit };
    if (!ipResult.allowed || !accountResult.allowed) {
      const retryAfter = Math.max(ipResult.retryAfter || 0, accountResult.retryAfter || 0);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    res.setHeader('X-RateLimit-Remaining', String(Math.min(ipResult.remaining, accountResult.remaining)));
    if (resetOnSuccess && typeof res.on === 'function') {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          const del = getDb().prepare('DELETE FROM auth_rate_limits WHERE bucket_key = ?');
          if (accountKey) del.run(accountKey);
        }
      });
    }
    return next();
  };
}
