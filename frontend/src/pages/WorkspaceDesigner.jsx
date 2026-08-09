/**
 * Workspace Builder visual designer.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import BoardRuntime from '../components/workspace-builder/BoardRuntime.jsx';

const BIND_SOURCES = [
  { id: 'none', label: 'None' },
  { id: 'preset', label: 'Preset data' },
  { id: 'rest', label: 'REST API (allowlisted)' },
  { id: 'master_data_table', label: 'Master data table' },
  { id: 'master_data_rag', label: 'Knowledge RAG' },
];

function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function slugify(name) {
  return String(name || 'page').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'page';
}

export default function WorkspaceDesigner() {
  const [params, setParams] = useSearchParams();
  const slug = params.get('slug') || 'operating-workspace';
  const [catalog, setCatalog] = useState({ components: [], presets: [], rest_allowlist: [] });
  const [boards, setBoards] = useState([]);
  const [name, setName] = useState('Operating Workspace');
  const [layout, setLayout] = useState({ mode: 'grid', columns: 12, row_height: 48, gap: 12 });
  const [components, setComponents] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [live, setLive] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [published, setPublished] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  const selected = useMemo(() => components.find((c) => c.id === selectedId) || null, [components, selectedId]);

  const loadList = useCallback(async () => {
    const res = await api.workspaceBoardList();
    setBoards(res?.boards || []);
  }, []);

  const loadBoard = useCallback(async (s) => {
    setLoading(true);
    setError(null);
    try {
      const [cat, board] = await Promise.all([api.workspaceBoardCatalog(), api.workspaceBoardGet(s)]);
      setCatalog(cat || { components: [] });
      setName(board?.name || s);
      setLayout(board?.layout || { mode: 'grid', columns: 12, row_height: 48, gap: 12 });
      const comps = board?.components || board?.widgets || [];
      setComponents(comps);
      setPublished(!!board?.published);
      setIsDefault(!!board?.is_default);
      setSelectedId(comps[0]?.id || null);
      setLive(null);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList().catch(() => {}); loadBoard(slug); }, [slug, loadBoard, loadList]);

  function updateSelected(patch) {
    if (!selectedId) return;
    setComponents((list) => list.map((c) => (c.id === selectedId ? { ...c, ...patch } : c)));
  }

  function updateBinding(patch) {
    if (!selectedId) return;
    setComponents((list) =>
      list.map((c) =>
        c.id === selectedId ? { ...c, binding: { ...(c.binding || { source: 'none' }), ...patch } } : c
      )
    );
  }

  function addComponent(type) {
    const meta = (catalog.components || []).find((c) => c.type === type);
    const def = meta?.default || { w: 4, h: 3 };
    const maxY = components.reduce((m, c) => Math.max(m, (c.y || 0) + (c.h || 2)), 0);
    const id = newId('c');
    const next = {
      id, type, title: meta?.title || type, x: 0, y: maxY, w: def.w, h: def.h,
      props: type === 'text_block' || type === 'notes_card' ? { text: 'Notes' } : {},
      binding: { source: 'none' },
    };
    setComponents((list) => [...list, next]);
    setSelectedId(id);
  }

  function applyLayoutPreset(cols) {
    const w = Math.floor(12 / cols);
    setComponents((list) =>
      list.map((c, i) => ({ ...c, w: Math.min(12, w), x: (i % cols) * w, y: Math.floor(i / cols) * Math.max(c.h || 3, 3) }))
    );
    setLayout((l) => ({ ...l, mode: 'grid', columns: 12 }));
  }

  function moveComponent(id, dx, dy) {
    setComponents((list) =>
      list.map((c) => {
        if (c.id !== id) return c;
        return { ...c, x: Math.max(0, Math.min(11, (c.x || 0) + dx)), y: Math.max(0, (c.y || 0) + dy) };
      })
    );
  }

  function removeSelected() {
    if (!selectedId) return;
    setComponents((list) => list.filter((c) => c.id !== selectedId));
    setSelectedId(null);
  }

  async function save() {
    setSaving(true); setError(null); setOk(null);
    try {
      const res = await api.workspaceBoardSave(slug, { name, layout, components, published });
      setOk('Saved just now');
      if (res?.board) { setPublished(!!res.board.published); setIsDefault(!!res.board.is_default); }
      await loadList();
    } catch (e) { setError(e?.message || String(e)); }
    finally { setSaving(false); }
  }

  async function previewLive() {
    setPreviewing(true); setError(null);
    try {
      await save();
      const out = await api.workspaceBoardRender(slug);
      setLive(out);
      setOk('Live preview connected');
    } catch (e) { setError(e?.message || String(e)); }
    finally { setPreviewing(false); }
  }

  async function setAsDefault() {
    setSaving(true); setError(null);
    try {
      await save();
      await api.workspaceBoardSetDefault(slug);
      setIsDefault(true); setPublished(true);
      setOk('Published as default Workspace menu page');
      await loadList();
    } catch (e) { setError(e?.message || String(e)); }
    finally { setSaving(false); }
  }

  async function seedOperating() {
    try {
      await api.workspaceBoardSeedOperating();
      setParams({ slug: 'operating-workspace' });
      await loadBoard('operating-workspace');
      await loadList();
      setOk('Seeded Operating Workspace template');
    } catch (e) { setError(e?.message || String(e)); }
  }

  async function createPage() {
    const n = window.prompt('New page name', 'Executive Overview');
    if (!n) return;
    const s = slugify(n);
    try {
      await api.workspaceBoardSave(s, { name: n, layout: { mode: 'grid', columns: 12, row_height: 48, gap: 12 }, components: [], published: false });
      setParams({ slug: s });
      await loadList();
    } catch (e) { setError(e?.message || String(e)); }
  }

  const designComponents = live?.components || components;
  const designBoard = live?.board || { layout, name, components };
  const byCat = useMemo(() => {
    const map = {};
    for (const c of catalog.components || []) {
      const k = c.category || 'other';
      if (!map[k]) map[k] = [];
      map[k].push(c);
    }
    return map;
  }, [catalog]);

  return (
    <div className="wsb-page">
      <header className="wsb-header">
        <div>
          <h1>Workspace Builder</h1>
          <p className="wsb-sub">Design, bind and publish data-driven workspaces.</p>
        </div>
        <div className="wsb-header-actions">
          <button type="button" className="btn secondary" onClick={seedOperating}>Seed operating template</button>
          <button type="button" className="btn secondary" onClick={save} disabled={saving || loading}>{saving ? 'Saving...' : 'Save Page'}</button>
          <button type="button" className="btn secondary" onClick={previewLive} disabled={previewing}>{previewing ? 'Loading...' : 'Preview Live Data'}</button>
          <button type="button" className="btn primary" onClick={setAsDefault} disabled={saving}>Set as Default</button>
          <Link className="btn secondary" to="/work">Open Workspace</Link>
        </div>
      </header>
      <div className="wsb-pages">
        {(boards || []).map((b) => (
          <button key={b.slug} type="button" className={'wsb-page-tab' + (b.slug === slug ? ' active' : '')} onClick={() => setParams({ slug: b.slug })}>
            <strong>{b.name}</strong>
            <span>{b.is_default ? 'Default ? ' : ''}{b.updated_at ? 'Updated ' + String(b.updated_at).slice(0, 10) : 'Template'}</span>
          </button>
        ))}
        <button type="button" className="wsb-page-tab add" onClick={createPage}>+ New Page</button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {ok ? <p className="success-text">{ok}{isDefault ? ' ? Menu default' : ''}</p> : null}
      <div className="wsb-body">
        <aside className="wsb-palette">
          <h3>Layouts</h3>
          <div className="wsb-layout-btns">
            <button type="button" onClick={() => applyLayoutPreset(2)}>2 Column</button>
            <button type="button" onClick={() => applyLayoutPreset(3)}>3 Column</button>
            <button type="button" onClick={() => applyLayoutPreset(4)}>Grid</button>
          </div>
          <h3>Components</h3>
          {Object.entries(byCat).map(([cat, items]) => (
            <div key={cat} className="wsb-cat">
              <div className="wsb-cat-label">{cat}</div>
              <div className="wsb-comp-grid">
                {items.map((c) => (
                  <button key={c.type} type="button" className="wsb-comp-btn" title={c.description} onClick={() => addComponent(c.type)}>{c.title}</button>
                ))}
              </div>
            </div>
          ))}
          <p className="wsb-hint">Click components to place them. Use arrows on selection to move. Bind REST, master data, or RAG. JSON model can later be authored by AI workers / Workflow Builder.</p>
        </aside>
        <main className="wsb-main">
          <div className="wsb-canvas-toolbar">
            <span className={live ? 'wsb-live on' : 'wsb-live'}>{live ? 'Live preview' : 'Design mode'}</span>
            <label className="wsb-name-field">Page name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="wsb-check"><input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} /> Published</label>
          </div>
          {loading ? <p>Loading...</p> : (
            <BoardRuntime board={designBoard} components={designComponents} designMode selectedId={selectedId} onSelect={setSelectedId} onMove={moveComponent} />
          )}
          <p className="wsb-autosave">{ok || 'Changes save when you click Save Page.'}</p>
        </main>
        <aside className="wsb-settings">
          <h3>Selected Component</h3>
          {!selected ? (
            <p className="ws-muted">Select a component on the canvas.</p>
          ) : (
            <>
              <div className="wsb-field"><label>Type</label><div className="wsb-readonly">{selected.type}</div></div>
              <div className="wsb-field"><label>Component name</label>
                <input value={selected.title || ''} onChange={(e) => updateSelected({ title: e.target.value })} />
              </div>
              <div className="wsb-field-row">
                <label>X<input type="number" value={selected.x ?? 0} onChange={(e) => updateSelected({ x: Number(e.target.value) })} /></label>
                <label>Y<input type="number" value={selected.y ?? 0} onChange={(e) => updateSelected({ y: Number(e.target.value) })} /></label>
                <label>W<input type="number" value={selected.w ?? 4} onChange={(e) => updateSelected({ w: Number(e.target.value) })} /></label>
                <label>H<input type="number" value={selected.h ?? 3} onChange={(e) => updateSelected({ h: Number(e.target.value) })} /></label>
              </div>
              {(selected.type === 'text_block' || selected.type === 'notes_card') && (
                <div className="wsb-field"><label>Text</label>
                  <textarea rows={3} value={selected.props?.text || ''} onChange={(e) => updateSelected({ props: { ...(selected.props || {}), text: e.target.value } })} />
                </div>
              )}
              <h4>Data binding</h4>
              <div className="wsb-field"><label>Source</label>
                <select value={selected.binding?.source || 'none'} onChange={(e) => updateBinding({ source: e.target.value })}>
                  {BIND_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              {selected.binding?.source === 'preset' && (
                <div className="wsb-field"><label>Preset</label>
                  <select value={selected.binding?.preset || ''} onChange={(e) => updateBinding({ preset: e.target.value })}>
                    <option value="">-</option>
                    {(catalog.presets || []).map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              )}
              {selected.binding?.source === 'rest' && (
                <>
                  <div className="wsb-field"><label>Endpoint</label>
                    <select value={selected.binding?.endpoint || ''} onChange={(e) => updateBinding({ endpoint: e.target.value })}>
                      <option value="">-</option>
                      {(catalog.rest_allowlist || []).map((p) => <option key={p} value={p}>GET {p}</option>)}
                    </select>
                  </div>
                  <div className="wsb-field"><label>JSON path</label>
                    <input value={selected.binding?.path || ''} onChange={(e) => updateBinding({ path: e.target.value })} placeholder="metrics.tasks_open" />
                  </div>
                </>
              )}
              {selected.binding?.source === 'master_data_table' && (
                <div className="wsb-field"><label>Table id</label>
                  <input value={selected.binding?.table_id || ''} onChange={(e) => updateBinding({ table_id: e.target.value })} />
                </div>
              )}
              {selected.binding?.source === 'master_data_rag' && (
                <div className="wsb-field"><label>RAG query</label>
                  <textarea rows={3} value={selected.binding?.rag_query || ''} onChange={(e) => updateBinding({ rag_query: e.target.value })} />
                </div>
              )}
              <div className="wsb-field"><label>Binding mode</label><div className="wsb-readonly">Read-only (view only)</div></div>
              <button type="button" className="btn secondary" onClick={removeSelected}>Remove component</button>
            </>
          )}
          <div className="wsb-status">{live ? 'Live preview connected. Data is up to date.' : 'Save then Preview Live Data to hydrate bindings.'}</div>
        </aside>
      </div>
    </div>
  );
}
