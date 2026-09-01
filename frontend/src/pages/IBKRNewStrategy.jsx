import { useEffect, useState } from 'react';
import { api } from '../api';

const card = { background: 'var(--surface, #fff)', border: '1px solid var(--border, #dbe2ea)', borderRadius: 12, padding: 18 };

export default function IBKRNewStrategy() {
  const [data, setData] = useState(null); const [kind, setKind] = useState('strategy_skill'); const [editor, setEditor] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const load = async () => { try { setData(await api.ibkrNewDashboard()); setError(''); } catch (e) { setError(e.message); } };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (data?.configs?.[kind]) setEditor(JSON.stringify(data.configs[kind], null, 2)); }, [data, kind]);
  const publish = async () => { setBusy(true); try { const document = JSON.parse(editor); delete document.id; delete document.version; delete document.status; try { await api.ibkrNewPublishConfig(kind, document, false); } catch (e) { if (e.status !== 409 || !window.confirm('This change loosens trading risk. Publish with explicit CEO confirmation?')) throw e; await api.ibkrNewPublishConfig(kind, document, true); } await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}><h1>IBKRNew0 · Strategy</h1><p>The configurable skill is applied by <strong>IBKRNewStrategyPlanner</strong>. Deterministic commission, budget, and risk checks remain outside the skill.</p>{error && <p className="error-text">{error}</p>}<div style={card}><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>{['strategy_skill','strategy','policy','universe','market_data'].map((x) => <button key={x} onClick={() => setKind(x)}>{x.replace('_',' ')}</button>)}</div><textarea rows={30} value={editor} onChange={(e) => setEditor(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }} /><button disabled={busy} onClick={publish} style={{ marginTop: 10 }}>{busy ? 'Publishing…' : `Publish immutable ${kind} version`}</button><p style={{ opacity: .65 }}>Default skill: <code>.cursor/skills/ibkrnew-trade-strategy/SKILL.md</code>. Published owner versions are retained for audit and rollback.</p></div></div>;
}
