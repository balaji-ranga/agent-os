/**
 * VPS/live CRM SSO shape check (no secrets printed).
 *
 *   node backend/scripts/vps-verify-crm-sso.js
 *
 * Asserts passwordless CRM handoff uses a short apply token (`t=`) on the
 * company workspace host — never Twenty `/verify?loginToken=` (that SPA path
 * shows Authentication failed → /welcome).
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function redactHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid';
  }
}

const { initDb } = await import('../src/db/schema.js');
const { getUserById } = await import('../src/services/users.js');
const { buildCrmSsoHandoff, isTwentySsoEnabled } = await import('../src/services/twenty-sso.js');

initDb();

if (!isTwentySsoEnabled()) {
  console.log('SKIP: twenty sso disabled (TWENTY_APP_SECRET / TWENTY_SSO_ENABLED)');
  process.exit(0);
}

const owner = process.env.CRM_SSO_VERIFY_OWNER || 'ceo-bala';
const user = getUserById(owner);
if (!user?.email) {
  console.log('SKIP: owner not in db', owner);
  process.exit(0);
}

const launch = await buildCrmSsoHandoff(owner, { flolahUser: user });
const iframe = String(launch.iframe_url || '');
const open = String(launch.open_url || '');
let parsed = null;
try {
  parsed = iframe ? new URL(iframe) : null;
} catch {
  parsed = null;
}

assert(launch.ok !== false, `crm sso not ok: ${launch.reason || launch.mode}`);
assert(parsed, 'iframe_url missing');
assert(parsed.pathname.replace(/\/+$/, '') === '/flolah-handoff', 'handoff path');
assert(parsed.searchParams.has('t'), 'short apply token t= required');
assert(parsed.searchParams.get('wipe') === '1', 'wipe=1 required');
assert(!iframe.includes('loginToken'), 'must not send loginToken JWT to the browser');
assert(!iframe.includes('/verify'), 'must not send browser to Twenty /verify');
assert(open.includes('/flolah-handoff/'), 'open_url is workspace handoff');

console.log('PASS: crm sso apply-handoff', {
  owner,
  mode: launch.mode,
  host: redactHost(iframe),
  has_t: true,
  has_loginToken: false,
});
