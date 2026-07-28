/**
 * Offline smoke: mock IBKR, ephemeral token, /health + auth 401 + /account-snapshot.
 * Also exercises webhook pusher backoff without network.
 */
import { createServer } from 'node:http';
import { startBridge } from '../server.js';
import { createWebhookPusher } from '../src/webhook-pusher.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TEST_BRIDGE_PORT || 13010);
const TOKEN = 'test-offline-bridge-token';

process.env.BRIDGE_HOST = '127.0.0.1';
process.env.BRIDGE_PORT = String(PORT);
process.env.LOCAL_BRIDGE_TOKEN = TOKEN;
process.env.BRIDGE_MOCK_IBKR = '1';
process.env.BRIDGE_ALLOW_EPHEMERAL_TOKEN = '0';
process.env.EQUITY_MARK_INTERVAL_SEC = '0';
process.env.WEBHOOK_URL = '';
process.env.IBKR_TRADING_ENABLED = '0';
process.env.IBKR_IS_PAPER = 'true';
process.env.NODE_ENV = 'test';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else {
    console.log('OK:', msg);
  }
}

async function jsonFetch(path, { method = 'GET', token = TOKEN, body } = {}) {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const res = await fetch('http://127.0.0.1:' + PORT + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text };
}

async function testWebhookBackoff() {
  const tmp = mkdtempSync(join(tmpdir(), 'bridge-wh-'));
  const retryFile = join(tmp, 'webhook-retry.json');
  let calls = 0;
  const cfg = {
    webhookUrl: 'http://127.0.0.1:9/nope',
    webhookSecret: 'secret',
    webhookRetryFile: retryFile,
    webhookMaxAttempts: 3,
    webhookBaseBackoffMs: 10,
  };
  const pusher = createWebhookPusher(cfg);
  pusher.deliverOnce = async (envelope) => {
    calls += 1;
    if (calls < 2) throw new Error('simulated network fail');
    return { ok: true, mock: true, event: envelope.event };
  };
  pusher.start();
  const r = await pusher.push({
    event: 'equity_mark',
    ts: new Date().toISOString(),
    source: 'local-ibkr-bridge',
    payload: { cash_usd: 1 },
  });
  assert(r.queued === true || r.ok === false, 'first push queues on failure');
  // Force due now and drain
  const q = pusher.getQueue().map((item) => ({ ...item, nextAt: Date.now() - 1 }));
  pusher._setQueue(q);
  await pusher._drain();
  assert(calls >= 2, 'retry invoked deliverAgain');
  assert(pusher.getQueue().length === 0, 'queue cleared after success');
  pusher.stop();
  rmSync(tmp, { recursive: true, force: true });
}

async function main() {
  // Ensure port free
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(PORT, '127.0.0.1', () => probe.close(() => resolve()));
  }).catch(() => {});

  const bridge = await startBridge();
  try {
    const health = await jsonFetch('/health', { token: null });
    assert(health.status === 200 && health.json?.ok === true, '/health ok without auth');
    assert(health.json?.host === '127.0.0.1', '/health host loopback');
    assert(health.json?.mock === true, '/health mock flag');

    const unauth = await jsonFetch('/ping', { token: null });
    assert(unauth.status === 401, '/ping 401 without token');

    const bad = await jsonFetch('/ping', { token: 'wrong' });
    assert(bad.status === 401, '/ping 401 with wrong token');

    const ping = await jsonFetch('/ping');
    assert(ping.status === 200 && ping.json?.ok === true, '/ping mock ok');

    const snap = await jsonFetch('/account-snapshot', { method: 'POST', body: {} });
    assert(snap.status === 200 && snap.json?.ok === true, '/account-snapshot mock ok');
    assert(snap.json?.mock === true, '/account-snapshot mock flag');
    assert(Number(snap.json?.cash_usd) === 100000, '/account-snapshot cash');

    const place = await jsonFetch('/place-bracket', {
      method: 'POST',
      body: {
        trades: [
          {
            symbol: 'AAPL',
            side: 'BUY',
            qty: 1,
            entry_price: 100,
            tp_price: 110,
            stop_price: 95,
          },
        ],
      },
    });
    assert(place.status === 200 && place.json?.dry_run === true, 'place-bracket dry-run (trading off)');

    await testWebhookBackoff();
  } finally {
    await bridge.stop();
  }

  if (failed) {
    console.error('Offline test failed count=' + failed);
    process.exit(1);
  }
  console.log('All offline bridge tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
