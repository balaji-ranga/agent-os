// Reads current Admin policy and model registry from the read-only platform DB.
export function resolveGatewaySettings(database, config) {
  const active = database.prepare("SELECT value FROM platform_settings WHERE key='llm_active_endpoint'").get()?.value === 'secondary' ? 'secondary' : 'primary';
  const endpoint = config[active];
  if (!endpoint?.baseUrl || !endpoint?.model || !endpoint?.apiKey) throw new Error('Active endpoint is not configured');
  const raw = database.prepare("SELECT value FROM platform_settings WHERE key='digital_adoption_maker_checker'").get()?.value;
  const quality = raw == null ? { enabled: false, checkerMode: 'platform_inactive' } : JSON.parse(raw);
  if (!quality || typeof quality.enabled !== 'boolean' || !['platform_inactive', 'ollama_reasoning'].includes(quality.checkerMode)) throw new Error('Invalid copilot review configuration');
  let checker;
  if (quality.enabled && quality.checkerMode === 'ollama_reasoning') {
    const row = database.prepare("SELECT * FROM model_deployments WHERE id='ollama-reasoning' AND enabled=1").get();
    if (row) {
      const url = new URL(row.base_url);
      if (!['http:', 'https:'].includes(url.protocol) || !['ollama', 'localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || /cloud/i.test(row.model)) throw new Error('Checker must use private Ollama');
      checker = { baseUrl: row.base_url, model: row.model, apiKey: config.ollamaReasoning?.apiKey || 'ollama', threads: config.ollamaReasoning?.threads, nativeOllama: true, slot: 'ollama_reasoning' };
    }
  } else if (quality.enabled) {
    const slot = active === 'primary' ? 'secondary' : 'primary';
    if (config[slot]) checker = { ...config[slot], slot };
  }
  return { active, ...endpoint, quality, checker };
}
