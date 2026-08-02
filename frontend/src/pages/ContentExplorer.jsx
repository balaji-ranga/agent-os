import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const KIND_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'uploaded', label: 'Uploaded' },
  { id: 'generated', label: 'Generated' },
];

const CHANNEL_FILTERS = [
  { id: 'all', label: 'Any channel' },
  { id: 'web', label: 'Web chat' },
  { id: 'whatsapp_or_telegram', label: 'WhatsApp / Telegram' },
  { id: 'agent', label: 'Generated' },
];

const MEDIA_KIND_FILTERS = [
  { id: 'all', label: 'Any type' },
  { id: 'image', label: 'Images' },
  { id: 'audio', label: 'Audio' },
  { id: 'video', label: 'Video' },
  { id: 'document', label: 'Docs' },
  { id: 'file', label: 'Other' },
];

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

function kindIcon(kind) {
  if (kind === 'audio') return 'Audio';
  if (kind === 'video') return 'Video';
  if (kind === 'image') return 'Image';
  if (kind === 'document') return 'Doc';
  return 'File';
}

function itemKey(it) {
  return `${it.source}:${it.relative_path}`;
}

export default function ContentExplorer() {
  const [source, setSource] = useState('all');
  const [channel, setChannel] = useState('all');
  const [mediaKind, setMediaKind] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(() => new Set());

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const out = await api.contentExplorerList({ source });
      setData(out);
      setSelected(new Set());
    } catch (e) {
      setError(e?.message || 'Failed to load content');
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [source]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const items = useMemo(() => {
    let list = Array.isArray(data?.items) ? data.items : [];
    if (channel !== 'all') {
      list = list.filter((it) => String(it.channel || '') === channel);
    }
    if (mediaKind !== 'all') {
      list = list.filter((it) => String(it.kind || '') === mediaKind);
    }
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (it) =>
        String(it.filename || '').toLowerCase().includes(needle) ||
        String(it.relative_path || '').toLowerCase().includes(needle) ||
        String(it.channel || '').toLowerCase().includes(needle) ||
        String(it.kind || '').toLowerCase().includes(needle)
    );
  }, [data, q, channel, mediaKind]);

  const allVisibleSelected = items.length > 0 && items.every((it) => selected.has(itemKey(it)));

  function toggleOne(it) {
    const k = itemKey(it);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const it of items) next.delete(itemKey(it));
      } else {
        for (const it of items) next.add(itemKey(it));
      }
      return next;
    });
  }

  async function openPreview(item) {
    setPreview({ item, objectUrl: null, loading: true, err: '' });
    try {
      const blobUrl = await api.contentExplorerDownloadBlob(item);
      setPreview({ item, objectUrl: blobUrl, loading: false, err: '' });
    } catch (e) {
      setPreview({ item, objectUrl: null, loading: false, err: e?.message || 'Preview failed' });
    }
  }

  useEffect(() => {
    return () => {
      if (preview?.objectUrl) URL.revokeObjectURL(preview.objectUrl);
    };
  }, [preview?.objectUrl]);

  async function deleteSelected() {
    const list = (data?.items || []).filter((it) => selected.has(itemKey(it)));
    if (!list.length) return;
    const ok = window.confirm(
      `Permanently delete ${list.length} file(s) from disk?\nThis cannot be undone (no recycle bin).`
    );
    if (!ok) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const out = await api.contentExplorerDelete({
        items: list.map((it) => ({ kind: it.source, path: it.relative_path })),
      });
      setMessage(`Deleted ${out?.deleted?.total ?? list.length} file(s).`);
      await refresh();
    } catch (e) {
      setError(e?.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAllInView() {
    const label = source === 'all' ? 'all uploaded and generated' : source;
    const ok = window.confirm(
      `Permanently delete ${label} media for your account from disk?\nThis cannot be undone (no recycle bin).`
    );
    if (!ok) return;
    const ok2 = window.confirm('Confirm hard delete of all matching files?');
    if (!ok2) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const out = await api.contentExplorerDelete({ all: true, source });
      setMessage(`Deleted ${out?.deleted?.total ?? 0} file(s).`);
      await refresh();
    } catch (e) {
      setError(e?.message || 'Delete all failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mcp-pg">
      <Link to="/" style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
        ← Dashboard
      </Link>
      <h1 style={{ margin: '0.5rem 0 0.25rem' }}>Content Explorer</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0, maxWidth: 760 }}>
        Browse <strong>your</strong> media: uploads under <code>inbound/attachments</code>, and
        agent-generated files under <code>media/generated/&lt;you&gt;/</code>. Chat paperclip files
        show as channel <strong>web</strong> — use the Web chat filter or search the filename.
        Delete permanently removes files from disk (no recycle bin). Aged files are also removed by
        Profile data retention.
      </p>

      {error && <div style={{ color: '#f87171', marginBottom: '0.75rem' }}>{error}</div>}
      {message && <div style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>{message}</div>}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          marginBottom: '1rem',
        }}
      >
        {KIND_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setSource(f.id)}
            style={{
              padding: '0.4rem 0.75rem',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: source === f.id ? 'var(--accent)' : 'var(--surface)',
              color: source === f.id ? '#fff' : 'var(--text)',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            {f.label}
            {data?.counts
              ? ` (${f.id === 'all' ? data.counts.total : data.counts[f.id] ?? 0})`
              : ''}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by name…"
          style={{
            flex: '1 1 180px',
            minWidth: 160,
            padding: '0.45rem 0.6rem',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
          }}
        />
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          aria-label="Channel filter"
          style={{
            padding: '0.45rem 0.6rem',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: '0.85rem',
          }}
        >
          {CHANNEL_FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          value={mediaKind}
          onChange={(e) => setMediaKind(e.target.value)}
          aria-label="Media type filter"
          style={{
            padding: '0.45rem 0.6rem',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: '0.85rem',
          }}
        >
          {MEDIA_KIND_FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={refresh}
          style={{
            padding: '0.4rem 0.75rem',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
            cursor: 'pointer',
          }}
        >
          {busy ? 'Loading…' : 'Refresh'}
        </button>
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={deleteSelected}
          style={{
            padding: '0.4rem 0.75rem',
            borderRadius: 6,
            border: '1px solid #b91c1c',
            background: 'transparent',
            color: '#b91c1c',
            cursor: selected.size ? 'pointer' : 'not-allowed',
            opacity: selected.size ? 1 : 0.5,
            fontSize: '0.85rem',
          }}
        >
          Delete selected ({selected.size})
        </button>
        <button
          type="button"
          disabled={busy || !(data?.counts?.total > 0)}
          onClick={deleteAllInView}
          style={{
            padding: '0.4rem 0.75rem',
            borderRadius: 6,
            border: '1px solid #7f1d1d',
            background: '#7f1d1d',
            color: '#fff',
            cursor: data?.counts?.total ? 'pointer' : 'not-allowed',
            opacity: data?.counts?.total ? 1 : 0.5,
            fontSize: '0.85rem',
          }}
        >
          Delete all{source !== 'all' ? ` ${source}` : ''}
        </button>
      </div>

      {data?.folders && (
        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 0 }}>
          Uploaded: {data.folders.uploaded}
          <br />
          Generated: {data.folders.generated}
        </p>
      )}

      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '0.65rem 0.5rem', width: 36 }}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  disabled={!items.length}
                  aria-label="Select all visible"
                />
              </th>
              <th style={{ padding: '0.65rem 0.75rem' }}>Type</th>
              <th style={{ padding: '0.65rem 0.75rem' }}>Name</th>
              <th style={{ padding: '0.65rem 0.75rem' }}>Source</th>
              <th style={{ padding: '0.65rem 0.75rem' }}>Size</th>
              <th style={{ padding: '0.65rem 0.75rem' }}>Updated</th>
              <th style={{ padding: '0.65rem 0.75rem' }} />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '0.55rem 0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={selected.has(itemKey(it))}
                    onChange={() => toggleOne(it)}
                    aria-label={`Select ${it.filename}`}
                  />
                </td>
                <td style={{ padding: '0.55rem 0.75rem', color: 'var(--muted)' }}>
                  {kindIcon(it.kind)}
                </td>
                <td style={{ padding: '0.55rem 0.75rem' }}>
                  <div style={{ fontWeight: 500 }}>{it.filename}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted)', wordBreak: 'break-all' }}>
                    {it.relative_path}
                  </div>
                </td>
                <td style={{ padding: '0.55rem 0.75rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
                  {it.source}
                  {it.channel ? ` · ${it.channel}` : ''}
                  {it.legacy_flat ? ' · legacy' : ''}
                </td>
                <td style={{ padding: '0.55rem 0.75rem', color: 'var(--muted)' }}>
                  {formatBytes(it.size)}
                </td>
                <td style={{ padding: '0.55rem 0.75rem', color: 'var(--muted)', fontSize: '0.8rem' }}>
                  {it.mtime ? new Date(it.mtime).toLocaleString() : '—'}
                </td>
                <td style={{ padding: '0.55rem 0.75rem', whiteSpace: 'nowrap' }}>
                  <button
                    type="button"
                    onClick={() => openPreview(it)}
                    style={{
                      marginRight: 6,
                      padding: '0.25rem 0.5rem',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: 'var(--accent)',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                    }}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={7} style={{ padding: '1.25rem', color: 'var(--muted)' }}>
                  {busy ? 'Loading…' : 'No files in this view yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 80,
            padding: 16,
          }}
          onClick={() => {
            if (preview.objectUrl) URL.revokeObjectURL(preview.objectUrl);
            setPreview(null);
          }}
        >
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '1rem',
              maxWidth: 'min(920px, 100%)',
              maxHeight: '90vh',
              overflow: 'auto',
              width: '100%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
              <strong style={{ wordBreak: 'break-all' }}>{preview.item.filename}</strong>
              <button
                type="button"
                onClick={() => {
                  if (preview.objectUrl) URL.revokeObjectURL(preview.objectUrl);
                  setPreview(null);
                }}
                style={{
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: 'var(--text)',
                }}
              >
                Close
              </button>
            </div>
            {preview.loading && <p style={{ color: 'var(--muted)' }}>Loading preview…</p>}
            {preview.err && <p style={{ color: '#f87171' }}>{preview.err}</p>}
            {preview.objectUrl && preview.item.kind === 'image' && (
              <img
                src={preview.objectUrl}
                alt={preview.item.filename}
                style={{ maxWidth: '100%', borderRadius: 8 }}
              />
            )}
            {preview.objectUrl && preview.item.kind === 'audio' && (
              <audio controls src={preview.objectUrl} style={{ width: '100%' }} />
            )}
            {preview.objectUrl && preview.item.kind === 'video' && (
              <video controls src={preview.objectUrl} style={{ width: '100%', maxHeight: '70vh' }} />
            )}
            {preview.objectUrl && !['image', 'audio', 'video'].includes(preview.item.kind) && (
              <p style={{ color: 'var(--muted)' }}>
                Preview not available for this type.{' '}
                <a href={preview.objectUrl} download={preview.item.filename}>
                  Download
                </a>
              </p>
            )}
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 12 }}>
              {preview.item.relative_path}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}