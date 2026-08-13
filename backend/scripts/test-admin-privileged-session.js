/**
 * Smoke: privileged-session helpers + recovery status (no OTP, no mutate).
 *   cd backend && node scripts/test-admin-privileged-session.js
 */
import { initDb } from '../src/db/schema.js';
import {
  PRIVILEGED_PURPOSE,
  normalizePrivilegedPurpose,
  privilegedSessionTtlMs,
  assertPureAdmin,
  requirePrivilegedSession,
  ensurePrivilegedSessionTable,
} from '../src/services/admin-privileged-session.js';
import { getRecoveryStatus } from '../src/services/openclaw-admin-recovery.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

initDb();
ensurePrivilegedSessionTable();

assert(normalizePrivilegedPurpose('tls_certs') === PRIVILEGED_PURPOSE.TLS_CERTS, 'purpose tls');
assert(normalizePrivilegedPurpose('nope') === PRIVILEGED_PURPOSE.ADMIN, 'unknown purpose → shared');
assert(privilegedSessionTtlMs() >= 60_000, 'ttl at least 1 min');

let threw = false;
try {
  assertPureAdmin({ role: 'ceo' });
} catch (e) {
  threw = e.status === 403;
}
assert(threw, 'non-admin rejected');

threw = false;
try {
  requirePrivilegedSession({
    userId: 'admin-test',
    role: 'admin',
    impersonation: null,
    token: '',
    purpose: PRIVILEGED_PURPOSE.OPENCLAW_RECOVERY,
  });
} catch (e) {
  threw = e.status === 401 && e.code === 'privileged_session_required';
}
assert(threw, 'empty token rejected');

threw = false;
try {
  requirePrivilegedSession({
    userId: 'admin-test',
    role: 'admin',
    impersonation: null,
    token: 'deadbeef',
    purpose: PRIVILEGED_PURPOSE.ADMIN,
  });
} catch (e) {
  threw = e.status === 401;
}
assert(threw, 'bogus token rejected');

const st = await getRecoveryStatus({});
assert(st && st.gateway && st.config && st.queues, 'status envelope');
assert(Array.isArray(st.ceos), 'ceo list');
console.log(
  JSON.stringify(
    {
      ok: true,
      ttl_ms: privilegedSessionTtlMs(),
      gateway_http: st.gateway?.root?.http || st.gateway?.root?.ok,
      chat_ok: st.gateway?.chat?.ok,
      open_delegations: st.queues.open_delegations,
      ceos: st.ceos.length,
    },
    null,
    2
  )
);
