import { useRef, useState } from 'react';
import { handleChatComposeKeyDown } from '../utils/chatCompose.js';

/**
 * Multiline chat input with optional file attachments (images/docs).
 * Attach control is a paperclip icon inside the composer — Enter to send, Shift+Enter for a new line.
 */
export default function ChatComposeInput({
  value,
  onChange,
  onSend,
  placeholder = 'Message…',
  rows = 3,
  disabled = false,
  className,
  style,
  attachments = [],
  onAttachmentsChange,
  accept = '.pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.xls,.png,.jpg,.jpeg,.gif,.webp,.bmp,.mp3,.wav,.m4a,.ogg,.opus,.aac,.flac,.mp4,.webm,.mov,.avi',
  ...rest
}) {
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const supportAttach = typeof onAttachmentsChange === 'function';

  const addFiles = (fileList) => {
    if (!supportAttach || !fileList?.length) return;
    const next = [...attachments];
    for (const f of fileList) {
      if (!next.some((x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified)) {
        next.push(f);
      }
    }
    onAttachmentsChange(next);
  };

  const removeAt = (idx) => {
    if (!supportAttach) return;
    onAttachmentsChange(attachments.filter((_, i) => i !== idx));
  };

  const onDragOver = (e) => {
    if (!supportAttach || disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const onDragLeave = (e) => {
    if (!supportAttach) return;
    e.preventDefault();
    setDragOver(false);
  };

  const onDrop = (e) => {
    if (!supportAttach || disabled) return;
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer?.files);
  };

  if (!supportAttach) {
    return (
      <textarea
        value={value}
        onChange={onChange}
        onKeyDown={(e) => handleChatComposeKeyDown(e, onSend)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={className}
        style={{ flex: 1, minWidth: 0, ...style }}
        {...rest}
      />
    );
  }

  return (
    <div className="chat-compose-attach-wrap" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {attachments.length > 0 && (
        <div className="chat-compose-chips" aria-label="Attachments">
          {attachments.map((f, i) => (
            <span key={`${f.name}-${f.size}-${i}`} className="chat-compose-chip">
              <span className="chat-compose-chip-icon" aria-hidden>
                {String(f.type || '').startsWith('image/') ? 'IMG' : 'DOC'}
              </span>
              <span className="chat-compose-chip-name" title={f.name}>
                {f.name}
              </span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={disabled}
                aria-label={`Remove ${f.name}`}
                className="chat-compose-chip-remove"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div
        className={`chat-compose-shell${dragOver ? ' is-dragover' : ''}${disabled ? ' is-disabled' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <textarea
          value={value}
          onChange={onChange}
          onKeyDown={(e) => handleChatComposeKeyDown(e, onSend)}
          onPaste={(e) => {
            const items = e.clipboardData?.files;
            if (items?.length) addFiles(items);
          }}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className={className}
          style={{
            flex: 1,
            minWidth: 0,
            width: '100%',
            border: 'none',
            background: 'transparent',
            boxShadow: 'none',
            outline: 'none',
            resize: 'vertical',
            ...style,
            borderRadius: 0,
            padding: '0.65rem 0.75rem 0.35rem',
            minHeight: style?.minHeight || 56,
          }}
          {...rest}
        />
        <div className="chat-compose-toolbar">
          <button
            type="button"
            className="chat-attach-icon-btn"
            disabled={disabled}
            title="Attach image or document"
            aria-label="Attach image or document"
            onClick={() => fileRef.current?.click()}
          >
            <svg
              className="chat-attach-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            {attachments.length > 0 && (
              <span className="chat-attach-badge" aria-hidden>
                {attachments.length > 9 ? '9+' : attachments.length}
              </span>
            )}
          </button>
          <span className="chat-compose-hint">
            {dragOver ? 'Drop files to attach' : 'Paperclip or drop files · Shift+Enter for new line'}
          </span>
        </div>
      </div>
    </div>
  );
}
