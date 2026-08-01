import { useState, useEffect } from 'react';
import { api } from '../api';
import { resolveMediaSrc } from '../utils/resolveMediaSrc';
import { isAuthenticatedApiPath, normalizeApiPath } from '../utils/authenticatedApiUrl';
import AuthenticatedApiLink from './AuthenticatedApiLink';

/**
 * Inline image that loads /api/media (and similar) via Bearer → blob URL.
 * Public http(s) / data: URLs load directly.
 */
export default function AuthenticatedMediaImage({
  src,
  alt = 'Image',
  maxHeight = 480,
  className = 'chat-inline-media',
}) {
  const resolved = resolveMediaSrc(src);
  const needsAuth = isAuthenticatedApiPath(normalizeApiPath(resolved));
  const [blobUrl, setBlobUrl] = useState(null);
  const [error, setError] = useState(null);
  const [directFailed, setDirectFailed] = useState(false);

  useEffect(() => {
    if (!needsAuth) return undefined;
    let objectUrl;
    let cancelled = false;
    setBlobUrl(null);
    setError(null);
    api
      .fetchBlobUrl(normalizeApiPath(resolved))
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setBlobUrl(u);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'Failed to load image');
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resolved, needsAuth]);

  if (needsAuth) {
    if (error) {
      return (
        <span className={className} style={{ display: 'inline-block', margin: '0.5rem 0' }}>
          <AuthenticatedApiLink href={resolved} style={{ fontSize: '0.9rem' }}>
            Open image
          </AuthenticatedApiLink>
          <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginTop: 4 }}>
            {error}
          </span>
        </span>
      );
    }
    if (!blobUrl) {
      return (
        <span className={className} style={{ display: 'block', margin: '0.5rem 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
          Loading image…
        </span>
      );
    }
    return (
      <span className={className} style={{ display: 'block', margin: '0.5rem 0' }}>
        <img
          src={blobUrl}
          alt={alt}
          style={{ maxWidth: '100%', maxHeight, height: 'auto', borderRadius: 8, verticalAlign: 'middle' }}
        />
        <span style={{ display: 'block', marginTop: 6 }}>
          <AuthenticatedApiLink href={resolved} style={{ fontSize: '0.8rem' }}>
            Open full size
          </AuthenticatedApiLink>
        </span>
      </span>
    );
  }

  if (directFailed) {
    return (
      <span className={className} style={{ display: 'inline-block', margin: '0.5rem 0' }}>
        <a href={resolved} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.9rem', color: 'var(--accent)' }}>
          Open image
        </a>
      </span>
    );
  }

  return (
    <span className={className} style={{ display: 'block', margin: '0.5rem 0' }}>
      <img
        src={resolved}
        alt={alt}
        style={{ maxWidth: '100%', maxHeight, height: 'auto', borderRadius: 8, verticalAlign: 'middle' }}
        onError={() => setDirectFailed(true)}
      />
    </span>
  );
}

/** Audio for authenticated /api/media paths (TTS, uploads). */
export function AuthenticatedMediaAudio({ src, className = 'chat-inline-media' }) {
  const resolved = resolveMediaSrc(src);
  const needsAuth = isAuthenticatedApiPath(normalizeApiPath(resolved));
  const [blobUrl, setBlobUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!needsAuth) return undefined;
    let objectUrl;
    let cancelled = false;
    setBlobUrl(null);
    setError(null);
    api
      .fetchBlobUrl(normalizeApiPath(resolved))
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setBlobUrl(u);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'Failed to load audio');
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resolved, needsAuth]);

  if (needsAuth) {
    if (error) {
      return (
        <span className={className} style={{ display: 'inline-block', margin: '0.5rem 0' }}>
          <AuthenticatedApiLink href={resolved}>Open audio</AuthenticatedApiLink>
          <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted)', marginTop: 4 }}>
            {error}
          </span>
        </span>
      );
    }
    if (!blobUrl) {
      return (
        <span className={className} style={{ display: 'block', margin: '0.5rem 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
          Loading audio…
        </span>
      );
    }
    return (
      <span className={className} style={{ display: 'block', margin: '0.5rem 0' }}>
        <audio src={blobUrl} controls preload="metadata" style={{ width: '100%', maxWidth: 480 }} />
      </span>
    );
  }

  return (
    <span className={className} style={{ display: 'block', margin: '0.5rem 0' }}>
      <audio src={resolved} controls preload="metadata" style={{ width: '100%', maxWidth: 480 }} />
    </span>
  );
}

/** Video for authenticated /api/media paths. */
export function AuthenticatedMediaVideo({ src, maxHeight = 480, className = 'chat-inline-media' }) {
  const resolved = resolveMediaSrc(src);
  const needsAuth = isAuthenticatedApiPath(normalizeApiPath(resolved));
  const [blobUrl, setBlobUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!needsAuth) return undefined;
    let objectUrl;
    let cancelled = false;
    api
      .fetchBlobUrl(normalizeApiPath(resolved))
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setBlobUrl(u);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'Failed to load video');
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resolved, needsAuth]);

  if (needsAuth) {
    if (error) {
      return (
        <span className={className} style={{ display: 'inline-block', margin: '0.5rem 0' }}>
          <AuthenticatedApiLink href={resolved}>Open video</AuthenticatedApiLink>
        </span>
      );
    }
    if (!blobUrl) {
      return (
        <span className={className} style={{ display: 'block', margin: '0.5rem 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
          Loading video…
        </span>
      );
    }
    return (
      <span className={className} style={{ display: 'block', margin: '0.5rem 0' }}>
        <video src={blobUrl} controls style={{ maxWidth: '100%', maxHeight, borderRadius: 8 }} />
      </span>
    );
  }

  return (
    <span className={className} style={{ display: 'block', margin: '0.5rem 0' }}>
      <video src={resolved} controls style={{ maxWidth: '100%', maxHeight, borderRadius: 8 }} />
    </span>
  );
}
