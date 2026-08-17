/**
 * Unit checks for scheduled-goal channel fan-out helpers (no gateway / WhatsApp required).
 * Run: node scripts/test-agent-channel-announce.mjs
 */
import {
  normalizeDeliverTo,
  prefixFromAgentName,
  splitMediaLines,
  deliverToIncludes,
  mediaKindFromPath,
  mimeTypeForMediaPath,
  resolveAnnounceMediaFile,
  recentOwnerGeneratedAudioLines,
} from '../src/services/agent-channel-announce.js';
import { WHATSAPP_OPUS_FFMPEG_ARGS } from '../src/services/audio-convert.js';

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

assert(mediaKindFromPath('speech-tts.ogg') === 'audio', 'ogg is audio');
assert(mediaKindFromPath('shot.png') === 'image', 'png is image');
assert(mimeTypeForMediaPath('note.ogg') === 'audio/ogg; codecs=opus', 'ogg mime is WhatsApp PTT');
assert(mimeTypeForMediaPath('note.opus') === 'audio/ogg; codecs=opus', 'opus mime is WhatsApp PTT');
assert(resolveAnnounceMediaFile('https://login.example/api/media/x.ogg') == null, 'reject https');
assert(resolveAnnounceMediaFile('MEDIA:https://login.example/api/media/x.ogg') == null, 'reject MEDIA https');
assert(resolveAnnounceMediaFile('MEDIA:/tmp/not-in-openclaw-media.ogg') == null, 'reject outside media root');

const md = splitMediaLines(
  'Listen:\n🔊 [Audio Summary](MEDIA:/root/.openclaw/media/generated/ceo-x/a.ogg)\nDone'
);
assert(md.mediaLines.length === 1 && md.mediaLines[0].endsWith('/a.ogg'), 'extract MEDIA from markdown');
assert(!/MEDIA:/i.test(md.body), 'strip MEDIA from body');
assert(md.body.includes('Listen:') && md.body.includes('Done'), 'keep surrounding text');

const inline = splitMediaLines('Voice: MEDIA:/root/.openclaw/media/generated/ceo-x/b.ogg thanks');
assert(inline.mediaLines.some((l) => l.endsWith('/b.ogg')), 'extract inline MEDIA');

assert(Array.isArray(recentOwnerGeneratedAudioLines('no-such-owner')), 'recent audio returns array');
assert(WHATSAPP_OPUS_FFMPEG_ARGS.includes('48000'), 'opus resample 48k');
assert(WHATSAPP_OPUS_FFMPEG_ARGS.includes('libopus'), 'opus codec');

console.log('CHANNEL_ANNOUNCE_UNIT_OK');
