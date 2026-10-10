import { requestValidatedHttps, parsePublicHttpsUrl, SafeOutboundUrlError } from '../lib/ssrf.js';
import { persistGeneratedOpenClawMedia } from './media-url.js';
import { scanDownloadBytes, recordDownloadScan } from './content-download-antivirus.js';

export const DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;
export function downloadFilename(value = 'download.bin') {
  return String(value).split(/[\\/]/).pop().replace(/[^a-zA-Z0-9_. -]/g, '_')
    .slice(0, 120).replace(/^\.+/, '') || 'download.bin';
}

// DNS-pinned, bounded, public HTTPS. No model-supplied cookies/headers or gate bypass.
export async function fetchDownloadBytes(url, { allowedDomains, timeoutMs = 30000, request = requestValidatedHttps } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const seen = new Set();
  let current = url;
  try {
    for (let hop = 0; hop <= 5; hop++) {
      current = parsePublicHttpsUrl(current, { allowedDomains }).href;
      if (seen.has(current)) throw new SafeOutboundUrlError('Download redirect loop', 502);
      seen.add(current);
      const response = await request(current, {
        signal: controller.signal, allowedDomains, maxBytes: DOWNLOAD_MAX_BYTES,
        headers: { Accept: '*/*', 'User-Agent': 'Flolah-Download/1.0' },
      });
      const location = response.headers.location;
      if (location && [301, 302, 303, 307, 308].includes(response.status)) {
        if (hop === 5) throw new SafeOutboundUrlError('Too many download redirects', 502);
        current = new URL(location, current).href;
        continue;
      }
      if (!response.ok) throw new SafeOutboundUrlError(`Download returned HTTP ${response.status}; no file attached.`, 502);
      const bytes = await response.buffer();
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > DOWNLOAD_MAX_BYTES) {
        throw new SafeOutboundUrlError('File is empty or exceeds the 25 MiB download limit.', 422);
      }
      let filename;
      const disposition = response.headers['content-disposition'] || '';
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const plain = disposition.match(/filename="([^"]+)"|filename=([^;]+)/i);
      try { filename = encoded ? decodeURIComponent(encoded[1]) : plain?.[1] || plain?.[2]; } catch { /* use URL leaf */ }
      return { bytes, finalUrl: current, filename: downloadFilename(filename || new URL(current).pathname.split('/').pop()), contentType: String(response.headers['content-type'] || '').split(';')[0].trim() };
    }
  } finally { clearTimeout(timer); }
}

/** Only clean bytes reach disk. Rejection discards memory; no quarantine/content copy. */
export async function downloadFileForOwner(ownerUserId, url, filename, options = {}) {
  if (!ownerUserId) throw new SafeOutboundUrlError('Authenticated file owner required', 403);
  const progress = event => { try { options.onProgress?.(event); } catch { /* presentation cannot change scan enforcement */ } };
  progress({ phase: 'content_download', label: 'Downloading content', detail: 'Public HTTPS download; not yet attached' });
  const result = await fetchDownloadBytes(url, options);
  const { bytes, finalUrl } = result;
  const scanBytes = options.scanBytes || scanDownloadBytes;
  const auditScan = options.auditScan || recordDownloadScan;
  const persistFile = options.persistFile || persistGeneratedOpenClawMedia;
  try {
    options.validateBytes?.(bytes);
    progress({ phase: 'content_scan', label: 'Scanning downloaded content', detail: 'ClamAV • attachment blocked until a complete clean scan' });
    let securityScan;
    try {
      securityScan = await scanBytes(bytes);
      auditScan(ownerUserId, securityScan, bytes);
    } catch (e) {
      auditScan(ownerUserId, { status: e.code || 'SCAN_UNAVAILABLE' }, bytes);
      e.securityScan = { status: e.code || 'SCAN_UNAVAILABLE', scanner: 'ClamAV', disposition: 'discarded', persisted: false };
      throw e;
    }
    const originalFilename = downloadFilename(filename || result.filename);
    if (/\.pdf$/i.test(originalFilename) && (!/^%PDF-\d\.\d/.test(bytes.subarray(0, 8).toString('ascii')) || !bytes.subarray(-2048).includes(Buffer.from('%%EOF')))) {
      throw new SafeOutboundUrlError('The requested PDF filename does not contain a complete PDF; no file attached.', 422);
    }
    if (/\.(md|markdown)$/i.test(originalFilename)) {
      try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new SafeOutboundUrlError('Markdown attachment is not valid UTF-8 text.', 422); }
    }
    const artifact = persistFile(bytes, originalFilename, 'downloads', ownerUserId);
    progress({ phase: 'content_scan_clean', label: 'Content scan passed', detail: 'ClamAV clean • owner-private attachment ready' });
    return {
      ok: true, ...artifact, filename: originalFilename, mime_type: options.mimeType || result.contentType || 'application/octet-stream', size_bytes: bytes.length,
      source_url: finalUrl, security_scan: { ...securityScan, disposition: 'attached', persisted: true },
      summary: 'File downloaded and antivirus scanned. Paste paste_exactly on its own line to attach it. Never execute downloaded content; indexing/RAG is separate.',
    };
  } catch (e) {
    progress({ phase: 'content_rejected', label: 'Content rejected — not attached', detail: `${e.code || 'DOWNLOAD_REJECTED'} • discarded; no content/quarantine file retained` });
    throw e;
  } finally { bytes.fill(0); }
}
