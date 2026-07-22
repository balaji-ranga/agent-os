/**
 * Upload chat attachments into Master Data and build an agent-facing context block
 * so the model can call master_data_rag / list_documents.
 */
import { api } from '../api.js';

const MAX_BYTES = 12 * 1024 * 1024;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export async function uploadChatAttachments(files = []) {
  const list = [...(files || [])].filter(Boolean);
  const uploaded = [];
  for (const file of list) {
    if (file.size > MAX_BYTES) {
      throw new Error(`${file.name} is too large (max 12MB)`);
    }
    const dataUrl = await readAsDataUrl(file);
    const comma = dataUrl.indexOf(',');
    const contentBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const title = `Chat attach — ${file.name}`;
    const doc = await api.masterDataDocumentUpload({
      title,
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      contentBase64,
    });
    uploaded.push({
      document_id: doc.id || doc.document?.id,
      title: doc.title || title,
      filename: file.name,
      mime_type: file.type || 'application/octet-stream',
    });
  }
  return uploaded;
}

export function buildMessageWithAttachments(userText, attachments = []) {
  const text = String(userText || '').trim();
  if (!attachments.length) return text;
  const lines = [
    '[chat_attachments]',
    'The CEO attached file(s) below. They were uploaded to Master Data.',
    'You MUST call master_data_rag (and master_data_list_documents if needed) using these document_id values before answering from their content.',
    'For structured facts that belong in tables, also use master_data_list_tables / master_data_list_rows / insert_row as appropriate.',
  ];
  for (const a of attachments) {
    lines.push(
      `- document_id=${a.document_id} title=${JSON.stringify(a.title || '')} filename=${JSON.stringify(a.filename || '')} mime=${a.mime_type || ''}`
    );
  }
  lines.push('[/chat_attachments]', '', text || '(See attached files.)');
  return lines.join('\n');
}
