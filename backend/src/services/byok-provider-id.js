export function byokProviderId(userId) {
  const id=String(userId||'').trim().toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')||'unknown';
  return `byok-${id}`;
}
export function secondaryByokProviderId(userId) { return `${byokProviderId(userId)}-secondary`; }
