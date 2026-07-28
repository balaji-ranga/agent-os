/**
 * Smoke: build lite local IBKR bridge zip (no Node runtime download).
 * Usage: DESKTOP_PACKAGE_SKIP_NODE_RUNTIME=1 node scripts/test-local-ibkr-bridge-package.js
 */
import { buildLocalIbkrBridgePackageZip } from '../src/services/local-ibkr-bridge-package.js';
import { extractZipEntryBySuffix } from '../src/services/zip-store.js';

process.env.DESKTOP_PACKAGE_SKIP_NODE_RUNTIME = '1';

const r = await buildLocalIbkrBridgePackageZip({
  ownerUserId: 'test-ceo',
  includeRuntime: false,
});

const env = extractZipEntryBySuffix(r.zip, '.env');
const meta = extractZipEntryBySuffix(r.zip, 'bridge.meta.json');
const pkg = extractZipEntryBySuffix(r.zip, 'package.json');
const vendor = extractZipEntryBySuffix(r.zip, 'vendor/ibkr-gateway-client.js');
const orderEvents = extractZipEntryBySuffix(r.zip, 'vendor/ibkr-order-events.js');
const readme = extractZipEntryBySuffix(r.zip, 'README-BRIDGE.txt');
const envEx = extractZipEntryBySuffix(r.zip, '.env.example');

const envStr = Buffer.isBuffer(env) ? env.toString('utf8') : String(env);
const tok = envStr.match(/LOCAL_BRIDGE_TOKEN=([0-9a-f]+)/)?.[1];
const metaObj = JSON.parse(Buffer.isBuffer(meta) ? meta.toString('utf8') : String(meta));
const deps = JSON.parse(Buffer.isBuffer(pkg) ? pkg.toString('utf8') : String(pkg)).dependencies;
const orderEventsStr = Buffer.isBuffer(orderEvents) ? orderEvents.toString('utf8') : String(orderEvents || '');

if (!tok || tok.length !== 48) throw new Error('expected 48-hex LOCAL_BRIDGE_TOKEN in .env');
if (JSON.stringify(metaObj).includes(tok)) throw new Error('full token must not appear in bridge.meta.json');
if (metaObj.token_prefix !== tok.slice(0, 8)) throw new Error('token_prefix mismatch');
if (!deps['@stoqey/ib'] || !deps.dotenv) throw new Error('package.json missing @stoqey/ib or dotenv');
if (!vendor || vendor.length < 100) throw new Error('vendor ibkr-gateway-client missing');
if (!orderEventsStr.includes('Standalone vendor stub') || orderEventsStr.includes('getDb')) {
  throw new Error('vendor ibkr-order-events must be DB-free stub');
}
if (!readme) throw new Error('README-BRIDGE.txt missing');
if (!envEx) throw new Error('.env.example missing');
if (r.filename !== 'local-ibkr-bridge-lite.zip') throw new Error(`unexpected filename ${r.filename}`);

console.log('OK local-ibkr-bridge package smoke', {
  filename: r.filename,
  token_prefix: r.token_prefix,
  bytes: r.zip.length,
  include_runtime: r.include_runtime,
  stoqey: deps['@stoqey/ib'],
});
