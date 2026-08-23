/** Contract test: multi-node routing, owner isolation, node-addressed claims, pairing. */
import assert from 'node:assert/strict';

const { initDb, getDb } = await import('../src/db/schema.js');
const {
  touchBrowserWorkerNode,
  selectBrowserExecutor,
  enqueueBrowserWorkerJob,
  claimNextBrowserWorkerJob,
  completeBrowserWorkerJob,
  listBrowserExecutorNodes,
} = await import('../src/services/browser-worker-dispatch.js');
const {
  createBrowserWorkerToken,
  revokeBrowserWorkerToken,
  createBrowserExtensionPairingCode,
  consumeBrowserExtensionPairingCode,
} = await import('../src/services/browser-worker-auth.js');

initDb();
const db = getDb();
for (const id of ['browser-owner-a', 'browser-owner-b']) {
  db.prepare(
    `INSERT OR IGNORE INTO platform_users (id, email, name, password_hash, role, created_at)
     VALUES (?, ?, ?, 'test-only', 'ceo', datetime('now'))`
  ).run(id, `${id}@example.invalid`, id);
}

const desktopToken = createBrowserWorkerToken('browser-owner-a', { name: 'desktop-test' });
const extensionToken = createBrowserWorkerToken('browser-owner-a', { name: 'extension-test' });
touchBrowserWorkerNode('browser-owner-a', {
  nodeId: 'desktop-a', tokenId: desktopToken.id, driverMode: 'playwright_chrome',
  protocolVersion: 1, capabilities: { actions: ['open', 'snapshot', 'act'], structured_snapshot: true },
});
touchBrowserWorkerNode('browser-owner-a', {
  nodeId: 'extension-a', tokenId: extensionToken.id, driverMode: 'chrome_extension',
  protocolVersion: 1, capabilities: { actions: ['open', 'snapshot', 'act'], structured_snapshot: true },
});

assert.equal(listBrowserExecutorNodes('browser-owner-a').length, 2);
assert.equal(selectBrowserExecutor('browser-owner-a').id, 'extension-a', 'extension has routing priority');

const queued = enqueueBrowserWorkerJob('browser-owner-a', 'snapshot', { limit: 1000 });
assert.equal(queued.node.id, 'extension-a');
assert.equal(claimNextBrowserWorkerJob('browser-owner-a', 'desktop-a'), null, 'non-selected node cannot claim');
const claimed = claimNextBrowserWorkerJob('browser-owner-a', 'extension-a');
assert.equal(claimed.id, queued.id);
assert.equal(
  completeBrowserWorkerJob('browser-owner-b', 'extension-a', queued.id, { ok: true, result: {} }).ok,
  false,
  'another owner cannot complete the job'
);
assert.equal(
  completeBrowserWorkerJob('browser-owner-a', 'desktop-a', queued.id, { ok: true, result: {} }).ok,
  false,
  'another node cannot complete the job'
);
assert.equal(
  completeBrowserWorkerJob('browser-owner-a', 'extension-a', queued.id, {
    ok: true, result: { ok: true }, resultState: 'outcome_verified',
  }).ok,
  true
);

assert.equal(revokeBrowserWorkerToken(extensionToken.id, 'browser-owner-a'), true);
assert.equal(selectBrowserExecutor('browser-owner-a').id, 'desktop-a', 'revoked extension falls back before a new task');

const pairing = createBrowserExtensionPairingCode('browser-owner-a', { ttlMs: 60_000 });
const consumed = consumeBrowserExtensionPairingCode(pairing.code, { deviceName: 'test extension' });
assert.equal(consumed.ok, true);
assert.equal(consumed.owner_user_id, 'browser-owner-a');
assert.equal(consumeBrowserExtensionPairingCode(pairing.code).ok, false, 'pairing code is single-use');

console.log('browser executor multi-node contract: PASS');
