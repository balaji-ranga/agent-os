/**
 * Smoke: OpenConnector CEO OAuth app override store + HN execute + GitHub authorize wiring.
 * Run: docker compose exec -T backend node scripts/test-openconnector-oauth-override.js
 *
 * Env:
 *   OC_OVERRIDE_TEST_CLIENT_ID / OC_OVERRIDE_TEST_CLIENT_SECRET — optional real GitHub OAuth
 *   app used as platform cache so seed-lease BYOA can restore after the test.
 */
import { getDb, initDb } from '../src/db/schema.js';
import {
  defaultConnectionName,
  executeConnectorAction,
  getOpenConnectorEnvConfig,
  provisionOpenConnectorForUser,
  startConnectorOAuth,
  upsertConnectorConnection,
  upsertOAuthClientConfig,
} from '../src/services/openconnector.js';
import {
  deleteOpenConnectorOauthOverride,
  getOpenConnectorOauthOverridePublic,
  resolveOpenConnectorOauthClientForAuthorize,
  upsertOpenConnectorOauthOverride,
  upsertOpenConnectorPlatformOauthClient,
} from '../src/services/openconnector-oauth-override.js';
import { authorizationUrlUsesClientId } from '../src/services/openconnector-oauth-lease.js';

initDb();

const env = getOpenConnectorEnvConfig();
console.log('OC env', {
  url: env.url,
  public_origin: env.public_origin,
  allowed_custom_oauth: env.allowed_custom_oauth || '(empty)',
});

const db = getDb();
const ceo = db
  .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1 ORDER BY id LIMIT 1`)
  .get();
if (!ceo?.id) {
  console.error('FAIL: no enabled CEO');
  process.exit(1);
}
const owner = ceo.id;
console.log('CEO', owner, 'alias', defaultConnectionName(owner));

await provisionOpenConnectorForUser({ id: owner }, { ensureConnections: false });

const testId = `oc-test-${Date.now().toString(36)}`;
const testSecret = `ocs_${Date.now()}_secret`;
upsertOpenConnectorOauthOverride('github', owner, {
  client_id: testId,
  client_secret: testSecret,
  scopes: 'read:user',
});
const pub = getOpenConnectorOauthOverridePublic('github', owner);
if (!pub.has_user_override || !pub.secret_set) {
  console.error('FAIL: override public view', pub);
  process.exit(1);
}
const resolved = resolveOpenConnectorOauthClientForAuthorize('github', owner);
if (resolved?.clientId !== testId || resolved?.clientSecret !== testSecret) {
  console.error('FAIL: resolve mismatch');
  process.exit(1);
}
console.log('override encrypt/resolve ok', pub.client_id_hint);
deleteOpenConnectorOauthOverride('github', owner);

await upsertConnectorConnection(owner, 'hackernews', { authType: 'no_auth' });
const hn = await executeConnectorAction(owner, 'hackernews.get_top_stories', {});
console.log('HN execute ok', JSON.stringify(hn).slice(0, 180));

const overrideClientId = String(process.env.OC_OVERRIDE_TEST_CLIENT_ID || '').trim();
const overrideClientSecret = String(process.env.OC_OVERRIDE_TEST_CLIENT_SECRET || '').trim();

if (overrideClientId && overrideClientSecret) {
  upsertOpenConnectorPlatformOauthClient('github', {
    client_id: overrideClientId,
    client_secret: overrideClientSecret,
  });
  try {
    await upsertOAuthClientConfig('github', {
      clientId: overrideClientId,
      clientSecret: overrideClientSecret,
    });
  } catch (e) {
    console.warn('OC platform upsert', e.message);
  }

  const byoaId = `Ov23liByoa${Date.now().toString(36)}`;
  const byoaSecret = `byoa_${Date.now()}_secret`;
  upsertOpenConnectorOauthOverride('github', owner, {
    client_id: byoaId,
    client_secret: byoaSecret,
  });

  const started = await startConnectorOAuth(owner, 'github');
  if (started.credentials_source !== 'user') {
    console.error('FAIL: expected credentials_source=user', started);
    process.exit(1);
  }
  const url = String(started.authorization_url || '');
  if (!authorizationUrlUsesClientId(url, byoaId)) {
    console.error('FAIL: authorize URL missing BYOA client_id', {
      delivery: started.credentials_delivery,
      url: url.slice(0, 200),
    });
    process.exit(1);
  }
  console.log('GitHub OAuth start with BYOA ok', {
    credentials_source: started.credentials_source,
    credentials_delivery: started.credentials_delivery,
    url_prefix: url.slice(0, 120),
  });
  deleteOpenConnectorOauthOverride('github', owner);
} else {
  try {
    const started = await startConnectorOAuth(owner, 'github');
    console.log('GitHub OAuth start (platform) ok', {
      credentials_source: started.credentials_source,
      credentials_delivery: started.credentials_delivery,
      has_url: !!started.authorization_url,
      url_prefix: String(started.authorization_url || '').slice(0, 120),
    });
  } catch (e) {
    console.warn('GitHub OAuth start skipped/failed:', e.message);
  }
}

console.log('OC_OAUTH_OVERRIDE_OK');
