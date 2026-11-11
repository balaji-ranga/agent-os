/** Shared model transport. Workflow Brain is an explicit direct-provider exception.
 * No provider request is retried here; callers retain their bounded retry policy. */
export function modelEgressSettings(env = process.env) {
  return {
    baseUrl: String(env.LITELLM_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: String(env.LITELLM_MASTER_KEY || ''),
    localBases: [env.OLLAMA_BASE_URL, env.EMBEDDINGS_BASE_URL, env.OPENSEARCH_EMBEDDING_BASE_URL]
      .filter(Boolean),
  };
}

function origin(value) { return new URL(value).origin; }
export function isManagedModelEndpoint(baseUrl, settings) {
  const host = origin(baseUrl);
  return Boolean(settings.baseUrl && host === origin(settings.baseUrl));
}
export function isLocalModelEndpoint(baseUrl, settings) {
  const target=new URL(baseUrl),host=target.hostname;
  const parts=host.split('.').map(Number);
  const ipv4=/^\d+\.\d+\.\d+\.\d+$/.test(host)&&parts.every(n=>n>=0&&n<=255);
  const privateHost=host==='localhost'||host==='[::1]'||!host.includes('.')&&!host.includes(':')||
    ipv4&&(parts[0]===127||parts[0]===10||parts[0]===192&&parts[1]===168||parts[0]===172&&parts[1]>=16&&parts[1]<=31);
  return privateHost && settings.localBases.some(base => origin(base) === target.origin);
}

export function prepareModelEgress({ baseUrl, apiKey, model, api = 'openai-completions' }, settings = modelEgressSettings()) {
  if (isManagedModelEndpoint(baseUrl, settings)) return null;
  const local=isLocalModelEndpoint(baseUrl,settings);
  if (!settings.baseUrl || !settings.apiKey) throw new Error('Paid model gateway is not configured; direct provider submission is prohibited.');
  const upstream = new URL(baseUrl);
  if ((upstream.protocol !== 'https:' && !(local&&upstream.protocol==='http:')) || upstream.username || upstream.password || upstream.search || upstream.hash) {
    throw new Error('Paid model endpoint must be a credential-free HTTPS base URL.');
  }
  if (!apiKey || !model) throw new Error('Paid model credentials and model are required.');
  const prefix = api === 'anthropic-messages' ? 'anthropic' :
    ['openai-completions', 'openai-responses'].includes(api) ? 'openai' : null;
  if (!prefix) throw new Error('This model protocol has no verified gateway route; direct submission is prohibited.');
  return {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    userConfig: {
      model_list: [{model_name: model, litellm_params: {
        model: `${prefix}/${model}`, api_base: baseUrl.replace(/\/+$/, ''), api_key: apiKey,
      }}],
      num_retries: 0, max_fallbacks: 0, fallbacks: [],
    },
  };
}

/** JSON APIs only: preserve bodies, tool calls, usage, streaming and cancellation. */
export async function fetchModelViaGateway(url, init, {settings = modelEgressSettings(), fetchImpl = globalThis.fetch} = {}) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/\/(chat\/completions|responses|messages|embeddings|images\/generations|audio\/speech)$/);
  if (!match) throw new Error('Unsupported model endpoint; direct submission is prohibited.');
  const baseUrl = `${parsed.origin}${parsed.pathname.slice(0, -match[0].length)}`;
  const headers = new Headers(init.headers);
  const body = JSON.parse(init.body);
  const route = prepareModelEgress({baseUrl, model: body.model,
    apiKey: headers.get('x-api-key') || headers.get('authorization')?.replace(/^Bearer\s+/i, ''),
    api: match[1] === 'messages' ? 'anthropic-messages' : 'openai-completions'}, settings);
  if (!route) return fetchImpl(url, init);
  // Never accept a caller-supplied router that could change credential ownership.
  body.user_config = route.userConfig;
  if (body.thinking) body.extra_body={...body.extra_body,thinking:body.thinking};
  headers.delete('x-api-key');
  headers.set('authorization', `Bearer ${route.apiKey}`);
  return fetchImpl(`${route.baseUrl}/${match[1]}`, {...init, headers, body: JSON.stringify(body)});
}
/** Native Ollama callers keep their contract while inference traverses LiteLLM. */
export async function fetchOllamaViaGateway(url,init,{settings=modelEgressSettings(),fetchImpl=globalThis.fetch}={}){
  const target=new URL(url);
  if(target.pathname!=='/api/chat'||!isLocalModelEndpoint(target.origin,settings))throw new Error('Native Ollama destination is not configured');
  if(!settings.baseUrl||!settings.apiKey)throw new Error('Model gateway is required; direct inference is prohibited');
  const native=JSON.parse(init.body);
  if(native.stream)throw new Error('Native Ollama streaming requires the managed OpenAI-compatible route');
  const {num_predict,temperature,...options}=native.options||{};
  const body={model:native.model,messages:native.messages,stream:false,max_tokens:num_predict,temperature,
    ...options,...(native.format?{response_format:native.format==='json'?{type:'json_object'}:{type:'json_schema',json_schema:{name:'result',schema:native.format}}}:{}),
    ...(native.think!==undefined?{reasoning_effort:native.think?'medium':'none'}:{}),truncate:native.truncate!==true?false:true,
    user_config:{model_list:[{model_name:native.model,litellm_params:{model:`ollama_chat/${native.model}`,api_base:target.origin,api_key:'ollama-local'}}],num_retries:0,max_fallbacks:0,fallbacks:[]}};
  const response=await fetchImpl(new URL(`${settings.baseUrl}/chat/completions`),{...init,headers:{'Content-Type':'application/json',Authorization:`Bearer ${settings.apiKey}`},body:JSON.stringify(body)});
  if(!response.ok)return response;
  const result=await response.json(),choice=result.choices?.[0];
  return new Response(JSON.stringify({model:result.model,message:{content:choice?.message?.content,thinking:choice?.message?.reasoning_content},done:!!choice&&choice.finish_reason!=='length',done_reason:choice?.finish_reason,prompt_eval_count:result.usage?.prompt_tokens,eval_count:result.usage?.completion_tokens}),{status:200,headers:{'Content-Type':'application/json'}});
}
