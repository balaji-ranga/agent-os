import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'flolah-model-routing-'));
process.env.AGENT_OS_DATA_DIR = dir;
process.env.MODEL_ROUTING_ENABLED = '1';
process.env.LITELLM_BASE_URL = 'http://litellm:4000/v1';
process.env.LITELLM_MASTER_KEY = 'test-only-not-production';
process.env.OPENAI_PRIMARY_BASE_URL = 'https://api.openai.com/v1';
process.env.OPENAI_PRIMARY_MODEL = 'gpt-4o-mini';
process.env.OPENAI_PRIMARY_API_KEY = 'test-openai-key';
process.env.OPENAI_SECONDARY_BASE_URL = 'https://api.deepseek.com/v1';
process.env.OPENAI_SECONDARY_MODEL = 'deepseek-chat';
process.env.OPENAI_SECONDARY_API_KEY = 'test-deepseek-key';
process.env.OPENCLAW_DIR = dir;
process.env.OPENCLAW_CONFIG_PATH = join(dir, 'openclaw.json');
writeFileSync(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify({
  gateway: { mode: 'local', port: 18789, http: { endpoints: { chatCompletions: { enabled: true } } } },
  agents: { defaults: { model: {} }, list: [] },
  models: { providers: {} },
}), 'utf8');

try {
  const registry = await import('../src/services/model-routing-registry.js');
  const snapshot = registry.getModelRoutingSnapshot();
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.gateway.configured, true);
  assert(snapshot.routes.some((route) => route.alias === 'flolah-platform-primary'));
  assert(snapshot.deployments.some((deployment) => deployment.provider_type === 'vllm' && !deployment.enabled));
  assert(!JSON.stringify(snapshot).includes('test-openai-key'));
  assert(!JSON.stringify(snapshot).includes('test-deepseek-key'));
  assert(!JSON.stringify(snapshot).includes('test-only-not-production'));

  const { getDb } = await import('../src/db/schema.js');
  const insertEvent = getDb().prepare(`INSERT INTO model_route_events
    (id,route_alias,outcome,model_used,source,created_at) VALUES (?,?,?,?,?,?)`);
  for (let i = 1; i <= 31; i += 1) {
    insertEvent.run(`event-${String(i).padStart(2, '0')}`, 'flolah-platform-primary', 'ok', 'test-model', 'pagination-test', `2026-01-01 00:${String(i).padStart(2, '0')}:00`);
  }
  const firstEvents = registry.getModelRoutingSnapshot({ eventPage: 1, eventPageSize: 10 });
  const secondEvents = registry.getModelRoutingSnapshot({ eventPage: 2, eventPageSize: 10 });
  assert.equal(firstEvents.events.length, 10);
  assert.equal(firstEvents.event_pagination.total_items, 31);
  assert.equal(firstEvents.event_pagination.total_pages, 4);
  assert.equal(firstEvents.event_pagination.has_previous, false);
  assert.equal(firstEvents.event_pagination.has_next, true);
  assert.notEqual(firstEvents.events[0].id, secondEvents.events[0].id);

  const direct = { primary: { baseUrl: 'https://api.openai.com/v1', apiKey: 'x', model: 'gpt-4o-mini' }, using_byok: false };
  const routed = registry.maybeRouteThroughModelGateway({
    cfg: direct,
    effectiveModel: 'gpt-4o-mini',
    routeAlias: 'flolah-platform-primary',
  });
  assert.equal(routed.cfg.primary.baseUrl, 'http://litellm:4000/v1');
  assert.equal(routed.effectiveModel, 'flolah-platform-primary');

  const byok = registry.maybeRouteThroughModelGateway({
    cfg: { ...direct, using_byok: true },
    effectiveModel: 'gpt-4o-mini',
    routeAlias: 'flolah-platform-primary',
  });
  assert.equal(byok.cfg.primary.baseUrl, 'https://api.openai.com/v1');
  assert.equal(byok.routeAlias, null);

  const { setPlatformSetting } = await import('../src/services/platform-llm-settings.js');
  const { resolveChatCompletionsConfig } = await import('../src/config/llm.js');
  setPlatformSetting('llm_active_endpoint', 'secondary');
  const activeSecondary = await resolveChatCompletionsConfig({ toolName: 'goal_plan_maker' });
  const inactivePrimary = await resolveChatCompletionsConfig({ toolName: 'goal_plan_checker', endpointPreference: 'secondary' });
  assert.equal(activeSecondary.routeAlias, 'flolah-platform-secondary', 'active Admin slot must drive the maker');
  assert.equal(inactivePrimary.routeAlias, 'flolah-platform-primary', 'inactive Admin slot must drive the checker');
  setPlatformSetting('llm_active_endpoint', 'primary');

  const { syncPlatformEndpointToOpenClaw } = await import('../src/services/platform-llm-settings.js');
  const openclawSync = syncPlatformEndpointToOpenClaw();
  assert.equal(openclawSync.routing_enabled, true);
  assert.match(openclawSync.primary, /^litellm\//);
  const openclawConfig = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
  assert(openclawConfig.models.providers.litellm);
  assert.equal(openclawConfig.models.providers.litellm.baseUrl, 'http://litellm:4000/v1');

  const changed = registry.saveModelRoute('flolah-platform-primary', {
    capability: 'chat', primary_deployment_id: 'ollama-efficiency',
    fallback_deployment_id: 'platform-primary', enabled: true,
  });
  assert.equal(changed.primary_deployment_id, 'ollama-efficiency');
  const rerouted = registry.maybeRouteThroughModelGateway({
    cfg: direct, effectiveModel: 'gpt-4o-mini', routeAlias: 'flolah-platform-primary',
  });
  assert.equal(rerouted.effectiveModel, 'flolah-efficiency');

  assert.throws(
    () => registry.saveModelDeployment('bad-secret', {
      name: 'Bad', provider_type: 'openai', base_url: 'https://example.com/v1',
      model: 'x', secret_ref: 'sk-raw-secret', enabled: true,
    }),
    /Secret reference/
  );

  const compose = readFileSync(resolve('../deploy/docker-compose.yml'), 'utf8');
  const liteConfig = readFileSync(resolve('../deploy/litellm/config.yaml'), 'utf8');
  assert.match(compose, /litellm:[\s\S]*expose:[\s\S]*"4000"/);
  assert.doesNotMatch(compose, /litellm:[\s\S]{0,1200}ports:/);
  assert.match(compose, /profiles: \["optional-vllm"\]/);
  assert.match(liteConfig, /flolah-platform-primary/);
  assert.match(liteConfig, /flolah-efficiency/);
  assert.doesNotMatch(liteConfig, /sk-[A-Za-z0-9]{8,}/);

  console.log('MODEL_ROUTING_REGISTRY_OK');
} finally {
  try {
    const { getDb } = await import('../src/db/schema.js');
    getDb().close();
  } catch {
    // Best-effort cleanup for the disposable test database.
  }
  rmSync(dir, { recursive: true, force: true });
}
