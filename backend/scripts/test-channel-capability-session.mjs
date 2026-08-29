import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const root = join(tmpdir(), `agent-os-capability-${randomBytes(8).toString('hex')}`);
process.env.OPENCLAW_DIR = root;
const runtime = 't-owner--balserve';
const dir = join(root, 'agents', runtime, 'sessions');
mkdirSync(dir, { recursive: true });
const mainId = 'main-session';
writeFileSync(join(dir, 'sessions.json'), JSON.stringify({
  [`agent:${runtime}:main`]: { sessionId: mainId },
  [`agent:${runtime}:goal:123`]: { sessionId: 'goal-session' },
}));
writeFileSync(join(dir, `${mainId}.jsonl`), '{"type":"message"}\n');

const { invalidateOpenClawMainSession } = await import('../src/services/openclaw-capability-session.js');
const result = invalidateOpenClawMainSession(runtime, { now: new Date('2026-08-29T12:00:00.000Z') });
assert.equal(result.invalidated, true);
assert.equal(existsSync(join(dir, `${mainId}.jsonl`)), false);
assert.equal(existsSync(`${join(dir, `${mainId}.jsonl`)}.reset.2026-08-29T12-00-00-000Z`), true);
const index = JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8'));
assert.equal(index[`agent:${runtime}:main`], undefined);
assert.equal(index[`agent:${runtime}:goal:123`].sessionId, 'goal-session');
assert.equal(invalidateOpenClawMainSession(runtime).reason, 'main_session_missing');

console.log('channel capability session refresh: ok');
