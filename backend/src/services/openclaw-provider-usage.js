/** LiteLLM supports usage-bearing streaming responses. Generic endpoint
 * detection in the native client does not necessarily recognize our proxy. */
export function applyManagedProxyUsage(config, proxyBaseUrl) {
  const normalize = value => String(value || '').trim().replace(/\/+$/, '');
  const base = normalize(proxyBaseUrl);
  if (!base) return config;
  for (const provider of Object.values(config.models?.providers || {})) {
    if (provider.api !== 'openai-completions' || normalize(provider.baseUrl) !== base) continue;
    for (const model of provider.models || []) {
      model.compat = { ...(model.compat || {}), supportsUsageInStreaming: true };
    }
  }
  return config;
}
