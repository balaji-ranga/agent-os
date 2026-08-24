/** Contract test: multi-node routing, owner isolation, node-addressed claims, pairing. */
import assert from 'node:assert/strict';

const { initDb, getDb } = await import('../src/db/schema.js');
const {
  touchBrowserWorkerNode,
  selectBrowserExecutor,
  enqueueBrowserWorkerJob,
  claimNextBrowserWorkerJob,
  completeBrowserWorkerJob,
  getBrowserWorkerJob,
  listBrowserExecutorNodes,
} = await import('../src/services/browser-worker-dispatch.js');
const { getMediaArtifact, deleteMediaArtifact } = await import('../src/services/ceo-media-artifacts.js');
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
  deviceName: 'Chrome test', workerVersion: '1.1.0', browserVersion: 'Chrome/151',
  protocolVersion: 2,
  capabilities: {
    actions: ['open', 'snapshot', 'screenshot', 'act'],
    structured_snapshot: true,
    screenshots: true,
    resumable_tasks: true,
  },
});

// A jobs long-poll refreshes only liveness/version fields. It must not erase
// the capabilities and identity supplied by the preceding registration.
touchBrowserWorkerNode('browser-owner-a', {
  nodeId: 'extension-a', tokenId: extensionToken.id,
  workerVersion: '1.1.0', driverMode: 'chrome_extension', protocolVersion: 2,
});
const extensionAfterPoll = listBrowserExecutorNodes('browser-owner-a')
  .find((node) => node.id === 'extension-a');
assert.equal(extensionAfterPoll.device_name, 'Chrome test');
assert.equal(extensionAfterPoll.browser_version, 'Chrome/151');
assert.equal(extensionAfterPoll.capabilities.screenshots, true, 'poll preserves screenshot capability');
assert.equal(extensionAfterPoll.capabilities.resumable_tasks, true, 'poll preserves resume capability');

assert.equal(listBrowserExecutorNodes('browser-owner-a').length, 2);
assert.equal(selectBrowserExecutor('browser-owner-a').id, 'extension-a', 'extension has routing priority');
assert.equal(
  selectBrowserExecutor('browser-owner-a', { requiredCapabilities: ['screenshot'] }).id,
  'extension-a',
  'screenshot requirement still routes to extension after poll refresh'
);

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

const screenshotJob = enqueueBrowserWorkerJob('browser-owner-a', 'screenshot', { task_id: 'bt-shot-test' });
assert.equal(claimNextBrowserWorkerJob('browser-owner-a', 'desktop-a').id, screenshotJob.id);
const onePixelPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n+0AAAAASUVORK5CYII=';
assert.equal(
  completeBrowserWorkerJob('browser-owner-a', 'desktop-a', screenshotJob.id, {
    ok: true,
    result: {
      ok: true,
      mime_type: 'image/png',
      filename: 'browser-test.png',
      screenshot_base64: onePixelPng,
      url: 'https://example.com/',
    },
    resultState: 'outcome_verified',
  }).ok,
  true
);
const storedScreenshotJob = getBrowserWorkerJob('browser-owner-a', screenshotJob.id);
assert.ok(storedScreenshotJob.result.artifact?.artifactId, 'screenshot becomes an owner-scoped artifact');
assert.equal(storedScreenshotJob.result.screenshot_base64, undefined, 'base64 is not retained in the job row');
assert.ok(
  getMediaArtifact('browser-owner-a', storedScreenshotJob.result.artifact.artifactId),
  'artifact belongs to the job owner'
);
assert.equal(
  getMediaArtifact('browser-owner-b', storedScreenshotJob.result.artifact.artifactId),
  null,
  'another owner cannot read the screenshot artifact'
);
deleteMediaArtifact('browser-owner-a', storedScreenshotJob.result.artifact.artifactId);

const pairing = createBrowserExtensionPairingCode('browser-owner-a', { ttlMs: 60_000 });
const consumed = consumeBrowserExtensionPairingCode(pairing.code, { deviceName: 'test extension' });
assert.equal(consumed.ok, true);
assert.equal(consumed.owner_user_id, 'browser-owner-a');
assert.equal(consumeBrowserExtensionPairingCode(pairing.code).ok, false, 'pairing code is single-use');

console.log('browser executor multi-node contract: PASS');
