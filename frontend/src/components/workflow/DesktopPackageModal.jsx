/**
 * Manage desktop package IP whitelist + token list; confirm then download Windows zip.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api';

const PACKAGE_OPTIONS = {
  lite: {
    id: 'lite',
    title: 'Without Node runtime (smaller)',
    approx: '~50 KB',
    includeRuntime: false,
    items: [
      'Run-Workflow.ps1 — launcher',
      'runner/ — local orchestrator (no npm packages)',
      'workflow.params.json — graph + desktop API token',
      'README-DESKTOP.txt',
    ],
    note: 'Requires Node.js 18+ already installed on the laptop (on PATH).',
  },
  full: {
    id: 'full',
    title: 'With Node 18 runtime (recommended)',
    approx: '~27 MB',
    includeRuntime: true,
    items: [
      'Everything in the lite package',
      'runtime/node.exe — portable Node.js 18.20.8 (Windows x64)',
      'runtime/NODE_VERSION.txt + README',
    ],
    note: 'No system Node/npm install required. PS1 uses runtime\\node.exe.',
  },
};

export default function DesktopPackageModal({ workflowId, workflowName, open, onClose }) {
  const [tokens, setTokens] = useState([]);
  const [entries, setEntries] = useState([]);
  const [ip, setIp] = useState('');
  const [label, setLabel] = useState('');
  const [scopeOwner, setScopeOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [packageChoice, setPackageChoice] = useState('full');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = async () => {
    if (!workflowId) return;
    setError('');
    try {
      const [t, w] = await Promise.all([
        api.agentWorkflowDesktopTokens(workflowId),
        api.agentWorkflowDesktopIpWhitelist(workflowId),
      ]);
      setTokens(t.tokens || []);
      setEntries(w.entries || []);
    } catch (e) {
      setError(e.message || 'Failed to load desktop settings');
    }
  };

  useEffect(() => {
    if (open) {
      load();
      setConfirmOpen(false);
      setInfo('');
      setError('');
    }
  }, [open, workflowId]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const selected = PACKAGE_OPTIONS[packageChoice] || PACKAGE_OPTIONS.full;

  const confirmAndDownload = async () => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await api.agentWorkflowDesktopPackageDownload(workflowId, workflowName, {
        includeRuntime: selected.includeRuntime,
      });
      setConfirmOpen(false);
      setInfo(
        selected.includeRuntime
          ? 'Package with Node runtime downloaded. A new desktop token was minted into workflow.params.json.'
          : 'Lite package downloaded (no Node runtime). A new desktop token was minted. Ensure Node 18+ is on PATH.'
      );
      await load();
    } catch (e) {
      setError(e.message || 'Download failed');
    } finally {
      setBusy(false);
    }
  };

  const addIp = async () => {
    setBusy(true);
    setError('');
    try {
      await api.agentWorkflowDesktopIpWhitelistAdd(workflowId, {
        cidr_or_ip: ip.trim(),
        label: label.trim(),
        scope: scopeOwner ? 'owner' : 'workflow',
      });
      setIp('');
      setLabel('');
      await load();
    } catch (e) {
      setError(e.message || 'Add IP failed');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="wf-a2a-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="wf-a2a-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <header className="wf-a2a-modal-header">
          <div>
            <h2>Download for Windows</h2>
            <p className="wf-a2a-modal-sub">
              Localhost API and filesystem run on the laptop; other nodes and run state use Flolah.
              Choose a package size, review contents, then confirm to download.
            </p>
          </div>
          <button type="button" className="wf-a2a-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="wf-a2a-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {error && <div className="wf-a2a-modal-live">{error}</div>}
          {info && <div className="wf-a2a-modal-live">{info}</div>}

          <fieldset
            style={{
              border: '1px solid var(--border, #ccc)',
              borderRadius: 8,
              padding: '0.75rem 1rem',
              margin: 0,
            }}
          >
            <legend style={{ fontSize: '0.85rem', padding: '0 0.35rem' }}>Package type</legend>
            {Object.values(PACKAGE_OPTIONS).map((opt) => (
              <label
                key={opt.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                  marginBottom: 8,
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                <input
                  type="radio"
                  name="desktop-pkg"
                  checked={packageChoice === opt.id}
                  onChange={() => setPackageChoice(opt.id)}
                  disabled={busy}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong>{opt.title}</strong>
                  <span style={{ color: 'var(--muted)', marginLeft: 6 }}>({opt.approx})</span>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 2 }}>{opt.note}</div>
                </span>
              </label>
            ))}
          </fieldset>

          <button
            type="button"
            className="wf-btn-primary"
            disabled={busy}
            onClick={() => setConfirmOpen(true)}
          >
            Review &amp; download…
          </button>

          <h3 style={{ margin: '0.5rem 0 0', fontSize: '0.95rem' }}>IP whitelist</h3>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
            Empty = any client IP allowed. Add IPs/CIDRs to restrict desktop API calls.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="wf-run-input"
              placeholder="IP or CIDR"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              style={{ flex: 1, minWidth: 160 }}
            />
            <input
              className="wf-run-input"
              placeholder="Label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              style={{ width: 100 }}
            />
            <label style={{ fontSize: '0.8rem', display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={scopeOwner} onChange={(e) => setScopeOwner(e.target.checked)} />
              All my workflows
            </label>
            <button type="button" className="wf-btn" disabled={busy || !ip.trim()} onClick={addIp}>
              Add
            </button>
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem' }}>
            {entries.length === 0 && <li style={{ color: 'var(--muted)' }}>No IP rules</li>}
            {entries.map((e) => (
              <li key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                <code>{e.cidr_or_ip}</code>
                {e.label ? <span>· {e.label}</span> : null}
                <span style={{ color: 'var(--muted)' }}>{e.definition_id ? 'workflow' : 'owner'}</span>
                <button
                  type="button"
                  className="wf-btn"
                  style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api.agentWorkflowDesktopIpWhitelistRemove(workflowId, e.id);
                      await load();
                    } catch (err) {
                      setError(err.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <h3 style={{ margin: '0.5rem 0 0', fontSize: '0.95rem' }}>Desktop tokens</h3>
          <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem' }}>
            {tokens.length === 0 && <li style={{ color: 'var(--muted)' }}>None yet</li>}
            {tokens.map((t) => (
              <li key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                <code>{t.token_prefix}…</code>
                <span>{t.name}</span>
                {t.revoked_at ? (
                  <span style={{ color: 'var(--muted)' }}>revoked</span>
                ) : (
                  <button
                    type="button"
                    className="wf-btn"
                    style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api.agentWorkflowDesktopTokenRevoke(workflowId, t.id);
                        await load();
                      } catch (err) {
                        setError(err.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {confirmOpen && (
        <div
          className="wf-a2a-modal-backdrop"
          style={{ zIndex: 10001 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="desktop-dl-confirm-title"
          onClick={() => !busy && setConfirmOpen(false)}
        >
          <div
            className="wf-a2a-modal"
            style={{ maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="wf-a2a-modal-header">
              <div>
                <h2 id="desktop-dl-confirm-title">Confirm download</h2>
                <p className="wf-a2a-modal-sub">{selected.title}</p>
              </div>
              <button
                type="button"
                className="wf-a2a-modal-close"
                onClick={() => !busy && setConfirmOpen(false)}
                aria-label="Close"
                disabled={busy}
              >
                ×
              </button>
            </header>
            <div className="wf-a2a-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <p style={{ margin: 0, fontSize: '0.9rem' }}>
                This will download a zip (~{selected.approx.replace('~', '')}) containing:
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem' }}>
                {selected.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>{selected.note}</p>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
                A new desktop API token will be created and stored only inside{' '}
                <code>workflow.params.json</code> in the zip.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button
                  type="button"
                  className="wf-btn"
                  disabled={busy}
                  onClick={() => setConfirmOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="wf-btn-primary"
                  disabled={busy}
                  onClick={confirmAndDownload}
                >
                  {busy ? 'Downloading…' : 'Confirm & download'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
