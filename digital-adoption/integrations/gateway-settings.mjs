// Reads current Admin policy and model registry from the read-only platform DB.
export function resolveGatewaySettings(database, config) {
  const active = database.prepare("SELECT value FROM platform_settings WHERE key='llm_active_endpoint'").get()?.value === 'secondary' ? 'secondary' : 'primary';
  const endpoint = config[active];
  if (!endpoint?.baseUrl || !endpoint?.model || !endpoint?.apiKey) throw new Error('Active endpoint is not configured');
  const raw = database.prepare("SELECT value FROM platform_settings WHERE key='digital_adoption_maker_checker'").get()?.value;
  const quality = raw == null ? { enabled: false, checkerMode: 'platform_inactive' } : JSON.parse(raw);
  if (!quality || typeof quality.enabled !== 'boolean' || !['platform_inactive', 'ollama_reasoning','ollama_local'].includes(quality.checkerMode)) throw new Error('Invalid copilot review configuration');
  if(quality.checkerMode==='ollama_local'&&(typeof quality.checkerDeploymentId!=='string'||!/^[a-zA-Z0-9_.-]{1,100}$/.test(quality.checkerDeploymentId)||typeof quality.localThinking!=='boolean'))throw new Error('Invalid local checker selection');
  if(quality.checkerMaxTokens!==undefined&&(!Number.isInteger(quality.checkerMaxTokens)||quality.checkerMaxTokens<128||quality.checkerMaxTokens>2048))throw new Error('Invalid checker output budget');
  let checker;
  if (quality.enabled && ['ollama_reasoning','ollama_local'].includes(quality.checkerMode)) {
    const row = database.prepare('SELECT * FROM model_deployments WHERE id=? AND enabled=1').get(quality.checkerMode==='ollama_local'?quality.checkerDeploymentId:'ollama-reasoning');
    if (row) {
      const url = new URL(row.base_url);
      if (!['http:', 'https:'].includes(url.protocol) || !['ollama', 'localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || /cloud/i.test(row.model)) throw new Error('Checker must use private Ollama');
      checker = { baseUrl: row.base_url, model: row.model, apiKey: config.ollamaReasoning?.apiKey || 'ollama', threads: config.ollamaReasoning?.threads, nativeOllama: true,thinking:quality.checkerMode==='ollama_reasoning'||quality.localThinking===true, slot:quality.checkerMode };
    }
  } else if (quality.enabled) {
    const slot = active === 'primary' ? 'secondary' : 'primary';
    if (config[slot]) checker = { ...config[slot], slot };
  }
  if(checker)checker.maxTokens=quality.checkerMaxTokens??700;
  return { active, ...endpoint, quality, checker };
}
