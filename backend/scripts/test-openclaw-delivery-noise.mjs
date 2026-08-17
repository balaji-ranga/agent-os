/**
 * Strip OpenClaw native-message failure banners from assistant text.
 * Run: node scripts/test-openclaw-delivery-noise.mjs
 */
import {
  stripOpenClawDeliveryNoise,
  toAgentSystemUserMessage,
} from '../src/services/openclaw-runtime-tools.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const body = 'Evening thought one.\n\n⚠️ ✉️ Message failed\n';
const cleaned = stripOpenClawDeliveryNoise(body);
assert(!cleaned.includes('Message failed'), 'banner stripped');
assert(cleaned.includes('Evening thought one.'), 'body kept');

const inline = 'Done. ⚠️ ✉️ Message failed';
assert(stripOpenClawDeliveryNoise(inline) === 'Done.', 'inline banner');

const envelopeOnly = 'Hello\n✉️ Message failed\n';
assert(!stripOpenClawDeliveryNoise(envelopeOnly).includes('Message failed'), 'envelope-only line');

const keep = 'The message failed to parse JSON.';
assert(stripOpenClawDeliveryNoise(keep) === keep, 'do not strip ordinary prose');

const branded = toAgentSystemUserMessage('OpenClaw timeout\n⚠️ ✉️ Message failed');
assert(branded === 'AgentSystem timeout', 'rename + strip');

console.log('OPENCLAW_DELIVERY_NOISE_OK');
