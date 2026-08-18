/**
 * Unit: Twenty CRM browser SSO handoff tokens (persist / consume / host bind).
 *
 *   node backend/scripts/test-twenty-sso-handoff.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import {
  persistTwentySsoBrowserTokens,
  consumeTwentySsoBrowserToken,
  buildVerifyNextPath,
  buildCrmHandoffUrl,
} from '../src/services/twenty-sso.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

initDb();
const suffix = randomBytes(4).toString('hex');
const owner = `ceo-sso-t-${suffix}`;
const tokens = [];

try {
  const persisted = persistTwentySsoBrowserTokens({
    ownerUserId: owner,
    email: `${owner}@example.invalid`,
    workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    publicBase: 'https://wise-test.crm.example.com',
    tokens: {
      accessOrWorkspaceAgnosticToken: { token: 'hdr.payload.sig' },
      refreshToken: { token: 'hdr.refresh.sig' },
    },
  });
  tokens.push(persisted.iframeToken, persisted.openToken);
  assert(persisted.iframeToken && persisted.openToken, 'two tokens');
  assert(persisted.iframeToken !== persisted.openToken, 'iframe/open distinct');
  assert(persisted.expectedHost === 'wise-test.crm.example.com', 'expected host from public base');

  const ok = consumeTwentySsoBrowserToken(persisted.iframeToken, {
    hostname: 'wise-test.crm.example.com',
  });
  assert(ok.ok === true, 'consume ok');
  assert(ok.tokenPair.accessOrWorkspaceAgnosticToken.token === 'hdr.payload.sig', 'access pair');
  assert(ok.replay === false, 'first consume');

  const replay = consumeTwentySsoBrowserToken(persisted.iframeToken, {
    hostname: 'wise-test.crm.example.com',
  });
  assert(replay.replay === true, 'replay until TTL');

  let mismatch = null;
  try {
    consumeTwentySsoBrowserToken(persisted.openToken, { hostname: 'other.crm.example.com' });
  } catch (e) {
    mismatch = e;
  }
  assert(mismatch && mismatch.status === 403, 'host mismatch rejected');

  let missing = null;
  try {
    consumeTwentySsoBrowserToken('not-a-token');
  } catch (e) {
    missing = e;
  }
  assert(missing && missing.status === 404, 'unknown token rejected');

  assert(
    buildVerifyNextPath('abc.def.ghi') === '/verify?loginToken=abc.def.ghi',
    'deprecated helper still documents the broken Twenty path'
  );

  const blocked = new URL(
    buildCrmHandoffUrl('https://wise-test.crm.example.com', owner, '/verify', { wipe: true })
  );
  assert(blocked.searchParams.get('next') === '/', 'handoff must not send /verify');
  assert(!blocked.search.includes('loginToken'), 'handoff must not include loginToken');
  assert(!blocked.hash.includes('lt='), 'handoff must not hash loginToken');

  const applyHu = new URL(
    buildCrmHandoffUrl('https://wise-test.crm.example.com', owner, '/', {
      wipe: true,
      t: 'deadbeef',
    })
  );
  assert(applyHu.searchParams.get('t') === 'deadbeef', 'apply handoff uses short t=');
  assert(applyHu.searchParams.get('next') === '/', 'apply next is desk root');
  assert(!applyHu.search.includes('loginToken'), 'apply handoff has no loginToken JWT');

  console.log('PASS: twenty sso handoff tokens', { suffix });
} finally {
  const db = getDb();
  for (const t of tokens) {
    try {
      db.prepare('DELETE FROM twenty_sso_tokens WHERE token = ?').run(t);
    } catch {
      /* ignore */
    }
  }
  try {
    db.prepare('DELETE FROM twenty_sso_tokens WHERE owner_user_id = ?').run(owner);
  } catch {
    /* ignore */
  }
}
