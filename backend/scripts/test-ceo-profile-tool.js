/**
 * Unit tests for ceo_profile tool.
 * Usage: node scripts/test-ceo-profile-tool.js
 */
import assert from 'assert';
import { initDb, getDb } from '../src/db/schema.js';
import { executeCeoProfile, PROFILE_FIELDS } from '../src/services/ceo-profile.js';
import { seedCeoProfileToolIfMissing } from '../src/db/seed-content-tools-meta.js';
import { grantCeoProfileToAllAgents } from '../src/services/agent-feedback.js';

initDb();
seedCeoProfileToolIfMissing();

{
  const bad = executeCeoProfile({}, {});
  assert.strictEqual(bad.ok, false);
  console.log('PASS missing owner');
}

{
  const db = getDb();
  const ceo =
    db.prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1 LIMIT 1`).get() ||
    db.prepare(`SELECT id FROM platform_users WHERE id = 'ceo-bala'`).get();
  assert.ok(ceo?.id, 'need a CEO row for test');
  const out = executeCeoProfile({}, { ownerUserId: ceo.id });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.owner_user_id, ceo.id);
  assert.ok(out.profile);
  assert.ok(PROFILE_FIELDS.includes('email'));
  assert.ok('email' in out.profile);
  assert.ok('name' in out.profile);
  assert.ok(!('password_hash' in out.profile));
  assert.ok(!('llm_api_key' in out.profile));
  console.log('PASS ceo_profile returns safe fields', {
    id: out.profile.id,
    email: out.profile.email,
    name: out.profile.name,
  });

  const subset = executeCeoProfile({ fields: ['email', 'name'] }, { ownerUserId: ceo.id });
  assert.strictEqual(subset.ok, true);
  assert.deepStrictEqual(Object.keys(subset.profile).sort(), ['email', 'name']);
  console.log('PASS fields filter');
}

{
  const meta = getDb().prepare(`SELECT name, endpoint FROM content_tools_meta WHERE name = 'ceo_profile'`).get();
  assert.ok(meta, 'ceo_profile seeded in content_tools_meta');
  assert.ok(/ceo-profile/.test(meta.endpoint));
  const n = grantCeoProfileToAllAgents();
  console.log('PASS seed + grant', { meta: meta.name, newlyGranted: n });
}

console.log('CEO_PROFILE_TOOL_OK');