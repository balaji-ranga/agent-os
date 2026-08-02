/**
 * Upload chat attachments into Master Data AND CEO workspace inbound/attachments.
 * Also helpers for UI display (inline image preview + named file chips).
 */
import { api } from '../api.js';

const MAX_BYTES = 40 * 1024 * 1024;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export const CHAT_MEDIA_ACCEPT =
  '.pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.xls,.png,.jpg,.jpeg,.gif,.webp,.bmp,.mp3,.wav,.m4a,.ogg,.opus,.aac,.flac,.mp4,.webm,.mov,.avi';

export function isImageMime(mime, filename = '') {
  if (String(mime || '').toLowerCase().startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(filename || ''));
}

export function isAudioMime(mime, filename = '') {
  if (String(mime || '').toLowerCase().startsWith('audio/')) return true;
  return /\.(mp3|wav|m4a|ogg|opus|aac|flac)$/i.test(String(filename || ''));
}

export function isVideoMime(mime, filename = '') {
  if (String(mime || '').toLowerCase().startsWith('video/')) return true;
  return /\.(mp4|webm|mov|avi)$/i.test(String(filename || ''));
}

export function attachmentKind(mime, filename = '') {
  if (isImageMime(mime, filename)) return 'image';
  if (isAudioMime(mime, filename)) return 'audio';
  if (isVideoMime(mime, filename)) return 'video';
  return 'file';
}

/**
 * Optimistic UI attachments from File objects (revocable object URLs for images).
 */
export function buildDisplayAttachmentsFromFiles(files = []) {
  return [...(files || [])].filter(Boolean).map((file, i) => {
    const mime = file.type || 'application/octet-stream';
    const filename = file.name || `file-${i + 1}`;
    const kind = attachmentKind(mime, filename);
    let previewUrl = null;
    if (kind === 'image' || kind === 'video' || kind === 'audio') {
      try {
        previewUrl = URL.createObjectURL(file);
      } catch {
        previewUrl = null;
      }
    }
    return {
      filename,
      mime_type: mime,
      kind,
      previewUrl,
      size: file.size,
      relative_path: null,
      document_id: null,
    };
  });
}

export function revokeAttachmentPreviews(attachments = []) {
  for (const a of attachments || []) {
    if (a?.previewUrl && String(a.previewUrl).startsWith('blob:')) {
      try {
        URL.revokeObjectURL(a.previewUrl);
      } catch {
        /* ignore */
      }
    }
  }
}

function parseAttr(line, key) {
  const jsonRe = new RegExp(`${key}=("(?:\\\\.|[^"\\\\])*")`);
  const jm = line.match(jsonRe);
  if (jm) {
    try {
      return JSON.parse(jm[1]);
    } catch {
      return String(jm[1]).slice(1, -1);
    }
  }
  const bareRe = new RegExp(`${key}=([^\\s]+)`);
  const bm = line.match(bareRe);
  return bm ? bm[1] : '';
}

/**
 * Split stored chat content into display text + attachment metadata.
 */
export function splitChatAttachmentContent(content) {
  const raw = String(content ?? '');
  const re = /\[chat_attachments\]([\s\S]*?)\[\/chat_attachments\]\s*/i;
  const m = raw.match(re);
  if (!m) {
    // Legacy optimistic label
    if (/^\(Attached \d+ files?\)$/i.test(raw.trim())) {
      return { text: '', attachments: [], legacyAttachedLabel: raw.trim() };
    }
    return { text: raw, attachments: [] };
  }
  const attachments = [];
  for (const line of String(m[1] || '').split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('-')) continue;
    const filename = parseAttr(s, 'filename') || parseAttr(s, 'title') || 'attachment';
    const mime = parseAttr(s, 'mime') || '';
    const relative_path = parseAttr(s, 'relative_path') || null;
    const document_id = parseAttr(s, 'document_id') || null;
    attachments.push({
      filename,
      mime_type: mime,
      kind: attachmentKind(mime, filename),
      previewUrl: null,
      relative_path,
      document_id,
    });
  }
  let text = raw.replace(re, '').trim();
  if (text === '(See attached files.)') text = '';
  return { text, attachments };
}

export async function uploadChatAttachments(files = []) {
  const list = [...(files || [])].filter(Boolean);
  const uploaded = [];
  for (const file of list) {
    if (file.size > MAX_BYTES) {
      throw new Error(`${file.name} is too large (max 40MB)`);
    }
    const dataUrl = await readAsDataUrl(file);
    const comma = dataUrl.indexOf(',');
    const contentBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const mime = file.type || 'application/octet-stream';
    const title = `Chat attach — ${file.name}`;
    const doc = await api.masterDataDocumentUpload({
      title,
      filename: file.name,
      mimeType: mime,
      contentBase64,
    });
    let inbound = null;
    try {
      inbound = await api.inboundAttachmentUpload({
        filename: file.name,
        mimeType: mime,
        contentBase64,
      });
    } catch (e) {
      console.warn('inbound attachment save failed', e?.message || e);
    }
    uploaded.push({
      document_id: doc.id || doc.document?.id,
      title: doc.title || title,
      filename: file.name,
      mime_type: mime,
      relative_path: inbound?.relative_path || null,
      absolute_path: inbound?.absolute_path || null,
      kind: attachmentKind(mime, file.name),
    });
  }
  return uploaded;
}

export function buildMessageWithAttachments(userText, attachments = []) {
  const text = String(userText || '').trim();
  if (!attachments.length) return text;
  const lines = [
    '[chat_attachments]',
    'The CEO attached file(s) below.',
    'Documents/images: also in Master Data — call master_data_rag / master_data_list_documents with document_id when needed.',
    'Audio/video/docs are also saved under the user workspace at the relative_path (inbound/attachments/...).',
    'For images use analyze_image with relative_path. For A/V use speech_stt or the inbound media summarize workflow.',
  ];
  for (const a of attachments) {
    lines.push(
      `- document_id=${a.document_id} title=${JSON.stringify(a.title || '')} filename=${JSON.stringify(a.filename || '')} mime=${a.mime_type || ''}` +
        (a.relative_path ? ` relative_path=${a.relative_path}` : '')
    );
  }
  lines.push('[/chat_attachments]', '', text || '(See attached files.)');
  return lines.join('\n');
}
