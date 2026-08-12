/**
 * Unit checks for media URL helpers (chat + WhatsApp MEDIA:; public signed off by default).
 * Usage: node backend/scripts/test-media-url.js
 */
import assert from 'assert';
import { join } from 'path';

process.env.AGENT_OS_BASE_URL = 'https://example.test';
process.env.AGENT_OS_PUBLIC_URL = 'https://example.test';
process.env.PUBLIC_URL = 'https://example.test';
process.env.OPENCLAW_DIR = '/root/.openclaw';
process.env.MEDIA_SIGNING_SECRET = 'test-secret';
delete process.env.MEDIA_PUBLIC_SIGNED;

const {
  normalizeMediaApiPath,
  toAbsoluteMediaUrl,
  enrichGeneratedOpenClawMedia,
  persistGeneratedOpenClawMedia,
  verifyMediaPublicSig,
  signMediaPublic,
  isMediaPublicSignedEnabled,
} = await import('../src/services/media-url.js');

assert.strictEqual(isMediaPublicSignedEnabled(), false);

assert.strictEqual(
  normalizeMediaApiPath('/media/artifacts/abc/download'),
  '/api/media/artifacts/abc/download'
);
assert.strictEqual(
  normalizeMediaApiPath('/media/generated/x.png'),
  '/api/media/openclaw/generated/x.png'
);

const enriched = enrichGeneratedOpenClawMedia('abc.png');
assert.strictEqual(enriched.media_uri, 'MEDIA:' + join('/root/.openclaw', 'media', 'generated', 'abc.png'));
assert.strictEqual(enriched.url, enriched.media_uri);
assert.strictEqual(enriched.paste_exactly, enriched.media_uri);
assert.strictEqual(enriched.relative_url, '/api/media/openclaw/generated/abc.png');
assert.strictEqual(enriched.public_url, null);
assert.ok(String(enriched.absolute_url).includes('/api/media/openclaw/generated/abc.png'));
assert.ok(!String(enriched.absolute_url).includes('sig='));

assert.strictEqual(signMediaPublic('generated/abc.png', 3600), null);
assert.ok(!verifyMediaPublicSig('generated/abc.png', 9999999999, 'anything'));

process.env.MEDIA_PUBLIC_SIGNED = '1';
// Re-import not possible for env flag read at call time — flag is read live
assert.strictEqual(isMediaPublicSignedEnabled(), true);
const signed = signMediaPublic('generated/abc.png', 3600);
assert.ok(signed);
assert.ok(verifyMediaPublicSig('generated/abc.png', signed.exp, signed.sig));
assert.ok(!verifyMediaPublicSig('generated/abc.png', signed.exp, 'bad'));
assert.ok(!verifyMediaPublicSig('generated/other.png', signed.exp, signed.sig));
delete process.env.MEDIA_PUBLIC_SIGNED;

const persisted = persistGeneratedOpenClawMedia(Buffer.from('RIFF....WAVE'), 'speech-tts.wav', 'generated');
assert.ok(persisted.media_uri.startsWith('MEDIA:'));
assert.ok(persisted.media_uri.endsWith('.wav'));
assert.ok(String(persisted.paste_exactly).startsWith('MEDIA:'));
assert.ok(String(persisted.relative_url).includes('/api/media/openclaw/generated/'));
assert.strictEqual(persisted.public_url, null);

const { guessMimeFromFilename } = await import('../src/services/master-data-extract.js');
assert.strictEqual(guessMimeFromFilename('storyboard.pdf'), 'application/pdf');
assert.strictEqual(guessMimeFromFilename('board.html'), 'text/html');

const { writeFileSync, mkdtempSync } = await import('fs');
const { tmpdir } = await import('os');
const tmp = mkdtempSync(join(tmpdir(), 'media-mime-'));
const namedPdf = join(tmp, 'board.pdf');
writeFileSync(namedPdf, Buffer.from('%PDF-1.3\n%'));
const barePdf = join(tmp, '5b0bb15b-a258-4db3-822a-b1ff29d5c49d');
writeFileSync(barePdf, Buffer.from('%PDF-1.3\n%'));
const { resolveOpenClawMediaMime } = await import('../src/routes/media.js');
assert.strictEqual(resolveOpenClawMediaMime(namedPdf), 'application/pdf');
assert.strictEqual(resolveOpenClawMediaMime(barePdf), 'application/pdf');

console.log('OK media-url helpers (MEDIA: + auth-only; signed public opt-in)');
