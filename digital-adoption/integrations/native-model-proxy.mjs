/** Native Ollama callers keep their contract while inference traverses LiteLLM. */
export async function fetchOllamaViaGateway(url,init,{settings={baseUrl:String(process.env.LITELLM_BASE_URL||'').replace(/\/+$/,''),apiKey:process.env.LITELLM_MASTER_KEY},fetchImpl=globalThis.fetch}={}){
  const target=new URL(url);
  if(target.pathname!=='/api/chat'||!['ollama','localhost','127.0.0.1','[::1]'].includes(target.hostname))throw new Error('Native Ollama destination is not configured');
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
