import {isIP} from 'node:net';
import {listFeatureCidrs,IP_FEATURES,onOwnerIpWhitelistChange,parseIpRuleList} from '../owner-ip-whitelist.js';
import {normalizeClientIp,ipMatchesCidrOrIp} from '../ip-match.js';
// Forwarded headers are accepted only from explicitly configured reverse proxies.
export function physicalClientIp(req,trustedProxies=[]){
 const peer=normalizeClientIp(req.socket?.remoteAddress||'');if(!isIP(peer))return '';
 if(!trustedProxies.some(rule=>ipMatchesCidrOrIp(peer,rule)))return peer;
 const real=req.headers?.['x-real-ip'];if(typeof real==='string'&&isIP(real.trim()))return normalizeClientIp(real);
 return '';
}
export function createPhysicalHubIpPolicy({trustedProxies=process.env.FLOLAH_PHYSICAL_TRUSTED_PROXY_CIDRS||'',now=Date.now,ttlMs=5000}={}){
 const proxies=Array.isArray(trustedProxies)?trustedProxies:trustedProxies.trim()?parseIpRuleList(trustedProxies):[];
 const cache=new Map(),listeners=new Set();
 const unsubscribe=onOwnerIpWhitelistChange(owner=>{cache.delete(owner);for(const listener of listeners)listener(owner);});
 function check(hub,req){
  const ip=physicalClientIp(req,proxies);let item=cache.get(hub.owner);
  if(!item||now()-item.at>=ttlMs){item={at:now(),rules:listFeatureCidrs(hub.owner,IP_FEATURES.PHYSICAL_EDGE)};if(cache.size>=1000)cache.delete(cache.keys().next().value);cache.set(hub.owner,item);}
  if(item.rules.length&&(!ip||!item.rules.some(rule=>ipMatchesCidrOrIp(ip,rule))))throw Object.assign(Error('Edge source IP is not allowed'),{status:403});
  return ip;
 }
 return {check,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},close(){unsubscribe();cache.clear();listeners.clear();}};
}
