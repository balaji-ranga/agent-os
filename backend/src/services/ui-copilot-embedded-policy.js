// DOM metadata is descriptive, never authority to execute arbitrary selectors.
export function embeddedFieldAllowed(key){
  return typeof key==='string'&&key.length>0&&key.length<=100&&/^[a-z][a-z0-9 ._-]*$/.test(key)
    && !/password|secret|token|credential|permission|grant|mfa|otp|payment|credit.?card|bank|budget|authority|retention|delete|purge|\bscript\b|javascript|webhook|callback|api.?key|owner|\brole\b|access|account|\bcode\b/.test(key);
}
export function embeddedPathAllowed(screen,path){
  if(typeof path!=='string'||path.length>600||/\\/.test(path))return false;
  if(screen==='crm')return /^\/(?:objects\/[a-z][a-z0-9-]*|object\/[a-z][a-z0-9-]*\/[a-zA-Z0-9-]+)(?:\?viewId=[a-zA-Z0-9-]+)?$/.test(path)||/^\/object\/[a-z][a-z0-9-]*\/[a-zA-Z0-9-]+#[a-f0-9-]{36}$/i.test(path);
  return screen==='erp'&&/^\/app(?:\/[a-z][a-z0-9-]*)?$/.test(path)&&!/(user|role|permission|setting|payment|bank|credential|token|oauth|integration)/i.test(path);
}
export function embeddedFormAllowed(label){
  if(typeof label!=='string'||label.length>100)return false;
  const match=/^(?:Create new|Add|New) (?:an? )?([A-Za-z][A-Za-z ]*?)(?:\s*\.{3}|\s*…)?$/i.exec(label);
  return !!match&&embeddedFieldAllowed(match[1].toLowerCase())&&!/invoice|journal|order|stock|transaction|fiscal|company setup/i.test(match[1]);
}
