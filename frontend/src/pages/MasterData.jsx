import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { RequireAuth } from '../context/AuthContext';

const PAGE_SIZE = 50;
const DOC_PAGE_SIZE = 10;

const RAG_SUPPORTED_FORMATS = [
  { ext: '.pdf', label: 'PDF' },
  { ext: '.docx', label: 'Word' },
  { ext: '.xlsx / .xls', label: 'Excel' },
  { ext: '.txt / .md', label: 'Text / Markdown' },
  { ext: '.csv / .json', label: 'CSV / JSON' },
  { ext: '.html / .xml / .log', label: 'HTML / XML / Log' },
];

function emptyRowDraft(columns = []) {
  const draft = {};
  for (const c of columns) draft[c] = '';
  return draft;
}

function MasterDataPanel() {
  const [tables, setTables] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [inboundItems, setInboundItems] = useState([]);
  const [docPage, setDocPage] = useState(0);
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
  const [csKnowledge, setCsKnowledge] = useState(null);
  const [csIndustry, setCsIndustry] = useState('');
  const [csBlueprint, setCsBlueprint] = useState('');
  const [csBusy, setCsBusy] = useState(false);
  const [csSeedSops, setCsSeedSops] = useState(true);

  const refresh = async () => {
    const [t, d, inbound] = await Promise.all([
      api.masterDataTables(),
      api.masterDataDocuments({ limit: 100, offset: 0 }),
      api.inboundAttachmentsList({ limit: 100, offset: 0 }).catch(() => ({ items: [] })),
    ]);
    setTables(t.tables || []);
    setDocuments(d.documents || []);
    setInboundItems(inbound.items || []);
  };

  const loadCompanySetupKnowledge = async (industryId, blueprintId) => {
    const data = await api.masterDataCompanySetupKnowledge({
      industry_id: industryId || undefined,
      blueprint_id: blueprintId || undefined,
    });
    setCsKnowledge(data);
    if (!industryId && data.industry_id) setCsIndustry(data.industry_id);
    if (!blueprintId && data.blueprint_id) setCsBlueprint(data.blueprint_id);
    return data;
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    loadCompanySetupKnowledge().catch(() => {
      /* non-fatal if route missing on older backend */
    });
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

  const docPageCount = Math.max(1, Math.ceil(documents.length / DOC_PAGE_SIZE));
  const safeDocPage = Math.min(docPage, docPageCount - 1);
  const pagedDocuments = useMemo(
    () => documents.slice(safeDocPage * DOC_PAGE_SIZE, safeDocPage * DOC_PAGE_SIZE + DOC_PAGE_SIZE),
    [documents, safeDocPage]
  );
  const docRangeStart = documents.length === 0 ? 0 : safeDocPage * DOC_PAGE_SIZE + 1;
  const docRangeEnd = Math.min((safeDocPage + 1) * DOC_PAGE_SIZE, documents.length);

  useEffect(() => {
    setDocPage(0);
  }, [documents.length]);

  return (
    <div className="mcp-pg">
      <Link to="/org" style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
        ← My Org
      </Link>
      <h1 style={{ margin: '0.5rem 0 0.25rem' }}>Knowledge</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Company knowledge (Master Data): create tables, upload CSV, and store documents under your tenant.
        AI employees can list tables and CRUD rows / search documents via tools — scoped to your CEO only.
        Table schema alter/drop is not available to AI employees.
      </p>

      {error && <div style={{ color: '#f87171', marginBottom: '0.75rem' }}>{error}</div>}
      {message && <div style={{ color: '#22c55e', marginBottom: '0.75rem' }}>{message}</div>}
      {hasDuplicateNames && (
        <div style={{ color: '#fbbf24', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          Duplicate table names detected. Keep one and delete the extras — new tables must use unique names (case-insensitive).
        </div>
      )}

      <section
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '1rem',
          marginBottom: '1rem',
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Company setup knowledge tables</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: 0 }}>
          New companies get pack tables (and <code>company_memory</code>) when Company Setup is applied. Accounts created
          before that wizard often skip these tables. Reseed creates missing pack metadata; if tables already exist you
          must confirm overwrite (clears existing rows, then re-seeds).
        </p>
        {csKnowledge ? (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10, fontSize: '0.9rem' }}>
              <label>
                Industry{' '}
                <select
                  value={csIndustry}
                  onChange={async (e) => {
                    const v = e.target.value;
                    setCsIndustry(v);
                    setCsBlueprint('');
                    setCsBusy(true);
                    try {
                      await loadCompanySetupKnowledge(v, '');
                    } catch (err) {
                      setError(err.message);
                    } finally {
                      setCsBusy(false);
                    }
                  }}
                  style={fieldStyle}
                >
                  {(csKnowledge.company_types || []).map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label || opt.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Blueprint{' '}
                <select
                  value={csBlueprint || csKnowledge.blueprint_id || ''}
                  onChange={async (e) => {
                    const v = e.target.value;
                    setCsBlueprint(v);
                    setCsBusy(true);
                    try {
                      await loadCompanySetupKnowledge(csIndustry, v);
                    } catch (err) {
                      setError(err.message);
                    } finally {
                      setCsBusy(false);
                    }
                  }}
                  style={fieldStyle}
                >
                  {(csKnowledge.industries?.blueprints || []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name || b.label || b.id}
                      {b.depth ? ` (${b.depth})` : ''}
                    </option>
                  ))}
                  {!csKnowledge.industries?.blueprints?.length && (csKnowledge.blueprint_id || csBlueprint) && (
                    <option value={csBlueprint || csKnowledge.blueprint_id}>
                      {csKnowledge.blueprint_name || csBlueprint || csKnowledge.blueprint_id}
                    </option>
                  )}
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={csSeedSops} onChange={(e) => setCsSeedSops(e.target.checked)} />
                Also seed SOP documents
              </label>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 8px' }}>
              Blueprint: <strong>{csKnowledge.blueprint_name || csKnowledge.blueprint_id || '—'}</strong>
              {' · '}
              pack tables: {csKnowledge.pack_knowledge_table_count ?? 0}
              {' · '}
              missing: {csKnowledge.missing_count ?? 0}
              {' · '}
              existing: {csKnowledge.existing_count ?? 0}
              {csKnowledge.note ? ` — ${csKnowledge.note}` : ''}
            </p>
            <ul style={{ margin: '0 0 12px', paddingLeft: '1.2rem', fontSize: '0.85rem' }}>
              {(csKnowledge.tables || []).map((t) => (
                <li key={t.name}>
                  <code>{t.name}</code>
                  {t.exists ? (
                    <span style={{ color: '#fbbf24' }}> — exists ({t.row_count} rows)</span>
                  ) : (
                    <span style={{ color: 'var(--muted)' }}> — missing (will create)</span>
                  )}
                  {t.seed_row_count != null ? ` · ${t.seed_row_count} seed row(s)` : ''}
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={csBusy}
              onClick={async () => {
                setError(null);
                setCsBusy(true);
                try {
                  let status = csKnowledge;
                  if (!status) status = await loadCompanySetupKnowledge(csIndustry, csBlueprint);
                  const industry = csIndustry || status.industry_id;
                  const blueprint = csBlueprint || status.blueprint_id;
                  // If only existing tables and user clicks reseed → require overwrite path
                  if (status.missing_count === 0 && status.existing_count > 0) {
                    const phrase = status.overwrite_confirm_phrase || 'OVERWRITE_COMPANY_KNOWLEDGE';
                    const ok = window.confirm(
                      `All company setup knowledge tables already exist (${status.existing_count}).\n\n` +
                        `Overwrite clears ALL rows in those tables, then re-seeds pack metadata.\n` +
                        `Click OK, then type ${phrase} to confirm.`
                    );
                    if (!ok) return;
                    const typed = window.prompt(`Type ${phrase} to confirm overwrite:`);
                    if (String(typed || '').trim() !== phrase) {
                      setError('Overwrite cancelled — confirmation phrase did not match.');
                      return;
                    }
                    const res = await api.masterDataCompanySetupKnowledgeReseed({
                      industry_id: industry,
                      blueprint_id: blueprint,
                      confirm: phrase,
                      seed_sops: csSeedSops,
                    });
                    flash(
                      `Overwrote ${res.tables_overwritten?.length || 0} table(s); re-seeded pack metadata.`
                    );
                  } else if (status.requires_overwrite_confirm && status.missing_count > 0) {
                    // Mix: seed missing without forcing overwrite; mention existing stay
                    const res = await api.masterDataCompanySetupKnowledgeReseed({
                      industry_id: industry,
                      blueprint_id: blueprint,
                      seed_sops: csSeedSops,
                    });
                    flash(
                      `Created ${res.tables_created?.length || 0} missing table(s). ${status.existing_count} existing table(s) left unchanged (use overwrite if you need a full reseed).`
                    );
                  } else {
                    const res = await api.masterDataCompanySetupKnowledgeReseed({
                      industry_id: industry,
                      blueprint_id: blueprint,
                      seed_sops: csSeedSops,
                    });
                    flash(`Seeded company knowledge: created ${res.tables_created?.length || 0} table(s).`);
                  }
                  await refresh();
                  await loadCompanySetupKnowledge(csIndustry, csBlueprint);
                } catch (e) {
                  setError(e.message || 'Reseed failed');
                } finally {
                  setCsBusy(false);
                }
              }}
              style={{ padding: '0.5rem 0.85rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}
            >
              {csBusy
                ? 'Working…'
                : csKnowledge.missing_count === 0 && csKnowledge.existing_count > 0
                  ? 'Overwrite pack tables…'
                  : 'Seed missing company setup tables'}
            </button>
            {csKnowledge.requires_overwrite_confirm && csKnowledge.missing_count > 0 ? (
              <button
                type="button"
                disabled={csBusy}
                onClick={async () => {
                  setError(null);
                  const phrase = csKnowledge.overwrite_confirm_phrase || 'OVERWRITE_COMPANY_KNOWLEDGE';
                  const ok = window.confirm(
                    `Overwrite ALL existing pack knowledge tables (${csKnowledge.existing_count})?\n` +
                      `Rows will be cleared and re-seeded.\n\nOK then type ${phrase}.`
                  );
                  if (!ok) return;
                  const typed = window.prompt(`Type ${phrase} to confirm overwrite:`);
                  if (String(typed || '').trim() !== phrase) {
                    setError('Overwrite cancelled — confirmation phrase did not match.');
                    return;
                  }
                  setCsBusy(true);
                  try {
                    const res = await api.masterDataCompanySetupKnowledgeReseed({
                      industry_id: csIndustry || csKnowledge.industry_id,
                      blueprint_id: csBlueprint || csKnowledge.blueprint_id,
                      confirm: phrase,
                      seed_sops: csSeedSops,
                    });
                    flash(
                      `Overwrite done: created ${res.tables_created?.length || 0}, cleared ${res.tables_overwritten?.length || 0}.`
                    );
                    await refresh();
                    await loadCompanySetupKnowledge(csIndustry, csBlueprint);
                  } catch (e) {
                    setError(e.message || 'Overwrite failed');
                  } finally {
                    setCsBusy(false);
                  }
                }}
                style={{
                  marginLeft: 8,
                  padding: '0.5rem 0.85rem',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                }}
              >
                Overwrite existing too…
              </button>
            ) : null}
          </>
        ) : (
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', margin: 0 }}>Loading company knowledge status…</p>
        )}
      </section>

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
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Documents (RAG)</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1rem' }}>
            <input style={fieldStyle} placeholder="Title (optional)" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Supported upload formats</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {RAG_SUPPORTED_FORMATS.map((f) => (
                  <span
                    key={f.ext}
                    title={f.ext}
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.2rem 0.55rem',
                      borderRadius: 999,
                      border: '1px solid var(--border)',
                      background: 'var(--bg, transparent)',
                      color: 'var(--text)',
                    }}
                  >
                    {f.label} <span style={{ color: 'var(--muted)' }}>{f.ext}</span>
                  </span>
                ))}
              </div>
              <input
                type="file"
                accept=".txt,.md,.csv,.json,.log,.html,.xml,.pdf,.docx,.xlsx,.xls,text/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={(e) => onDocFile(e.target.files?.[0])}
              />
              <small style={{ display: 'block', color: 'var(--muted)', marginTop: 6 }}>
                Files are chunked and indexed for RAG. Legacy <code>.doc</code> is not supported — convert to <code>.docx</code>.
              </small>
            </div>
          </div>
          <div style={{ marginBottom: '0.75rem', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
            <button
              type="button"
              disabled={busy || !documents.some((d) => !d.is_protected)}
              onClick={async () => {
                const purgeable = documents.filter((d) => !d.is_protected).length;
                const retained = documents.filter((d) => d.is_protected).length;
                if (
                  !window.confirm(
                    `Purge all uploaded documents?\n\n` +
                      `This permanently deletes ${purgeable} user-uploaded document(s) from the database and disk.\n` +
                      `${retained} Platform Help / User Guide document(s) will be kept.\n\n` +
                      `This cannot be undone.`
                  )
                ) {
                  return;
                }
                setBusy(true);
                setError(null);
                try {
                  const res = await api.masterDataDocumentsPurgeAll();
                  await refresh();
                  flash(
                    `Purged ${res.deleted_count || 0} uploaded document(s)` +
                      (res.retained_count ? `; kept ${res.retained_count} help/guide doc(s)` : '') +
                      (res.failed_count ? `; ${res.failed_count} failed` : '')
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
                color: 'var(--danger, #b91c1c)',
                cursor: busy || !documents.some((d) => !d.is_protected) ? 'default' : 'pointer',
                fontSize: '0.8rem',
              }}
              title="Deletes your uploaded documents only. Platform Help and User Guide are never removed."
            >
              Purge all uploads
            </button>
          </div>
          <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
            {documents.length === 0
              ? 'No documents yet'
              : `Showing ${docRangeStart}–${docRangeEnd} of ${documents.length}`}
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, marginBottom: '0.75rem' }}>
            {pagedDocuments.map((d) => (
              <li key={d.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600 }}>
                  {d.title}
                  {d.is_protected ? (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: '0.7rem',
                        fontWeight: 500,
                        color: 'var(--muted)',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                        padding: '0.1rem 0.35rem',
                      }}
                      title="Platform Help / User Guide — cannot be deleted or purged"
                    >
                      protected
                    </span>
                  ) : null}
                </div>
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
                  {d.is_protected ? (
                    <span style={{ fontSize: '0.75rem', color: 'var(--muted)', alignSelf: 'center' }}>
                      Cannot delete
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(`Delete ${d.title}?`)) return;
                        try {
                          await api.masterDataDocumentDelete(d.id);
                          await refresh();
                        } catch (err) {
                          setError(err.message);
                        }
                      }}
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--muted)', cursor: 'pointer', fontSize: '0.75rem' }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
            {!pagedDocuments.length && <li style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>No documents yet.</li>}
          </ul>
          {documents.length > DOC_PAGE_SIZE && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="wf-btn"
                disabled={safeDocPage <= 0}
                onClick={() => setDocPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                Page {safeDocPage + 1} of {docPageCount}
              </span>
              <button
                type="button"
                className="wf-btn"
                disabled={safeDocPage >= docPageCount - 1}
                onClick={() => setDocPage((p) => Math.min(docPageCount - 1, p + 1))}
              >
                Next
              </button>
            </div>
          )}

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

      <section
        style={{
          marginTop: '1rem',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '1rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Inbound attachments</h2>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await api.inboundAttachmentsList();
                setInboundItems(r.items || []);
                flash(`Loaded ${r.items?.length || 0} inbound file(s).`);
              } catch (err) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
            style={{
              padding: '0.35rem 0.7rem',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            Refresh
          </button>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 0 }}>
          Chat, WhatsApp, and channel uploads land in <code>inbound/attachments/</code>. RAG-able
          files (PDF, Word, Excel, text) can be indexed into your OpenSearch documents. Images,
          audio, and video stay here (no RAG) — use STT for audio when needed.
        </p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {inboundItems.map((f) => (
            <li
              key={f.relative_path || f.filename}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.55rem 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{f.filename}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                  <code>{f.relative_path}</code>
                  {f.size != null ? ` · ${(f.size / 1024).toFixed(1)} KB` : ''}
                  {f.mtime ? ` · ${f.mtime}` : ''}
                  {f.is_media ? ' · media' : f.rag_indexable ? ' · RAG-able' : ' · not indexable'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const { blob, filename } = await api.inboundAttachmentDownload(f.relative_path);
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = filename || f.filename;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (err) {
                      setError(err.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text)',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    padding: '0.25rem 0.5rem',
                  }}
                >
                  Download
                </button>
                {f.rag_indexable && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        const res = await api.masterDataDocumentFromInbound({
                          relative_path: f.relative_path,
                          title: f.filename,
                        });
                        await refresh();
                        flash(
                          `Indexed ${res.document?.filename || f.filename} (${res.document?.chunk_count || 0} chunks)`
                        );
                      } catch (err) {
                        setError(err.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                    style={{
                      background: 'var(--accent)',
                      border: 'none',
                      borderRadius: 6,
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      padding: '0.25rem 0.5rem',
                    }}
                  >
                    Index to RAG
                  </button>
                )}
              </div>
            </li>
          ))}
          {!inboundItems.length && (
            <li style={{ color: 'var(--muted)', fontSize: '0.9rem', padding: '0.5rem 0' }}>
              No inbound attachments yet.
            </li>
          )}
        </ul>
      </section>

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
