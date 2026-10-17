import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SessionAuthority } from '../src/session-authority.mjs';
import { createAdoptionServer } from '../src/server.mjs';

test('HTTP boundary ignores caller scope and denies revoked/foreign origins', async () => {
  const authority = new SessionAuthority();
  const origin = 'https://customer.test';
  const installation = authority.registerApproved({ embeddingId: 'one', origins: [origin], expiresAt: Date.now() + 600_000 });
  const server = createAdoptionServer({ authority }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(path, body = {}, token, requestOrigin = origin) {
    return fetch(base + path, { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  }
  try {
    const a = await (await post('/v1/sessions', installation)).json();
    const b = await (await post('/v1/sessions', installation)).json();
    assert.notEqual(a.sessionId, b.sessionId);
    assert.equal((await post('/v1/messages', { text: 'only A', sessionId: b.sessionId, embeddingId: 'other' }, a.sessionToken)).status, 200);
    assert.deepEqual((await (await post('/v1/history', {}, b.sessionToken)).json()).messages, []);
    assert.equal((await post('/v1/history', {}, a.sessionToken, 'https://attacker.test')).status, 403);
    assert.equal((await post('/v1/messages', { text: 'x'.repeat(40_000) }, a.sessionToken)).status, 413);
    authority.revokeInstallation(installation.installationId);
    assert.equal((await post('/v1/history', {}, a.sessionToken)).status, 403);
    assert.equal((await post('/v1/sessions', installation)).status, 403);
    const asset = await fetch(base + '/widget.html');
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal((await fetch(base + '/fixture')).status, 403);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
