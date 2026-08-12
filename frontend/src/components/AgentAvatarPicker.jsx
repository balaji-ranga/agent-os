import { useRef, useState } from 'react';
import RobotAvatar, { fileToDataUrl } from './RobotAvatar.jsx';

/**
 * Shared icon/image picker for Hire AI employee and Agent Exchange publish.
 * Empty value uses the default robot icon in the UI.
 */
export default function AgentAvatarPicker({
  value = '',
  name = '',
  onChange,
  disabled = false,
  size = 56,
  label = 'Icon or image',
}) {
  const inputRef = useRef(null);
  const [error, setError] = useState(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      onChange?.(dataUrl);
    } catch (err) {
      setError(err.message || 'Could not read image');
    }
  };

  return (
    <div className="agent-avatar-picker">
      <span className="agent-avatar-picker-label">{label}</span>
      <div className="agent-avatar-picker-row">
        <RobotAvatar src={value} name={name} size={size} />
        <div className="agent-avatar-picker-actions">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={onFile}
            disabled={disabled}
          />
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            {value ? 'Change image' : 'Choose image'}
          </button>
          {value ? (
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={disabled}
              onClick={() => {
                setError(null);
                onChange?.('');
              }}
            >
              Use default icon
            </button>
          ) : (
            <span className="page-muted" style={{ fontSize: '0.8rem' }}>
              Default robot icon if none selected
            </span>
          )}
        </div>
      </div>
      {error && (
        <p className="page-muted" style={{ color: '#f87171', margin: '0.35rem 0 0', fontSize: '0.8rem' }}>
          {error}
        </p>
      )}
    </div>
  );
}
