import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionAuthority } from '../src/session-authority.mjs';

function fixture() {
  let now = 1_000_000;
  const authority = new SessionAuthority({ clock: () => now });
  const origin = 'https://example.test';
  const installation = authority.registerApproved({ embeddingId: 'sample', origins: [origin], expiresAt: now + 3_600_000 });
  const init = () => authority.initialize({ ...installation, origin });
  return { authority, origin, installation, init, advance: ms => { now += ms; } };
}

test('fresh initialization isolates history, reply references and returned objects', () => {
  const f = fixture(), a = { ...f.init(), origin: f.origin }, b = { ...f.init(), origin: f.origin };
  assert.notEqual(a.sessionId, b.sessionId);
  assert.notEqual(a.sessionToken, b.sessionToken);
  const message = f.authority.appendMessage({ ...a, text: 'private session canary' });
  assert.deepEqual(f.authority.history(b), []);
  assert.throws(() => f.authority.appendMessage({ ...b, text: 'reply', replyTo: message.id }), /denied/);
  const copy = f.authority.history(a); copy[0].text = 'mutated';
  assert.equal(f.authority.history(a)[0].text, 'private session canary');
});

test('renewal preserves session, rotates credential, and invalidates old credential', () => {
  const f = fixture(), a = { ...f.init(), origin: f.origin };
  f.authority.appendMessage({ ...a, text: 'hello' });
  const renewed = f.authority.renew(a);
  assert.equal(renewed.sessionId, a.sessionId);
  assert.throws(() => f.authority.history(a), /denied/);
  assert.equal(f.authority.history({ ...renewed, origin: f.origin }).length, 1);
});

test('revocation rejects active history, renewal and new initialization', () => {
  const f = fixture(), a = { ...f.init(), origin: f.origin };
  f.authority.revokeInstallation(f.installation.installationId);
  assert.throws(() => f.authority.history(a), /denied/);
  assert.throws(() => f.authority.renew(a), /denied/);
  assert.throws(f.init, /denied/);
});

test('expiry, wrong origins and private deployment fail closed', () => {
  const f = fixture(), a = { ...f.init(), origin: f.origin };
  for (const origin of ['https://example.test.attacker.test', 'http://example.test', 'https://example.test:444', 'null']) {
    assert.throws(() => f.authority.history({ ...a, origin }), /denied/);
    assert.throws(() => f.authority.initialize({ ...f.installation, origin }), /denied/);
  }
  assert.throws(() => f.authority.registerApproved({ embeddingId: 'private', origins: [f.origin], expiresAt: 9_000_000, visibility: 'private' }), /denied/);
  f.advance(300_000);
  assert.throws(() => f.authority.history(a), /denied/);
  assert.throws(() => f.authority.renew(a), /denied/);
});

test('termination rejects all further session access without affecting another instance', () => {
  const f = fixture(), a = { ...f.init(), origin: f.origin }, b = { ...f.init(), origin: f.origin };
  f.authority.terminate(a);
  assert.throws(() => f.authority.history(a), /denied/);
  assert.deepEqual(f.authority.history(b), []);
});
