import {BlockList,isIP} from 'node:net';
/**
 * Shared client-IP extraction and CIDR matching (no DB).
 */
export function normalizeClientIp(raw) {
  let ip = String(raw || '').trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

/**
 * Client IP from trusted reverse-proxy headers.
 * Prefer X-Real-IP (nginx $remote_addr). For XFF use the right-most hop.
 */
export function clientIpFromRequest(req) {
  const real = req.headers?.['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return normalizeClientIp(real);
  const xf = req.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    const parts = xf.split(',').map((value) => value.trim()).filter(Boolean);
    return normalizeClientIp(parts[parts.length - 1]);
  }
  if (Array.isArray(xf) && xf.length) {
    const parts = String(xf[xf.length - 1]).split(',').map((value) => value.trim()).filter(Boolean);
    return normalizeClientIp(parts[parts.length - 1]);
  }
  return normalizeClientIp(req.socket?.remoteAddress || req.ip || '');
}

function ipv4ToInt(ip) {
  const parts = String(ip).split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

export function ipMatchesCidrOrIp(clientIp,rule){
 const r=String(rule||'').trim(),parts=r.split('/');if(!r||parts.length>2)return false;
 let ip=String(clientIp||'').trim(),base=parts[0];
 if(parts.length===1){ip=normalizeClientIp(ip);base=normalizeClientIp(base);}
 else{if(ip.startsWith('::ffff:'))ip=ip.slice(7);if(base.startsWith('::ffff:')){const n=Number(parts[1]);if(n<96)return false;base=base.slice(7);parts[1]=String(n-96);}}
 if(!isIP(ip)||!isIP(base)||isIP(ip)!==isIP(base))return false;
 try{const block=new BlockList(),family=isIP(base)===4?'ipv4':'ipv6';
  if(parts.length===1)block.addAddress(base,family);
  else{if(!/^\d+$/.test(parts[1]))return false;const bits=Number(parts[1]);if(bits<0||bits>(family==='ipv4'?32:128))return false;block.addSubnet(base,bits,family);}
  return block.check(ip,family);
 }catch{return false;}
}
