/**
 * Shared helpers for post-CEO-login regression packs.
 */
const BASE = process.env.BASE_URL || process.env.AGENT_OS_BASE_URL || 'http://127.0.0.1:3001';

export function apiBase() {
  return BASE.replace(/\/$/, '');
}

export async function ceoLogin() {
  // VPS / CI: mint a session outside login (see deploy/scripts/vps-regression-full.sh).
  const minted = String(process.env.AGENT_OS_REGRESSION_TOKEN || '').trim();
  if (minted) {
    const { status, data } = await request('GET', '/api/auth/me', { token: minted });
    if (status !== 200 || !data?.user?.id) {
      throw new Error(`minted CEO session rejected: ${status} ${JSON.stringify(data)?.slice(0, 120)}`);
    }
    return { user: data.user, token: minted };
  }
  const email = process.env.AGENT_OS_BALA_EMAIL || 'bala@agent-os.local';
  const password = process.env.AGENT_OS_BALA_PASSWORD || 'bala-change-me';
  const res = await fetch(`${apiBase()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`CEO login failed: ${data.error || res.status}`);
  if (data.mfa_required || data.mfa_setup_required) {
    throw new Error(
      'CEO MFA is required — set AGENT_OS_REQUIRE_MFA=0 for regression or complete MFA first'
    );
  }
  if (!data.session?.token) throw new Error('CEO login missing session.token');
  return { user: data.user, token: data.session.token };
}

export function authHeaders(token, extra = {}) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

export async function request(method, path, { token, body, headers } = {}) {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: token ? authHeaders(token, headers) : { 'Content-Type': 'application/json', ...headers },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { res, data, status: res.status };
}

export function createRunner(name) {
  const results = [];
  return {
    async check(label, fn) {
      try {
        await fn();
        console.log(`  OK  ${label}`);
        results.push({ label, ok: true });
      } catch (e) {
        console.error(`  FAIL ${label}: ${e.message}`);
        results.push({ label, ok: false, error: e.message });
      }
    },
    async expectStatus(label, method, path, opts, expected) {
      await this.check(label, async () => {
        const { status, data } = await request(method, path, opts);
        const ok = Array.isArray(expected) ? expected.includes(status) : status === expected;
        if (!ok) {
          throw new Error(`expected ${expected}, got ${status}: ${JSON.stringify(data)?.slice(0, 200)}`);
        }
      });
    },
    summary() {
      const failed = results.filter((r) => !r.ok);
      console.log(`\n[${name}] ${results.length - failed.length}/${results.length} passed`);
      return failed.length === 0 ? 0 : 1;
    },
    results,
  };
}
