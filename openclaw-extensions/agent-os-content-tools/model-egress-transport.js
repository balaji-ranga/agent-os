import {prepareModelEgress,modelEgressSettings} from '../../scripts/lib/model-egress.js';

/** Applied outside tenant budget admission: system agents must use the proxy too. */
export function wrapFlolahModelEgress(streamFn, {settings = modelEgressSettings()} = {}) {
  return (model, context, options = {}) => {
    const route = prepareModelEgress({baseUrl:model.baseUrl,apiKey:options.apiKey || model.apiKey,model:model.id,api:model.api},settings);
    if (!route) return streamFn(model,context,options);
    const original=options.onPayload;
    const cleanHeaders=headers=>Object.fromEntries(Object.entries(headers||{}).filter(([key])=>!['authorization','x-api-key'].includes(key.toLowerCase())));
    const proxyBase=model.api==='anthropic-messages'?route.baseUrl.replace(/\/v1$/,''):route.baseUrl;
    return streamFn({...model,baseUrl:proxyBase,headers:cleanHeaders(model.headers)},context,{
      ...options,apiKey:route.apiKey,transport:'sse',
      headers:cleanHeaders(options.headers),
      onPayload:async(payload,payloadModel)=>{
        const modified=await original?.(payload,payloadModel);
        const result=modified ?? payload;
        result.user_config=route.userConfig;
        if(result.thinking)result.extra_body={...result.extra_body,thinking:result.thinking};
        return result;
      },
    });
  };
}
