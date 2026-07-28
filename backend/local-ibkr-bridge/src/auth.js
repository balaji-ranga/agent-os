/**
 * Local bearer auth + loopback bind helpers.
 */

/**
 * @param {import('http').IncomingMessage} req
 * @param {string} expectedToken
 * @returns {boolean}
 */
export function checkBearerAuth(req, expectedToken) {
  const header = String(req.headers.authorization || '');
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) return false;
  const got = m[1];
  const want = String(expectedToken || '');
  if (!want || got.length !== want.length) {
    // Still compare lengths carefully; avoid leaking via timing on empty
    return false;
  }
  // Constant-time-ish compare for equal-length tokens
  let diff = 0;
  for (let i = 0; i < want.length; i++) {
    diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Refuse non-loopback binds unless explicitly overridden (security default).
 * @param {string} host
 */
export function assertLoopbackHost(host) {
  const h = String(host || '').trim().toLowerCase();
  const allowed = new Set(['127.0.0.1', '::1', 'localhost']);
  if (allowed.has(h)) return;
  if (process.env.BRIDGE_ALLOW_NON_LOOPBACK === '1') {
    console.warn(
      '[bridge] WARNING: binding non-loopback host',
      h,
      '(BRIDGE_ALLOW_NON_LOOPBACK=1)'
    );
    return;
  }
  throw new Error(
    `BRIDGE_HOST must be loopback (127.0.0.1 / ::1 / localhost); got "${host}". ` +
      'Set BRIDGE_ALLOW_NON_LOOPBACK=1 only if you understand the risk.'
  );
}
