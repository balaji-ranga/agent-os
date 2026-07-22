import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { RequireAuth } from '../context/AuthContext';

const PAGE_SIZE = 50;

function emptyRowDraft(columns = []) {
  const draft = {};
  for (const c of columns) draft[c] = '';
  return draft;
}

function MasterDataPanel() {
  const [tables, setTables] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [rows, setRows] = useState([]);
  const [rowTotal, setRowTotal] = useState(0);
  const [rowOffset, setRowOffset] = useState(0);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const [newTableName, setNewTableName] = useState('');
  const [newTablePurpose, setNewTablePurpose] = useState('');
  const [newTableCols, setNewTableCols] = useState('name, value');
  const [csvName, setCsvName] = useState('');
  const [csvPurpose, setCsvPurpose] = useState('');
  const [csvText, setCsvText] = useState('');
  const [tablePurposeDraft, setTablePurposeDraft] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [queryText, setQueryText] = useState('');
  const [ragResult, setRagResult] = useState(null);
  const [tableQuery, setTableQuery] = useState('');
  const [queryActive, setQueryActive] = useState(false);
  const [queryOffset, setQueryOffset] = useState(0);
  const [queryTotal, setQueryTotal] = useState(0);
  const [insertDraft, setInsertDraft] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({});

  const refresh = async () => {
    const [t, d] = await Promise.all([api.masterDataTables(), api.masterDataDocuments()]);
    setTables(t.tables || []);
    setDocuments(d.documents || []);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  const flash = (msg) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 5000);
  };

  const loadBrowsePage = async (id, offset = 0) => {
    const data = await api.masterDataTableGet(id, { limit: PAGE_SIZE, offset });
    setSelectedTable(data.table);
    setRows(data.rows || []);
    setRowTotal(data.total ?? (data.rows || []).length);
    setRowOffset(data.offset ?? offset);
    setInsertDraft(emptyRowDraft(data.table?.columns || []));
    setTablePurposeDraft(data.table?.description || '');
    setQueryActive(false);
    setQueryOffset(0);
    setQueryTotal(0);
    setEditingId(null);
  };

  const openTable = async (id) => {
    setBusy(true);
    setError(null);
    try {
      await loadBrowsePage(id, 0);
      setTableQuery('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const createTable = async (e) => {
    e.preventDefault();
    if (!newTableName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const columns = newTableCols
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      await api.masterDataTableCreate({
        name: newTableName.trim(),
        description: newTablePurpose.trim(),
        columns,
      });
      setNewTableName('');
      setNewTablePurpose('');
      await refresh();
      flash('Table created.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onCsvFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result || ''));
      if (!csvName) setCsvName(file.name.replace(/\.csv$/i, '') || 'Imported CSV');
    };
    reader.readAsText(file);
  };

  const importCsv = async (e) => {
    e.preventDefault();
    if (!csvText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.masterDataImportCsv({
        name: csvName.trim() || 'Imported CSV',
        description: csvPurpose.trim(),
        csvText,
      });
      setCsvText('');
      setCsvName('');
      setCsvPurpose('');
      await refresh();
      if (res.table?.id) await openTable(res.table.id);
      flash(`Imported ${res.imported} row(s).`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onDocFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      setBusy(true);
      setError(null);
      try {
        const dataUrl = String(reader.result || '');
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        await api.masterDataDocumentUpload({
          title: docTitle.trim() || file.name,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          contentBase64: base64,
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
    reader.readAsDataURL(file);
  };

  const runRag = async (e) => {
    e.preventDefault();
    if (!queryText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.masterDataRag({ query: queryText.trim(), topK: 5 });
      setRagResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const runTableQuery = async (e, offset = 0) => {
    if (e?.preventDefault) e.preventDefault();
    if (!selectedTable) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.masterDataTableQuery(selectedTable.id, {
        query: tableQuery,
        limit: PAGE_SIZE,
        offset,
      });
      setRows(res.rows || []);
      setQueryTotal(res.total ?? (res.rows || []).length);
      setQueryOffset(res.offset ?? offset);
      setQueryActive(true);
      setSelectedTable(res.table || selectedTable);
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const clearQuery = async () => {
    if (!selectedTable) return;
    setBusy(true);
    setError(null);
    try {
      setTableQuery('');
      await loadBrowsePage(selectedTable.id, 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const goBrowsePage = async (nextOffset) => {
    if (!selectedTable) return;
    setBusy(true);
    setError(null);
    try {
      await loadBrowsePage(selectedTable.id, Math.max(0, nextOffset));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const insertRow = async (e) => {
    e.preventDefault();
    if (!selectedTable) return;
    setBusy(true);
    setError(null);
    try {
      await api.masterDataRowInsert(selectedTable.id, insertDraft);
      await refresh();
      if (queryActive) await runTableQuery(null, 0);
      else await loadBrowsePage(selectedTable.id, 0);
      flash('Row inserted.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    const draft = emptyRowDraft(selectedTable?.columns || []);
    for (const c of selectedTable?.columns || []) draft[c] = String(row.data?.[c] ?? '');
    setEditDraft(draft);
  };

  const saveEdit = async (rowId) => {
    if (!selectedTable) return;
    setBusy(true);
    setError(null);
    try {
      await api.masterDataRowUpdate(selectedTable.id, rowId, editDraft);
      setEditingId(null);
      if (queryActive) await runTableQuery(null, queryOffset);
      else await loadBrowsePage(selectedTable.id, rowOffset);
      await refresh();
      flash('Row updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeRow = async (rowId) => {
    if (!selectedTable || !window.confirm('Delete this row?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.masterDataRowDelete(selectedTable.id, rowId);
      if (queryActive) await runTableQuery(null, queryOffset);
      else {
        const nextOffset = rowOffset > 0 && rows.length <= 1 ? Math.max(0, rowOffset - PAGE_SIZE) : rowOffset;
        await loadBrowsePage(selectedTable.id, nextOffset);
      }
      await refresh();
      flash('Row deleted.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const fieldStyle = {
    padding: '0.5rem 0.75rem',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    width: '100%',
  };

  const nameCounts = tables.reduce((acc, t) => {
    const key = String(t.name || '').trim().toLowerCase();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const hasDuplicateNames = Object.values(nameCounts).some((n) => n > 1);

  const columns = selectedTable?.columns || [];
  const pageTotal = queryActive ? queryTotal : rowTotal;
  const pageOffset = queryActive ? queryOffset : rowOffset;
  const pageStart = pageTotal === 0 ? 0 : pageOffset + 1;
  const pageEnd = Math.min(pageOffset + rows.length, pageTotal);
  const canPrev = pageOffset > 0;
  const canNext = pageOffset + PAGE_SIZE < pageTotal;

  const onPagePrev = () => {
    const next = Math.max(0, pageOffset - PAGE_SIZE);
    if (queryActive) runTableQuery(null, next);
    else goBrowsePage(next);
  };
  const onPageNext = () => {
    const next = pageOffset + PAGE_SIZE;
    if (queryActive) runTableQuery(null, next);
    else goBrowsePage(next);
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto' }}>
      <Link to="/" style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
        ← Dashboard
      </Link>
      <h1 style={{ margin: '0.5rem 0 0.25rem' }}>Master Data</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Create tables (with a purpose/description), upload CSV, and store documents under your tenant data folder.
        Agents can list tables and CRUD rows / RAG documents via content tools — scoped to your CEO only.
        Table schema alter/drop is not available to agents.
      </p>

      {error && <div style={{ color: '#f87171', marginBottom: '0.75rem' }}>{error}</div>}
      {message && <div style={{ color: '#22c55e', marginBottom: '0.75rem' }}>{message}</div>}
      {hasDuplicateNames && (
        <div style={{ color: '#fbbf24', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          Duplicate table names detected. Keep one and delete the extras — new tables must use unique names (case-insensitive).
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem' }}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Tables</h2>
          <form onSubmit={createTable} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1rem' }}>
            <input style={fieldStyle} placeholder="Table name" value={newTableName} onChange={(e) => setNewTableName(e.target.value)} />
            <textarea
              style={{ ...fieldStyle, minHeight: 56, resize: 'vertical' }}
              placeholder="Purpose / description (helps agents decide when to use this table)"
              value={newTablePurpose}
              onChange={(e) => setNewTablePurpose(e.target.value)}
            />
            <input style={fieldStyle} placeholder="Columns (comma-separated)" value={newTableCols} onChange={(e) => setNewTableCols(e.target.value)} />
            <button type="submit" disabled={busy} style={{ padding: '0.5rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff' }}>
              Create table
            </button>
          </form>

          <form onSubmit={importCsv} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1rem' }}>
            <strong style={{ fontSize: '0.85rem' }}>Upload CSV</strong>
            <input style={fieldStyle} placeholder="Import name" value={csvName} onChange={(e) => setCsvName(e.target.value)} />
            <textarea
              style={{ ...fieldStyle, minHeight: 48, resize: 'vertical' }}
              placeholder="Purpose / description (optional)"
              value={csvPurpose}
              onChange={(e) => setCsvPurpose(e.target.value)}
            />
            <input type="file" accept=".csv,text/csv" onChange={(e) => onCsvFile(e.target.files?.[0])} />
            <textarea style={{ ...fieldStyle, minHeight: 80, fontFamily: 'monospace', fontSize: '0.8rem' }} placeholder="Or paste CSV…" value={csvText} onChange={(e) => setCsvText(e.target.value)} />
            <button type="submit" disabled={busy || !csvText} style={{ padding: '0.5rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff' }}>
              Import CSV
            </button>
          </form>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {tables.map((t) => (
              <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                <button type="button" onClick={() => openTable(t.id)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                  {t.name}{' '}
                  {nameCounts[String(t.name || '').trim().toLowerCase()] > 1 && (
                    <span style={{ color: '#fbbf24', fontSize: '0.75rem' }}>(duplicate name)</span>
                  )}{' '}
                  <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>({t.row_count} rows)</span>
                  {t.description ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 2, maxWidth: 320 }}>
                      {t.description}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic' }}>No purpose set</div>
                  )}
                  <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{t.id}</div>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`Delete table ${t.name}?`)) return;
                    await api.masterDataTableDelete(t.id);
                    if (selectedTable?.id === t.id) {
                      setSelectedTable(null);
                      setRows([]);
                    }
                    await refresh();
                  }}
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--muted)', cursor: 'pointer', fontSize: '0.8rem' }}
                >
                  Delete
                </button>
              </li>
            ))}
            {!tables.length && <li style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>No tables yet.</li>}
          </ul>
        </section>

        <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem' }}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Documents</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1rem' }}>
            <input style={fieldStyle} placeholder="Title (optional)" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
            <input
              type="file"
              accept=".txt,.md,.csv,.json,.log,.html,.xml,.pdf,.docx,.xlsx,.xls,text/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(e) => onDocFile(e.target.files?.[0])}
            />
            <small style={{ color: 'var(--muted)' }}>
              PDF, Word (.docx), Excel (.xlsx/.xls), and text files are indexed for RAG. Legacy .doc is not supported — convert to .docx.
            </small>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <button
              type="button"
              disabled={busy || !documents.length}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const res = await api.masterDataDocumentsReindexAll();
                  await refresh();
                  flash(
                    `Reindexed ${res.reindexed || 0}/${res.total || 0} document(s)` +
                      (res.failed?.length ? ` (${res.failed.length} failed)` : '')
                  );
                } catch (err) {
                  setError(err.message);
                } finally {
                  setBusy(false);
                }
              }}
              style={{
                padding: '0.4rem 0.75rem',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text)',
                cursor: busy || !documents.length ? 'default' : 'pointer',
                fontSize: '0.8rem',
              }}
            >
              Reindex all for RAG
            </button>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, marginBottom: '1rem' }}>
            {documents.map((d) => (
              <li key={d.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600 }}>{d.title}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                  {d.filename} · {d.chunk_count} chunks · {d.id}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        await api.masterDataDocumentReindex(d.id);
                        await refresh();
                        flash(`Reindexed ${d.title}`);
                      } catch (err) {
                        setError(err.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--muted)', cursor: 'pointer', fontSize: '0.75rem' }}
                  >
                    Reindex
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`Delete ${d.title}?`)) return;
                      await api.masterDataDocumentDelete(d.id);
                      await refresh();
                    }}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--muted)', cursor: 'pointer', fontSize: '0.75rem' }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
            {!documents.length && <li style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>No documents yet.</li>}
          </ul>

          <form onSubmit={runRag} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <strong style={{ fontSize: '0.85rem' }}>RAG query</strong>
            <input style={fieldStyle} placeholder="Ask across your documents…" value={queryText} onChange={(e) => setQueryText(e.target.value)} />
            <button type="submit" disabled={busy || !queryText.trim()} style={{ padding: '0.5rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff' }}>
              Run RAG
            </button>
          </form>
          {ragResult && (
            <pre style={{ marginTop: '0.75rem', whiteSpace: 'pre-wrap', fontSize: '0.8rem', background: 'var(--bg, #121216)', padding: '0.75rem', borderRadius: 8, maxHeight: 240, overflow: 'auto' }}>
              {ragResult.summary || ragResult.text}
            </pre>
          )}
        </section>
      </div>

      {selectedTable && (
        <section style={{ marginTop: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem' }}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>
            {selectedTable.name}{' '}
            <code style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{selectedTable.id}</code>
          </h2>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                const res = await api.masterDataTableUpdate(selectedTable.id, {
                  description: tablePurposeDraft,
                });
                setSelectedTable(res.table);
                setTablePurposeDraft(res.table?.description || '');
                await refresh();
                flash('Table purpose saved.');
              } catch (err) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '0.75rem' }}
          >
            <label style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
              Purpose / description
              <textarea
                style={{ ...fieldStyle, marginTop: 4, minHeight: 64, resize: 'vertical' }}
                placeholder="What this table is for — agents use this when choosing which master table to read/write"
                value={tablePurposeDraft}
                onChange={(e) => setTablePurposeDraft(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy} style={{ alignSelf: 'flex-start', padding: '0.5rem 1rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff' }}>
              Save purpose
            </button>
          </form>

          <form onSubmit={runTableQuery} style={{ display: 'flex', gap: 8, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <input style={{ ...fieldStyle, flex: 1, minWidth: 180 }} placeholder="Keyword query…" value={tableQuery} onChange={(e) => setTableQuery(e.target.value)} />
            <button type="submit" disabled={busy} style={{ padding: '0.5rem 1rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff' }}>
              Query table
            </button>
            {queryActive && (
              <button type="button" onClick={clearQuery} disabled={busy} style={{ padding: '0.5rem 1rem', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}>
                Clear query
              </button>
            )}
          </form>

          <form onSubmit={insertRow} style={{ marginBottom: '1rem', padding: '0.75rem', border: '1px dashed var(--border)', borderRadius: 8 }}>
            <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: 8 }}>Insert row</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 8 }}>
              {columns.map((c) => (
                <label key={c} style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                  {c}
                  <input
                    style={{ ...fieldStyle, marginTop: 4 }}
                    value={insertDraft[c] ?? ''}
                    onChange={(e) => setInsertDraft((d) => ({ ...d, [c]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <button type="submit" disabled={busy || !columns.length} style={{ padding: '0.5rem 1rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff' }}>
              Insert
            </button>
          </form>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: 0 }}>
              {queryActive ? 'Query' : 'Browse'}: showing {pageStart}–{pageEnd} of {pageTotal} (page size {PAGE_SIZE})
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={busy || !canPrev} onClick={onPagePrev} style={{ padding: '0.35rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: canPrev ? 'pointer' : 'default', opacity: canPrev ? 1 : 0.5 }}>
                Previous
              </button>
              <button type="button" disabled={busy || !canNext} onClick={onPageNext} style={{ padding: '0.35rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: canNext ? 'pointer' : 'default', opacity: canNext ? 1 : 0.5 }}>
                Next
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c} style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', padding: '0.35rem' }}>
                      {c}
                    </th>
                  ))}
                  <th style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', padding: '0.35rem', width: 140 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {columns.map((c) => (
                      <td key={c} style={{ borderBottom: '1px solid var(--border)', padding: '0.35rem', verticalAlign: 'top' }}>
                        {editingId === r.id ? (
                          <input
                            style={{ ...fieldStyle, padding: '0.35rem 0.5rem' }}
                            value={editDraft[c] ?? ''}
                            onChange={(e) => setEditDraft((d) => ({ ...d, [c]: e.target.value }))}
                          />
                        ) : (
                          String(r.data?.[c] ?? '')
                        )}
                      </td>
                    ))}
                    <td style={{ borderBottom: '1px solid var(--border)', padding: '0.35rem', whiteSpace: 'nowrap' }}>
                      {editingId === r.id ? (
                        <>
                          <button type="button" disabled={busy} onClick={() => saveEdit(r.id)} style={{ marginRight: 6, background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--accent)', cursor: 'pointer', fontSize: '0.75rem' }}>
                            Save
                          </button>
                          <button type="button" disabled={busy} onClick={() => setEditingId(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--muted)', cursor: 'pointer', fontSize: '0.75rem' }}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" disabled={busy} onClick={() => startEdit(r)} style={{ marginRight: 6, background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--accent)', cursor: 'pointer', fontSize: '0.75rem' }}>
                            Edit
                          </button>
                          <button type="button" disabled={busy} onClick={() => removeRow(r.id)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--muted)', cursor: 'pointer', fontSize: '0.75rem' }}>
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={columns.length + 1} style={{ padding: '0.75rem', color: 'var(--muted)' }}>
                      No rows on this page.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export default function MasterData() {
  return (
    <RequireAuth>
      <MasterDataPanel />
    </RequireAuth>
  );
}
