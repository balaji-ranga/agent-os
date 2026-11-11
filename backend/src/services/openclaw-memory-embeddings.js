/** Native memory and knowledge retrieval must use the same configured embedding
 * service. Chat credentials must never become an implicit embedding fallback. */
export function applyPlatformMemoryEmbeddings(config, embedding, gateway={baseUrl:process.env.LITELLM_BASE_URL,apiKey:process.env.LITELLM_MASTER_KEY,model:process.env.LITELLM_EMBEDDING_ALIAS||'flolah-local-embedding'}) {
  const search = { ...(config.memory?.search || {}) };
  const base = String(embedding.baseUrl || '').replace(/\/$/, '');
  const allowed = gateway.baseUrl && gateway.apiKey && gateway.model && embedding.enabled && base && embedding.model &&
    !/api\.openai\.com|openai\.azure/i.test(base);
  search.provider = allowed ? 'openai-compatible' : 'none';
  search.fallback = 'none';
  if (allowed) {
    search.model = gateway.model;
    // Replace destination credentials, including stale inherited headers.
    search.remote = { baseUrl: String(gateway.baseUrl).replace(/\/$/,''), apiKey: gateway.apiKey, batch: { enabled: false } };
  } else {
    delete search.model;
    delete search.remote;
  }
  config.memory = { ...(config.memory || {}), search };
  return config;
}
