import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('deploy/scripts/configure-openclaw-docker.js');

function runCase({ name, baseUrl, model, marker = null, routing = false }) {
  const dir = mkdtempSync(join(tmpdir(), `flolah-openclaw-runtime-${name}-`));
  const configPath = join(dir, 'openclaw.json');
  const originalAgent = {
    id: 't-test--coo',
    name: 'COO',
    workspace: join(dir, 'workspace-coo'),
    tools: { allow: ['notify_ceo'] },
  };
  writeFileSync(
    configPath,
    `${JSON.stringify({
      gateway: { mode: 'local' },
      agents: { defaults: { model: { primary: model } }, list: [originalAgent] },
      models: { providers: {} },
      plugins: { entries: { codex: { enabled: true } }, allow: ['codex'] },
      tools: { sessions: { visibility: 'agent' } },
    }, null, 2)}\n`,
    'utf8'
  );
  if (marker) {
    writeFileSync(join(dir, 'platform-llm-active.json'), `${JSON.stringify(marker)}\n`, 'utf8');
  }
  writeFileSync(join(dir, 'platform-runtime-secrets.json'), JSON.stringify({
    version: 1,
    secrets: { openclaw_gateway: { value: 'runtime-gateway-token' } },
  }), 'utf8');

  try {
    const result = spawnSync(process.execPath, [script], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENCLAW_DIR: dir,
        OPENCLAW_CONFIG_PATH: configPath,
        OPENAI_API_KEY: 'test-key-not-secret',
        OPENAI_BASE_URL: baseUrl,
        OPENCLAW_MODEL_PRIMARY: model,
        MODEL_ROUTING_ENABLED: routing ? '1' : '0',
        LITELLM_BASE_URL: 'http://litellm:4000/v1',
        LITELLM_MASTER_KEY: routing ? 'test-litellm-key-not-secret' : '',
        OPENCLAW_ENABLE_DEEPSEEK_PLUGIN: '0',
        OPENCLAW_TRUSTED_PROXIES: '127.0.0.1,::1,172.18.0.1',
        OPENCLAW_GATEWAY_TOKEN: 'stale-bootstrap-token',
      },
    });
    assert.equal(result.status, 0, `${name}: configure failed\n${result.stderr}\n${result.stdout}`);
    const configured = JSON.parse(readFileSync(configPath, 'utf8'));
    const expectedProvider = routing ? 'litellm-secondary' : 'openai';
    assert.equal(configured.models.providers[expectedProvider].agentRuntime?.id, 'openclaw');
    if (routing) {
      assert.equal(configured.agents.defaults.model.primary, marker.primary);
      assert.equal(configured.models.providers['litellm-secondary'].baseUrl, 'http://litellm:4000/v1');
      assert.equal(configured.models.providers['litellm-secondary'].models[0].id, 'flolah-platform-secondary');
      assert.equal(configured.models.providers['litellm-secondary'].api, 'openai-completions');
    }
    assert.equal(configured.plugins.entries.codex, undefined);
    assert.equal(configured.plugins.entries.deepseek?.enabled, false);
    assert.equal(configured.plugins.allow.includes('codex'), false);
    assert.deepEqual(configured.gateway.trustedProxies, ['127.0.0.1', '::1', '172.18.0.1']);
    assert.equal(configured.gateway.auth.token, 'runtime-gateway-token');
    assert.equal(configured.gateway.trustedProxies.includes('172.16.0.0/12'), false);
    assert.equal(configured.gateway.trustedProxies.includes('10.0.0.0/8'), false);
    assert.equal(configured.tools.fs.workspaceOnly, true);
    assert.ok(configured.agents.list.some((agent) => agent.id === originalAgent.id));
    const configuredAgent = configured.agents.list.find((agent) => agent.id === originalAgent.id);
    assert.equal(configuredAgent.workspace, originalAgent.workspace);
    for (const denied of ['write', 'edit', 'apply_patch', 'exec', 'process']) {
      assert.equal(configuredAgent.tools.allow.includes(denied), false);
      assert.equal(configuredAgent.tools.deny.includes(denied), true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

runCase({
  name: 'official-openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'openai/gpt-4o-mini',
});
runCase({
  name: 'litellm-secondary-marker',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'openai/deepseek-v4-flash',
  routing: true,
  marker: {
    active: 'secondary',
    primary: 'litellm-secondary/flolah-platform-secondary',
    fallbacks: [],
  },
});
runCase({
  name: 'deepseek-compatible',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'openai/deepseek-v4-flash',
});

console.log('OPENCLAW_RUNTIME_POLICY_OK');
