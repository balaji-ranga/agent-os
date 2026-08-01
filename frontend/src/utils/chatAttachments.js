/**
 * Upload chat attachments into Master Data AND CEO workspace inbound/attachments.
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
    const title = `Chat attach ? ${file.name}`;
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
    'Documents/images: also in Master Data ? call master_data_rag / master_data_list_documents with document_id when needed.',
    'Audio/video/docs are also saved under the user workspace at the relative_path (inbound/attachments/...).',
    'To summarize A/V, trigger the inbound media workflow by sending the relative_path as the chat message (or include it clearly).',
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
