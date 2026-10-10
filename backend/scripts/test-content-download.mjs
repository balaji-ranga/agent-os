import assert from 'node:assert/strict';
import { downloadFilename, fetchDownloadBytes, downloadFileForOwner } from '../src/services/content-download.js';

assert.equal(downloadFilename('../../report.xlsx'), 'report.xlsx');
assert.equal(downloadFilename('..'), 'download.bin');
const reply = bytes => async () => ({ ok: true, status: 200, headers: { 'content-type': 'text/plain', 'content-disposition': "attachment; filename*=UTF-8''hello%20world.txt" }, buffer: async () => bytes });
assert.equal((await fetchDownloadBytes('https://example.com/file', { request: reply(Buffer.from('hello')) })).filename, 'hello world.txt');
await assert.rejects(fetchDownloadBytes('https://example.com/file', { request: reply(Buffer.alloc(0)) }), /empty/);
await assert.rejects(fetchDownloadBytes('http://example.com/file'), /HTTPS/);
for (const code of ['MALWARE_DETECTED', 'SCAN_UNAVAILABLE', 'SCAN_SIGNATURES_STALE', 'SCAN_INCOMPLETE']) {
  const bytes = Buffer.from('blocked file bytes');
  const events = []; let persisted = false; const audits = [];
  await assert.rejects(downloadFileForOwner('owner-a', 'https://example.com/file', 'sample.txt', {
    request: reply(bytes), onProgress: e => events.push(e),
    scanBytes: async () => { throw Object.assign(new Error('blocked'), { code }); },
    auditScan: (owner, scan) => audits.push({ owner, status: scan.status }),
    persistFile: () => { persisted = true; },
  }), e => e.securityScan?.persisted === false && e.securityScan?.disposition === 'discarded');
  assert.equal(persisted, false);
  assert(bytes.every(x => x === 0));
  assert.equal(audits[0].owner, 'owner-a');
  assert.equal(events.at(-1).phase, 'content_rejected');
}
let stored; const bytes = Buffer.from('clean text'); const events = [];
const clean = await downloadFileForOwner('owner-a', 'https://example.com/file', 'sample.txt', {
  request: reply(bytes), scanBytes: async () => ({ status: 'clean', scanner: 'ClamAV' }), auditScan: () => {},
  onProgress: e => events.push(e), persistFile: (b, name, subdir, owner) => { stored = Buffer.from(b); assert.equal(subdir, 'downloads'); assert.equal(owner, 'owner-a'); return { relative_url: '/api/media/openclaw/downloads/owner-a/test.txt' }; },
});
assert.equal(stored.toString(), 'clean text'); assert(bytes.every(x => x === 0));
assert.equal(clean.security_scan.status, 'clean'); assert.equal(events.at(-1).phase, 'content_scan_clean');
console.log('Generic downloads: binary bounds, filenames, scan-before-write, discarded rejection bytes and progress passed');
