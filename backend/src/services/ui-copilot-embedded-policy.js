// DOM metadata is descriptive, never authority to execute arbitrary selectors.
export function embeddedFieldAllowed(key){
  return typeof key==='string'&&key.length>0&&key.length<=100&&/^[a-z][a-z0-9 ._-]*$/.test(key)
    && !/password|secret|token|credential|permission|grant|mfa|otp|payment|credit.?card|bank|budget|authority|retention|delete|purge|\bscript\b|javascript|webhook|callback|api.?key|owner|\brole\b|access|account|\bcode\b/.test(key);
}
export function embeddedPathAllowed(screen,path){
  if(typeof path!=='string'||path.length>600||/[\\#]/.test(path))return false;
  if(screen==='crm')return /^\/objects\/[a-z][a-z0-9-]*(?:\?viewId=[a-zA-Z0-9-]+)?$/.test(path);
  return screen==='erp'&&/^\/app\/[a-z][a-z0-9-]*$/.test(path)&&!/(user|role|permission|setting|payment|bank|credential|token|oauth|integration)/i.test(path);
}
