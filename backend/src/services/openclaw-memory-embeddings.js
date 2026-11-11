/** Native memory and knowledge retrieval must use the same configured embedding
 * service. Chat credentials must never become an implicit embedding fallback. */
export function applyPlatformMemoryEmbeddings(config, embedding) {
  const search = { ...(config.memory?.search || {}) };
  const base = String(embedding.baseUrl || '').replace(/\/$/, '');
  const allowed = embedding.enabled && base && embedding.model &&
    !/api\.openai\.com|openai\.azure/i.test(base);
  search.provider = allowed ? 'openai-compatible' : 'none';
  search.fallback = 'none';
  if (allowed) {
    search.model = embedding.model;
    // Replace destination credentials, including stale inherited headers.
    search.remote = { baseUrl: base, apiKey: embedding.apiKey, batch: { enabled: false } };
  } else {
    delete search.model;
    delete search.remote;
  }
  config.memory = { ...(config.memory || {}), search };
  return config;
}
