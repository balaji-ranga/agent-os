/**
 * VPS smoke: public origin configured, distinct CEO aliases, HN execute.
 * Run: docker compose exec -T backend node scripts/test-openconnector-selfservice.js
 */
import { getDb, initDb } from '../src/db/schema.js';
import {
  defaultConnectionName,
  executeConnectorAction,
  getConnectorConnectionsForUser,
  getOpenConnectorEnvConfig,
  provisionOpenConnectorForUser,
} from '../src/services/openconnector.js';

initDb();

const env = getOpenConnectorEnvConfig();
const origin = env.public_origin || env.origin || '';
if (!origin || !/openconnector/i.test(origin)) {
  console.error('FAIL: OPENCONNECTOR_PUBLIC_ORIGIN / OOMOL_CONNECT_ORIGIN must include /openconnector');
  console.error('got:', origin || '(empty)');
  process.exit(1);
}
console.log('origin ok', origin);

const db = getDb();
const ceos = db
  .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1 ORDER BY id LIMIT 2`)
  .all();
if (!ceos.length) {
  console.error('FAIL: no enabled CEO users');
  process.exit(1);
}

const aliases = [];
for (const { id } of ceos) {
  const link = await provisionOpenConnectorForUser({ id }, { ensureConnections: false });
  const alias = link.connection_name || defaultConnectionName(id);
  aliases.push({ id, alias });
  console.log('provisioned', id, alias, 'token_set=', !!link.runtime_token_set);
  const conns = await getConnectorConnectionsForUser(id);
  console.log('connections', id, (conns.connections || []).length);
}

if (aliases.length >= 2 && aliases[0].alias === aliases[1].alias) {
  console.error('FAIL: CEO connection aliases collided', aliases);
  process.exit(1);
}
console.log(
  'alias isolation ok',
  aliases.map((a) => a.alias).join(' vs ')
);

const r = await executeConnectorAction(ceos[0].id, 'hackernews.get_top_stories', {});
console.log('HN execute ok', JSON.stringify(r).slice(0, 200));
console.log('SELF_SERVICE_NODE_OK');
