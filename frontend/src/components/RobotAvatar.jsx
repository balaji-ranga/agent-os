import { useState } from 'react';

/** Default robotic agent icon (SVG). Used when no custom avatar_image is set. */
export function RobotIcon({ size = 32, className = '' }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
    >
      <rect x="10" y="14" width="28" height="24" rx="6" fill="#6366f1" />
      <rect x="16" y="20" width="6" height="6" rx="2" fill="#fff" />
      <rect x="26" y="20" width="6" height="6" rx="2" fill="#fff" />
      <rect x="18" y="30" width="12" height="3" rx="1.5" fill="#c7d2fe" />
      <rect x="21" y="6" width="6" height="8" rx="2" fill="#818cf8" />
      <circle cx="24" cy="6" r="3" fill="#a5b4fc" />
      <rect x="6" y="22" width="4" height="10" rx="2" fill="#818cf8" />
      <rect x="38" y="22" width="4" height="10" rx="2" fill="#818cf8" />
    </svg>
  );
}

/**
 * Circular avatar: user photo, agent photo, or default robot (agents) / initials (users).
 */
export default function RobotAvatar({
  src,
  name = '',
  size = 36,
  variant = 'agent',
  status,
  className = '',
  alt,
}) {
  const [imgError, setImgError] = useState(false);
  const initials = (() => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return variant === 'user' ? '?' : '';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  })();
  const showImg = src && !imgError;
  const style = {
    width: size,
    height: size,
    borderRadius: '50%',
    overflow: 'hidden',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    background: showImg ? 'var(--surface)' : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
    color: '#fff',
    fontSize: Math.max(10, Math.round(size * 0.34)),
    fontWeight: 650,
  };

  return (
    <span className={`robot-avatar ${className}`.trim()} style={style} title={name || undefined}>
      {showImg ? (
        <img
          src={src}
          alt={alt || name || 'Avatar'}
          onError={() => setImgError(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : variant === 'user' && initials ? (
        <span aria-hidden>{initials}</span>
      ) : (
        <RobotIcon size={Math.round(size * 0.72)} />
      )}
      {status && (
        <span
          className={`robot-avatar-status robot-avatar-status-${status}`}
          aria-hidden
        />
      )}
    </span>
  );
}

export function fileToDataUrl(file, maxBytes = 450_000) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('Choose an image file (PNG, JPEG, WebP, or GIF)'));
      return;
    }
    if (file.size > maxBytes) {
      reject(new Error('Image is too large (max ~450KB). Compress or crop first.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}
