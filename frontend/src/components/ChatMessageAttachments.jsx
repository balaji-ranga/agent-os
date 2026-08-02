import { useEffect, useState } from 'react';
import { api } from '../api';
import { attachmentKind, isImageMime } from '../utils/chatAttachments.js';

/**
 * Inline chat attachment previews: images with thumbnail + filename; other files as named chips.
 */
function AttachmentCard({ item }) {
  const [blobUrl, setBlobUrl] = useState(item.previewUrl || null);
  const [loadError, setLoadError] = useState(null);
  const filename = item.filename || 'attachment';
  const mime = item.mime_type || '';
  const kind = item.kind || attachmentKind(mime, filename);

  useEffect(() => {
    let revoked = false;
    let created = null;
    if (item.previewUrl) {
      setBlobUrl(item.previewUrl);
      return undefined;
    }
    if (!item.relative_path) return undefined;
    if (kind !== 'image' && kind !== 'audio' && kind !== 'video') return undefined;
    (async () => {
      try {
        const { blob } = await api.inboundAttachmentDownload(item.relative_path);
        if (revoked) return;
        created = URL.createObjectURL(blob);
        setBlobUrl(created);
      } catch (e) {
        if (!revoked) setLoadError(e?.message || 'Preview unavailable');
      }
    })();
    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [item.previewUrl, item.relative_path, kind]);

  const downloadHref = item.relative_path
    ? null
    : null;

  const onDownload = async () => {
    if (!item.relative_path) return;
    try {
      const { blob, filename: dlName } = await api.inboundAttachmentDownload(item.relative_path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = dlName || filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn('[chat] attachment download failed', e?.message || e);
    }
  };

  if (kind === 'image' && blobUrl) {
    return (
      <figure className="chat-msg-attach chat-msg-attach--image">
        <img src={blobUrl} alt={filename} className="chat-msg-attach-img" loading="lazy" />
        <figcaption className="chat-msg-attach-caption" title={filename}>
          {filename}
        </figcaption>
      </figure>
    );
  }

  if (kind === 'video' && blobUrl) {
    return (
      <figure className="chat-msg-attach chat-msg-attach--video">
        <video src={blobUrl} controls className="chat-msg-attach-video" preload="metadata" />
        <figcaption className="chat-msg-attach-caption" title={filename}>
          {filename}
        </figcaption>
      </figure>
    );
  }

  if (kind === 'audio' && blobUrl) {
    return (
      <div className="chat-msg-attach chat-msg-attach--audio">
        <audio src={blobUrl} controls preload="metadata" />
        <span className="chat-msg-attach-caption" title={filename}>
          {filename}
        </span>
      </div>
    );
  }

  const badge =
    kind === 'image' ? 'IMG' : kind === 'video' ? 'VID' : kind === 'audio' ? 'AUD' : 'FILE';

  return (
    <div className="chat-msg-attach chat-msg-attach--file" title={loadError || filename}>
      <span className="chat-msg-attach-badge" aria-hidden>
        {badge}
      </span>
      <span className="chat-msg-attach-name">{filename}</span>
      {item.relative_path && (
        <button type="button" className="chat-msg-attach-dl" onClick={onDownload}>
          Download
        </button>
      )}
      {!blobUrl && kind === 'image' && isImageMime(mime, filename) && item.relative_path && !loadError && (
        <span className="chat-msg-attach-loading">Loading…</span>
      )}
    </div>
  );
}

export default function ChatMessageAttachments({ attachments = [] }) {
  const list = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
  if (!list.length) return null;
  return (
    <div className="chat-msg-attach-list" aria-label="Attached files">
      {list.map((a, i) => (
        <AttachmentCard key={`${a.filename || 'file'}-${a.relative_path || a.document_id || i}`} item={a} />
      ))}
    </div>
  );
}
