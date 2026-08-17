/**
 * Dedupe keys for chat TTS/MEDIA: lines.
 * Run: node scripts/test-resolve-media-src.mjs
 */
import {
  resolveMediaSrc,
  extractMediaUrlsFromText,
} from '../src/utils/resolveMediaSrc.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const oggFs = 'MEDIA:/root/.openclaw/media/generated/ceo-x/clip.ogg';
const oggApi = '/api/media/openclaw/generated/ceo-x/clip.ogg';
assert(resolveMediaSrc(oggFs) === oggApi, 'MEDIA: ogg maps to openclaw API');

const text = [
  'Hello',
  oggFs,
  `[Audio](${oggFs})`,
  oggApi,
].join('\n');
const extracted = extractMediaUrlsFromText(text);
const keys = [...new Set(extracted.map((u) => resolveMediaSrc(u) || u))];
assert(keys.length === 1, `expected 1 unique clip, got ${keys.length}: ${keys.join(', ')}`);
assert(keys[0] === oggApi, `unique key should be API path, got ${keys[0]}`);

console.log('CHAT_MEDIA_DEDUPE_OK');
