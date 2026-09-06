/**
 * WhatsApp outbound "From: {employee name}" via OpenClaw responsePrefix.
 * Live channel replies use channels.whatsapp(.accounts.*).responsePrefix + agents.list[].identity.name.
 * Scheduled-goal admin RPC sends still use backend prefixFromAgentName (different path).
 */
export const WHATSAPP_FROM_RESPONSE_PREFIX = 'From: {identityName}';

export function shouldSetWhatsAppFromPrefix(existing) {
  const s = String(existing || '').trim();
  return !s || s === 'auto';
}

/** Mutates the WhatsApp channel object (channel-level + each account). */
export function applyWhatsAppFromPrefixToChannel(whatsappCfg) {
  if (!whatsappCfg || typeof whatsappCfg !== 'object') return whatsappCfg;
  if (shouldSetWhatsAppFromPrefix(whatsappCfg.responsePrefix)) {
    whatsappCfg.responsePrefix = WHATSAPP_FROM_RESPONSE_PREFIX;
  }
  const accounts = whatsappCfg.accounts;
  if (accounts && typeof accounts === 'object') {
    for (const id of Object.keys(accounts)) {
      const acc = accounts[id];
      if (!acc || typeof acc !== 'object') continue;
      if (shouldSetWhatsAppFromPrefix(acc.responsePrefix)) {
        acc.responsePrefix = WHATSAPP_FROM_RESPONSE_PREFIX;
      }
    }
  }
  return whatsappCfg;
}

/** Strip tenant suffix from OpenClaw entry.name: "BalServe (ceo-…)" → "BalServe". */
export function displayNameFromOpenClawAgentEntry(entry) {
  const fromIdentity = String(entry?.identity?.name || '').trim();
  if (fromIdentity) return fromIdentity;
  const raw = String(entry?.name || entry?.id || '').trim();
  const stripped = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return stripped || raw || 'AI employee';
}

export function applyIdentityNameToAgentEntry(entry, displayName, { overwrite = true } = {}) {
  if (!entry || typeof entry !== 'object') return entry;
  const existingName = String(entry?.identity?.name || '').trim();
  if (!overwrite && existingName) return entry;
  const name =
    String(displayName || '').trim() || displayNameFromOpenClawAgentEntry(entry);
  if (!name) return entry;
  const prev = entry.identity && typeof entry.identity === 'object' ? entry.identity : {};
  entry.identity = { ...prev, name };
  return entry;
}
