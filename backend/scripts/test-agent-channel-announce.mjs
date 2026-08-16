/**
 * Unit checks for scheduled-goal channel fan-out helpers (no gateway / WhatsApp required).
 * Run: node scripts/test-agent-channel-announce.mjs
 */
import {
  normalizeDeliverTo,
  prefixFromAgentName,
  splitMediaLines,
  deliverToIncludes,
} from '../src/services/agent-channel-announce.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const webOnly = normalizeDeliverTo(null);
assert(JSON.stringify(webOnly) === JSON.stringify(['web']), 'default web');
assert(!deliverToIncludes(webOnly, 'whatsapp'), 'default no whatsapp');

const wa = normalizeDeliverTo(['web', 'whatsapp']);
assert(deliverToIncludes(wa, 'whatsapp'), 'array whatsapp');
assert(wa[0] === 'web', 'web first');

const flag = normalizeDeliverTo(undefined, { also_whatsapp: true });
assert(deliverToIncludes(flag, 'whatsapp'), 'also_whatsapp flag');

const off = normalizeDeliverTo(['web', 'whatsapp'], { also_whatsapp: false });
assert(!deliverToIncludes(off, 'whatsapp'), 'also_whatsapp false removes');

const json = normalizeDeliverTo('["web","slack"]');
assert(deliverToIncludes(json, 'slack') && !deliverToIncludes(json, 'whatsapp'), 'json string');

const { body, mediaLines } = splitMediaLines('Hello\nMEDIA:/tmp/a.ogg\nMore');
assert(body.includes('Hello') && mediaLines.length === 1, 'split media');

const unknownRpc = /unknown method|not (found|allowed|supported)|invalid method|is not supported/i;
assert(unknownRpc.test('admin HTTP RPC method is not supported: send'), 'rpc not-supported is unknown');

const prefixed = prefixFromAgentName('Morning briefing ready.', 'BalServe');
assert(prefixed.startsWith('From: BalServe'), `prefix got: ${prefixed.slice(0, 40)}`);
const again = prefixFromAgentName(prefixed, 'BalServe');
assert((again.match(/^From:/gm) || []).length === 1, 'idempotent From');

const withMedia = prefixFromAgentName('Hi\nMEDIA:/root/.openclaw/media/x.ogg', 'COO');
assert(withMedia.startsWith('From: COO'), 'from before body');
assert(/^MEDIA:/m.test(withMedia.split('\n').pop()), 'media last line alone');

console.log('CHANNEL_ANNOUNCE_UNIT_OK');
