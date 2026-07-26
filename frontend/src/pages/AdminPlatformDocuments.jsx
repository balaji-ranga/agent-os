import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { RequireAuth } from '../context/AuthContext';

const DOC_PAGE_SIZE = 15;

function AdminPlatformDocumentsPanel() {
  const [documents, setDocuments] = useState([]);
  const [docPage, setDocPage] = useState(0);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docTags, setDocTags] = useState('platform-help');
  const [queryText, setQueryText] = useState('');
  const [ragResult, setRagResult] = useState(null);
  const [osConsoleBusy, setOsConsoleBusy] = useState(false);

  const refresh = async () => {
    const d = await api.adminPlatformDocuments();
    setDocuments(d.documents || []);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  const flash = (msg) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 5000);
  };

  const openOsConsole = async () => {
    setOsConsoleBusy(true);
    try {
      const data = await api.opensearchConsoleLaunch();
      const url = data.console_url || data.url || '/opensearch/';
      const popup = window.open(url, 'aos-opensearch', 'noopener,noreferrer');
      if (!popup) window.location.assign(data.url || url);
    } catch (e) {
      setError(e.message || 'Failed to launch OpenSearch console');
    } finally {
      setOsConsoleBusy(false);
    }
  };

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const contentBase64 = btoa(binary);
      const tags = docTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await api.adminPlatformDocumentUpload({
        title: docTitle.trim() || file.name,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        contentBase64,
        tags,
      });
      setDocTitle('');
      await refresh();
      flash(`Uploaded ${file.name}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const seedHelp = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.adminPlatformDocumentsSeedHelp();
      await refresh();
      flash(
        `Seeded platform help: created=${r.created || 0} updated=${r.updated || 0} skipped=${r.skipped || 0}`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reindexAll = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.adminPlatformDocumentsReindexAll();
      await refresh();
      flash(`Reindexed ${r.reindexed || 0}/${r.total || 0}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteDoc = async (id, title) => {
    if (!window.confirm(`Delete platform document "${title || id}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminPlatformDocumentDelete(id);
      await refresh();
      flash('Deleted');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const runRag = async (e) => {
    e.preventDefault();
    if (!queryText.trim()) return;
    setBusy(true);
    setError(null);
    setRagResult(null);
    try {
      const r = await api.adminPlatformDocumentsRag({
        query: queryText.trim(),
        topK: 5,
        summarize: true,
      });
      setRagResult(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil(documents.length / DOC_PAGE_SIZE));
  const safePage = Math.min(docPage, pageCount - 1);
  const pageDocs = documents.slice(safePage * DOC_PAGE_SIZE, safePage * DOC_PAGE_SIZE + DOC_PAGE_SIZE);

  return (
    <div className="mcp-pg">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <h1 style={{ margin: 0 }}>Documents RAG</h1>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="wf-btn" disabled={osConsoleBusy} onClick={openOsConsole}>
            {osConsoleBusy ? 'Opening…' : 'OpenSearch console'}
          </button>
          <Link to="/admin" className="wf-btn">
            Admin
          </Link>
        </div>
      </div>

      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Manage the platform document index (help, README, and other platform docs). User Master Data
        documents stay in each CEO&apos;s isolated OpenSearch indices.
      </p>

      {error && (
        <div className="error" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      {message && (
        <div style={{ marginBottom: '1rem', color: 'var(--success, #2a7)' }}>{message}</div>
      )}

      <section
        style={{
          marginBottom: '1.5rem',
          padding: '1rem',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
        }}
      >
        <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.1rem' }}>Upload / seed</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem' }}>
            Title
            <input
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="Optional title"
              style={{ minWidth: 180 }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem' }}>
            Tags (comma)
            <input value={docTags} onChange={(e) => setDocTags(e.target.value)} style={{ minWidth: 160 }} />
          </label>
          <label className="wf-btn" style={{ cursor: busy ? 'wait' : 'pointer' }}>
            Upload file
            <input type="file" hidden disabled={busy} onChange={onUpload} />
          </label>
          <button type="button" className="wf-btn" disabled={busy} onClick={seedHelp}>
            Seed platform help
          </button>
          <button type="button" className="wf-btn" disabled={busy} onClick={reindexAll}>
            Reindex all
          </button>
        </div>
      </section>

      <section
        style={{
          marginBottom: '1.5rem',
          padding: '1rem',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
        }}
      >
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>
          Platform documents ({documents.length})
        </h2>
        {documents.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No platform documents yet. Seed help or upload.</p>
        ) : (
          <>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {pageDocs.map((d) => (
                <li
                  key={d.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    padding: '0.5rem 0',
                    borderBottom: '1px solid var(--border)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <strong>{d.title || d.filename}</strong>
                    <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                      {d.filename} · {d.chunk_count || 0} chunks
                      {Array.isArray(d.tags) && d.tags.length ? ` · tags: ${d.tags.join(', ')}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="wf-btn wf-btn-danger"
                    disabled={busy}
                    onClick={() => deleteDoc(d.id, d.title)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            {pageCount > 1 && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className="wf-btn"
                  disabled={safePage <= 0}
                  onClick={() => setDocPage((p) => Math.max(0, p - 1))}
                >
                  Prev
                </button>
                <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                  Page {safePage + 1}/{pageCount}
                </span>
                <button
                  type="button"
                  className="wf-btn"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setDocPage((p) => Math.min(pageCount - 1, p + 1))}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section
        style={{
          marginBottom: '1.5rem',
          padding: '1rem',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
        }}
      >
        <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.1rem' }}>RAG query (platform index)</h2>
        <form onSubmit={runRag} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="Ask about platform help…"
            style={{ flex: '1 1 240px' }}
          />
          <button type="submit" className="wf-btn" disabled={busy || !queryText.trim()}>
            Search
          </button>
        </form>
        {ragResult && (
          <div style={{ marginTop: '1rem' }}>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: '0.9rem',
                background: 'var(--bg)',
                padding: '0.75rem',
                borderRadius: 6,
                maxHeight: 360,
                overflow: 'auto',
              }}
            >
              {ragResult.text || ragResult.summary || JSON.stringify(ragResult, null, 2)}
            </pre>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
              Hits: {ragResult.hit_count ?? (ragResult.chunks || []).length}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default function AdminPlatformDocuments() {
  return (
    <RequireAuth>
      <AdminPlatformDocumentsPanel />
    </RequireAuth>
  );
}
