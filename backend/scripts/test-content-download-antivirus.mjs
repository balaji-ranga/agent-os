import assert from 'node:assert/strict';
import net from 'node:net';
import { clamCommand, scanDownloadBytes, validateClamVersion } from '../src/services/content-download-antivirus.js';
const version = `ClamAV 1.4.3/27900/${new Date().toUTCString()}`;
assert.equal(validateClamVersion(version).signature_version, '27900');
assert.throws(() => validateClamVersion('ClamAV 1.4.3/27900/Thu, 01 Jan 2020 00:00:00 GMT'), /stale/);
const command = async name => name === 'VERSION' ? version : 'stream: OK';
assert.equal((await scanDownloadBytes(Buffer.from('clean'), { command })).status, 'clean');
await assert.rejects(scanDownloadBytes(Buffer.from('bad'), { command: async name => name === 'VERSION' ? version : 'stream: Win.Test.EICAR_HDB-1 FOUND' }), /unsafe/);
await assert.rejects(scanDownloadBytes(Buffer.from('large'), { command: async name => name === 'VERSION' ? version : 'INSTREAM size limit exceeded. ERROR' }), /complete file/);
await assert.rejects(scanDownloadBytes(Buffer.from('x'), { config: { mode:'off' }, command }), /must be required/);
await assert.rejects(clamCommand('VERSION', null, {}), /not configured/);
let received = Buffer.alloc(0);
const server = net.createServer(socket => socket.on('data', bytes => {
  received = Buffer.concat([received,bytes]);
  const prefix = Buffer.from('zINSTREAM\0');
  if (received.length >= prefix.length + 4) {
    const size = received.readUInt32BE(prefix.length);
    if (received.length >= prefix.length + 4 + size + 4) socket.end('stream: OK\0');
  }
}));
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
try {
  const bytes = Buffer.from([0,255,128,10]);
  assert.equal(await clamCommand('INSTREAM',bytes,{host:'127.0.0.1',port:server.address().port}), 'stream: OK');
  assert.deepEqual(received.subarray(14,18),bytes);
} finally { await new Promise(resolve => server.close(resolve)); }
console.log('Antivirus clean/infected/error/unconfigured/stale-signature gates and binary INSTREAM protocol passed');
