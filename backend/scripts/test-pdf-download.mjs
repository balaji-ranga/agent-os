import assert from 'node:assert/strict';
import { fetchPdfBytes, validatePdfBytes, pdfFilename, PDF_MAX_BYTES } from '../src/services/pdf-download.js';

const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from([0, 255, 128]), Buffer.from('\n%%EOF\n')]);
assert.equal(validatePdfBytes(pdf), pdf);
for (const bad of [Buffer.from('<html>Login required</html>'), pdf.subarray(0, -7), Buffer.alloc(PDF_MAX_BYTES + 1)]) {
  assert.throws(() => validatePdfBytes(bad), /complete PDF/);
}
assert.equal(pdfFilename('../../report.pdf'), 'report.pdf');
assert.equal(pdfFilename('report'), 'report.pdf');
const called = [];
const result = await fetchPdfBytes('https://example.com/report', { request: async (url, options) => {
  called.push(url);
  assert.equal(options.maxBytes, PDF_MAX_BYTES);
  assert.equal(options.headers.Authorization, undefined);
  return called.length === 1 ? { status: 302, headers: { location: '/real.pdf' } } : { ok: true, status: 200, headers: {}, buffer: async () => pdf };
} });
assert.deepEqual(result.bytes, pdf);
assert.equal(result.finalUrl, 'https://example.com/real.pdf');
await assert.rejects(fetchPdfBytes('https://example.com/report', { request: async () => ({ status: 302, headers: { location: 'https://127.0.0.1/private' } }) }), /not allowed/);
await assert.rejects(fetchPdfBytes('https://example.com/report', { request: async () => ({ status: 302, headers: { location: '/report' } }) }), /loop/);
await assert.rejects(fetchPdfBytes('https://example.com/report', { request: async () => ({ status: 403, ok: false, headers: {} }) }), /HTTP 403/);
await assert.rejects(fetchPdfBytes('http://example.com/report'), /HTTPS/);
console.log('PDF binary, truncation, redirects, gate errors and SSRF checks passed');
