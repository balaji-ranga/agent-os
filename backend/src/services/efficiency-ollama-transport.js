/** Private, text-only utility transport. Native Ollama options bound CPU threads per request. */
export async function fetchEfficiencyOllama(chatUrl, init, localOptions = {}) {
  const url = new URL(chatUrl);
  if (!['ollama', 'localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Efficiency transport requires private Ollama');
  }
  const body = JSON.parse(init.body);
  const threads = Number(localOptions.threads ?? process.env.OLLAMA_EFFICIENCY_THREADS ?? 2);
  if (!Number.isInteger(threads) || threads < 1 || threads > 16) throw new Error('Invalid efficiency CPU thread limit');
  const context=localOptions.context;
  if(context!==undefined&&(!Number.isInteger(context)||context<512||context>131072))throw new Error('Invalid local checker context limit');
  if (!Array.isArray(body.messages) || body.messages.some(m => !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) {
    throw new Error('Efficiency inference accepts text messages only');
  }
  const native = { model: body.model, stream: false, truncate: false,
    messages: body.messages.map(({ role, content }) => ({ role, content })),
    options: { num_thread: threads, num_predict: body.max_tokens, ...(context!==undefined?{num_ctx:context}:{}), ...(body.temperature !== undefined ? { temperature: body.temperature } : {}) },
    ...(body.response_format?.type === 'json_object' ? { format: 'json' } : {}),
    ...(localOptions.checker?{think:body.thinking?.type==='enabled'}:body.thinking?.type === 'disabled' ? { think: false } : {}) };
  const response = await fetch(new URL('/api/chat', url), { ...init, body: JSON.stringify(native) });
  if (!response.ok) return response;
  const result = await response.json();
  // Never substitute private reasoning for a missing final answer. Keep accounting
  // and validation in the existing completion path; unfinished output fails closed.
  return new Response(JSON.stringify({ model: result.model,
    choices: [{ message: { content: result.message?.content || '' }, finish_reason: result.done === true ? result.done_reason || 'stop' : 'length' }],
    usage: { prompt_tokens: result.prompt_eval_count || 0, completion_tokens: result.eval_count || 0 } }),
    { status: 200, headers: { 'content-type': 'application/json' } });
}

/** Explicit local secondary checks stay local, JSON-only, and bounded. */
export function fetchLocalCheckerOllama(chatUrl,init){
 return fetchEfficiencyOllama(chatUrl,init,{checker:true,
  threads:Number(process.env.OLLAMA_CHECKER_THREADS||process.env.OLLAMA_EFFICIENCY_THREADS||4),
  context:Number(process.env.OLLAMA_CHECKER_NUM_CTX||process.env.OLLAMA_NUM_CTX||32768)});
}
