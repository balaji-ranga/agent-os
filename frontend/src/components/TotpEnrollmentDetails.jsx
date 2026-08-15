import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

function formatSecurityKey(secret) {
  return String(secret || '')
    .replace(/\s/g, '')
    .toUpperCase()
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

/**
 * First-login / register TOTP enrollment: scannable QR plus the security key
 * for manual authenticator entry.
 */
export default function TotpEnrollmentDetails({ secret, otpauthUrl }) {
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [qrError, setQrError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!otpauthUrl) {
      setQrDataUrl(null);
      setQrError(null);
      return undefined;
    }
    let cancelled = false;
    QRCode.toDataURL(otpauthUrl, {
      width: 220,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) {
          setQrDataUrl(url);
          setQrError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setQrDataUrl(null);
          setQrError(err?.message || 'Could not generate QR');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [otpauthUrl]);

  const copyKey = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(String(secret).replace(/\s/g, ''));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (!secret && !otpauthUrl) return null;

  return (
    <div
      style={{
        marginBottom: '1.25rem',
        padding: '1rem',
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--surface)',
      }}
    >
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: 'var(--muted)' }}>
        Scan this QR with your authenticator app, or enter the security key manually. Then type the
        6-digit code below.
      </p>
      {qrDataUrl ? (
        <div style={{ textAlign: 'center', marginBottom: '0.85rem' }}>
          <img
            src={qrDataUrl}
            alt="Authenticator QR code"
            width={220}
            height={220}
            style={{
              width: 220,
              height: 220,
              background: '#fff',
              padding: 8,
              borderRadius: 8,
              display: 'inline-block',
            }}
          />
        </div>
      ) : qrError ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
          QR could not be drawn. Use the security key or the authenticator link below.
        </p>
      ) : otpauthUrl ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
          Preparing QR…
        </p>
      ) : null}
      {secret ? (
        <div style={{ marginBottom: otpauthUrl ? '0.65rem' : 0 }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: 4 }}>Security key</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <code
              style={{
                flex: 1,
                wordBreak: 'break-all',
                fontSize: '0.85rem',
                lineHeight: 1.5,
              }}
            >
              {formatSecurityKey(secret)}
            </code>
            <button
              type="button"
              onClick={copyKey}
              style={{
                flexShrink: 0,
                padding: '0.3rem 0.55rem',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text)',
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : null}
      {otpauthUrl ? (
        <a href={otpauthUrl} style={{ fontSize: '0.85rem' }}>
          Open authenticator link
        </a>
      ) : null}
    </div>
  );
}
