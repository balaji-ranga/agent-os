import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRepository } from '../src/repository.mjs';
import { SessionAuthority } from '../src/session-authority.mjs';

test('restart preserves session ownership and revocation in the independent database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'adoption-test-'));
  let repository;
  try {
    const path = join(directory, 'adoption.sqlite');
    repository = openRepository(path);
    let authority = new SessionAuthority({ repository });
    const origin = 'https://example.test';
    const installation = authority.registerApproved({ embeddingId: 'A', origins: [origin], expiresAt: Date.now() + 600_000 });
    const session = { ...authority.initialize({ ...installation, origin }), origin };
    authority.appendMessage({ ...session, text: 'persisted' });
    repository.close(); repository = openRepository(path); authority = new SessionAuthority({ repository });
    assert.equal(authority.history(session)[0].text, 'persisted');
    assert.deepEqual(authority.history({ ...authority.initialize({ ...installation, origin }), origin }), []);
    authority.revokeInstallation(installation.installationId);
    repository.close(); repository = openRepository(path); authority = new SessionAuthority({ repository });
    assert.throws(() => authority.history(session), /denied/);
    assert.throws(() => authority.initialize({ ...installation, origin }), /denied/);
  } finally { repository?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('production refuses HTTP; explicit development mode permits loopback only', () => {
  const registration = { embeddingId: 'local', origins: ['http://127.0.0.1:4193'], expiresAt: Date.now() + 600_000 };
  assert.throws(() => new SessionAuthority().registerApproved(registration));
  const authority = new SessionAuthority({ development: true });
  assert.ok(authority.registerApproved(registration).installationId);
  assert.throws(() => authority.registerApproved({ ...registration, origins: ['http://example.com'] }));
});
