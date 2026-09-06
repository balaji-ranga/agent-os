// Focused filesystem test: identical runtime reconciliation must not touch
// openclaw.json, while a real configuration change must still be persisted.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixtureDir = mkdtempSync(join(tmpdir(), 'flolah-openclaw-config-noop-'));
process.env.OPENCLAW_DIR = fixtureDir;
process.env.OPENCLAW_CONFIG_PATH = join(fixtureDir, 'openclaw.json');

const { writeOpenClawConfigSafe, withOpenClawConfigBatch } = await import('../src/services/openclaw-config-safe.js');

try {
  const initial = {
    gateway: { mode: 'local', port: 18789 },
    agents: {
      defaults: { model: { primary: 'test/model' } },
      ownership: 'explicit',
      entries: { helper: { workspace: '/fixture/helper', tools: { allow: [] } } },
    },
    tools: {}, plugins: {}, browser: {},
  };
  const normalized = writeOpenClawConfigSafe(initial);
  const old = new Date('2020-01-01T00:00:00.000Z');
  utimesSync(process.env.OPENCLAW_CONFIG_PATH, old, old);
  const before = statSync(process.env.OPENCLAW_CONFIG_PATH).mtimeMs;

  writeOpenClawConfigSafe(normalized);
  assert.equal(statSync(process.env.OPENCLAW_CONFIG_PATH).mtimeMs, before, 'identical config must be a no-op');

  writeOpenClawConfigSafe({ ...normalized, gateway: { ...normalized.gateway, port: 18790 } });
  assert.equal(JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8')).gateway.port, 18790);
  assert.notEqual(statSync(process.env.OPENCLAW_CONFIG_PATH).mtimeMs, before, 'real change must be persisted');

  const batchBaseline = statSync(process.env.OPENCLAW_CONFIG_PATH).mtimeMs;
  withOpenClawConfigBatch(() => {
    const first = writeOpenClawConfigSafe({ ...normalized, gateway: { ...normalized.gateway, port: 18791 } });
    writeOpenClawConfigSafe({ ...first, gateway: { ...first.gateway, port: 18792 } });
    assert.equal(statSync(process.env.OPENCLAW_CONFIG_PATH).mtimeMs, batchBaseline, 'batch must not write incrementally');
  });
  assert.equal(JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8')).gateway.port, 18792);
  assert.notEqual(statSync(process.env.OPENCLAW_CONFIG_PATH).mtimeMs, batchBaseline, 'batch must persist its final state once');
  console.log('OPENCLAW_CONFIG_NOOP_OK');
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}
