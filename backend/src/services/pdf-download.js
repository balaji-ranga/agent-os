import { requestValidatedHttps, parsePublicHttpsUrl, SafeOutboundUrlError } from '../lib/ssrf.js';
import { downloadFileForOwner } from './content-download.js';

export const PDF_MAX_BYTES = 25 * 1024 * 1024;

export function validatePdfBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 16 || bytes.length > PDF_MAX_BYTES ||
      !/^%PDF-\d\.\d/.test(bytes.subarray(0, 8).toString('ascii')) ||
      !bytes.subarray(-2048).includes(Buffer.from('%%EOF'))) {
    throw new SafeOutboundUrlError('The URL did not return a complete PDF file. It may require access or a form submission.', 422);
  }
  return bytes;
}

export function pdfFilename(value) {
  const name = String(value || 'report.pdf').split(/[\\/]/).pop()
    .replace(/[^a-zA-Z0-9_. -]/g, '_').slice(0, 120).replace(/^\.+/, '') || 'report.pdf';
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

/** Public HTTPS only. Every redirect gets DNS/IP validation and a pinned request.
 * No caller-supplied headers, cookies, credentials or gate bypass. */
export async function fetchPdfBytes(url, { allowedDomains, timeoutMs = 30000, request = requestValidatedHttps } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const seen = new Set();
  let current = url;
  try {
    for (let hop = 0; hop <= 5; hop++) {
      current = parsePublicHttpsUrl(current, { allowedDomains }).href;
      if (seen.has(current)) throw new SafeOutboundUrlError('PDF redirect loop', 502);
      seen.add(current);
      const response = await request(current, {
        signal: controller.signal, allowedDomains, maxBytes: PDF_MAX_BYTES,
        headers: { Accept: 'application/pdf,application/octet-stream;q=0.9', 'User-Agent': 'Flolah-PDF/1.0' },
      });
      const location = response.headers.location;
      if (location && [301, 302, 303, 307, 308].includes(response.status)) {
        if (hop === 5) throw new SafeOutboundUrlError('Too many PDF redirects', 502);
        current = new URL(location, current).href;
        continue;
      }
      if (!response.ok) throw new SafeOutboundUrlError(`PDF download returned HTTP ${response.status}; no file attached.`, 502);
      return { bytes: validatePdfBytes(await response.buffer()), finalUrl: current };
    }
  } finally { clearTimeout(timer); }
}

export async function downloadPdfForOwner(ownerUserId, url, filename, options = {}) {
  return downloadFileForOwner(ownerUserId, url, pdfFilename(filename), { ...options, validateBytes: validatePdfBytes, mimeType: 'application/pdf' });
}
