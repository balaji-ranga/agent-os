// Only trusted runtime hook/context metadata enters this cache, never tool args.
const channels=new Map();
export function rememberRuntimeChannel(ctx,now=Date.now()){
 const key=ctx?.sessionKey,channel=ctx?.messageChannel||ctx?.channelId||ctx?.channel||ctx?.messageProvider;
 if(!key||(!channel&&!ctx?.runId))return;
 for(const [k,v]of channels)if(v.until<=now)channels.delete(k);
 if(channels.size>=5000)channels.delete(channels.keys().next().value);
 const prior=channels.get(key),sameRun=!ctx?.runId||ctx.runId===prior?.runId;
 channels.set(key,{channel:channel||prior?.channel,runId:ctx?.runId||prior?.runId||null,recipient:ctx?.requesterSenderId||ctx?.senderId||ctx?.deliveryContext?.to||(sameRun?prior?.recipient:null),until:now+60*60*1000});
}
export function runtimeChannel(ctx,apiContext,now=Date.now()){
 const direct=ctx?.messageChannel||ctx?.channelId||ctx?.deliveryContext?.channel||ctx?.channel||apiContext?.messageChannel||apiContext?.channelId||apiContext?.channel;
 if(direct)return direct;
 const row=channels.get(ctx?.sessionKey||apiContext?.sessionKey);
 return row&&row.until>now?row.channel:null;
}

export function runtimeRunId(ctx,apiContext,now=Date.now()){
 if(ctx?.runId)return String(ctx.runId);
 const key=ctx?.sessionKey||apiContext?.sessionKey,row=channels.get(key);
 if(row&&row.until>now)return row.runId;
 return apiContext?.sessionKey===key&&apiContext?.runId?String(apiContext.runId):null;
}

export function runtimeRecipient(ctx,apiContext,now=Date.now()){
 const direct=ctx?.requesterSenderId||ctx?.senderId||ctx?.deliveryContext?.to;
 if(direct)return String(direct);
 const key=ctx?.sessionKey||apiContext?.sessionKey,row=channels.get(key);
 if(row&&row.until>now&&(!ctx?.runId||ctx.runId===row.runId))return row.recipient||null;
 return null;
}
