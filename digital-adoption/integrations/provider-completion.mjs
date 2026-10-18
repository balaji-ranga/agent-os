export async function completeProvider({ config: ep, messages, maxTokens, signal }, fetchImpl = fetch) {
  const base = new URL(ep.baseUrl.replace(/\/$/, '') + '/');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['litellm', 'ollama', 'localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw new Error('Invalid provider transport');
  const url = ep.nativeOllama ? new URL('/api/chat', base) : new URL('chat/completions', base);
  const body = ep.nativeOllama ? { model: ep.model, messages, stream: false, format: 'json', think: true, truncate: false,
    options: { num_predict: Math.max(2048, maxTokens), num_thread: Math.max(1, Math.min(8, Number(ep.threads) || 2)), temperature: 0 } }
    : { model: ep.model, messages, max_tokens: maxTokens, temperature: 0, response_format: { type: 'json_object' } };
  if (Buffer.byteLength(JSON.stringify(body)) > 98_304) throw new Error('Model context too large');
  const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal, headers: { Authorization: `Bearer ${ep.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('Provider rejected request');
  const data = await response.json(), content = ep.nativeOllama ? data.message?.content : data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length > 32_000 || ep.nativeOllama && (data.done !== true || data.done_reason === 'length')) throw new Error('Invalid or incomplete provider response');
  return { content }; // Reasoning traces, provider payloads and credentials never leave this adapter.
}

export function createProviderCompletion({ localConcurrency = 1, fetchImpl = fetch } = {}) {
  if (!Number.isInteger(localConcurrency) || localConcurrency < 1 || localConcurrency > 16) throw new Error('Invalid local checker concurrency');
  let localActive = 0;
  return async request => {
    const local = request.config.nativeOllama === true;
    if (local && localActive >= localConcurrency) throw new Error('Local checker capacity reached');
    if (local) localActive++;
    try { return await completeProvider(request, fetchImpl); } finally { if (local) localActive--; }
  };
}
