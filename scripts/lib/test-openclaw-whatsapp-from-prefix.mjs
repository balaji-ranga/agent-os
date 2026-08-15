/**
 * Unit checks for WhatsApp From: {identityName} prefix helpers (no gateway).
 * Run: node scripts/lib/test-openclaw-whatsapp-from-prefix.mjs
 */
import {
  WHATSAPP_FROM_RESPONSE_PREFIX,
  shouldSetWhatsAppFromPrefix,
  applyWhatsAppFromPrefixToChannel,
  displayNameFromOpenClawAgentEntry,
  applyIdentityNameToAgentEntry,
} from './openclaw-whatsapp-from-prefix.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(WHATSAPP_FROM_RESPONSE_PREFIX === 'From: {identityName}', 'prefix template');
assert(shouldSetWhatsAppFromPrefix(undefined), 'missing');
assert(shouldSetWhatsAppFromPrefix(''), 'empty');
assert(shouldSetWhatsAppFromPrefix('auto'), 'auto');
assert(!shouldSetWhatsAppFromPrefix('From: {identityName}'), 'already set');
assert(!shouldSetWhatsAppFromPrefix('[ops]'), 'custom kept');

const ch = { accounts: { 't-ceo-x--balserve': { enabled: true } } };
applyWhatsAppFromPrefixToChannel(ch);
assert(ch.responsePrefix === WHATSAPP_FROM_RESPONSE_PREFIX, 'channel prefix');
assert(ch.accounts['t-ceo-x--balserve'].responsePrefix === WHATSAPP_FROM_RESPONSE_PREFIX, 'account prefix');

const custom = { responsePrefix: '[ops]', accounts: { a: { responsePrefix: '[ops]' } } };
applyWhatsAppFromPrefixToChannel(custom);
assert(custom.responsePrefix === '[ops]', 'keep custom channel');
assert(custom.accounts.a.responsePrefix === '[ops]', 'keep custom account');

const entry = { id: 't-ceo-meridian-college-f101c7--balserve', name: 'BalServe (ceo-meridian-college-f101c7)' };
assert(displayNameFromOpenClawAgentEntry(entry) === 'BalServe', 'strip tenant suffix');
applyIdentityNameToAgentEntry(entry, 'College COO');
assert(entry.identity?.name === 'College COO', 'db name wins');
applyIdentityNameToAgentEntry(entry);
assert(entry.identity?.name === 'College COO', 'existing identity kept when no displayName');

console.log('WHATSAPP_FROM_PREFIX_UNIT_OK');
