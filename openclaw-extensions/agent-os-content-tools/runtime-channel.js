// Only trusted runtime hook/context metadata enters this cache, never tool args.
const channels=new Map();
export function rememberRuntimeChannel(ctx,now=Date.now()){
 const key=ctx?.sessionKey,channel=ctx?.messageChannel||ctx?.channel||ctx?.channelId;
 if(!key||typeof channel!=='string'||!channel)return;
 for(const [k,v]of channels)if(v.until<=now)channels.delete(k);
 if(channels.size>=5000)channels.delete(channels.keys().next().value);
 channels.set(key,{channel,until:now+60*60*1000});
}
export function runtimeChannel(ctx,apiContext,now=Date.now()){
 const direct=ctx?.messageChannel||ctx?.deliveryContext?.channel||ctx?.channel||apiContext?.messageChannel||apiContext?.channel;
 if(direct)return direct;
 const row=channels.get(ctx?.sessionKey||apiContext?.sessionKey);
 return row&&row.until>now?row.channel:null;
}
