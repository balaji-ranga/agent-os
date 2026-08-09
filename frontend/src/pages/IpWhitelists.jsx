/**
 * Settings → IP Whitelists — central owner-scoped firewall rules.
 * Applies to IBKR bridge webhooks, workflow desktop package, A2A public access, browser worker.
 * Federated UIs (Connectors, Desktop download, AgentExchange) read/write the same store.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const FEATURES = [
  {
    key: 'apply_ibkr_bridge',
    label: 'IBKR bridge',
    help: 'Laptop → cloud local-bridge-webhook (account snapshots, orders)',
  },
  {
    key: 'apply_workflow_desktop',
    label: 'Workflow download',
    help: 'Download for Windows desktop API (dsk_ tokens; W2 IBKR execute)',
  },
  {
    key: 'apply_a2a',
    label: 'A2A publish',
    help: 'Public A2A card/invoke when access policy is IP whitelist',
  },
  {
    key: 'apply_browser_worker',
    label: 'Browser Session package',
    help: 'Local browser worker → cloud (bwk_ token)',
  },
];

const emptyForm = () => ({
  cidr_or_ip: '',
  label: '',
  apply_ibkr_bridge: false,
  apply_workflow_desktop: false,
  apply_a2a: false,
  apply_browser_worker: false,
  definition_id: '',
  publish_id: '',
});

function featureChips(entry) {
  const bits = [];
  if (entry.apply_ibkr_bridge) bits.push('IBKR');
  if (entry.apply_workflow_desktop) bits.push('Desktop');
  if (entry.apply_a2a) bits.push('A2A');
  if (entry.apply_browser_worker) bits.push('Browser');
  return bits.join(' · ') || '—';
}

export default function IpWhitelists() {
  const [entries, setEntries] = useState([]);
  const [currentIp, setCurrentIp] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.ipWhitelistsList();
      setEntries(res.entries || []);
      setCurrentIp(res.current_ip || null);
    } catch (e) {
      setError(e.message || 'Failed to load IP whitelists');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setFlag = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const startEdit = (entry) => {
    setEditingId(entry.id);
    setForm({
      cidr_or_ip: entry.cidr_or_ip || '',
      label: entry.label || '',
      apply_ibkr_bridge: !!entry.apply_ibkr_bridge,
      apply_workflow_desktop: !!entry.apply_workflow_desktop,
      apply_a2a: !!entry.apply_a2a,
      apply_browser_worker: !!entry.apply_browser_worker,
      definition_id: entry.definition_id || '',
      publish_id: entry.publish_id || '',
    });
    setMessage(null);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm());
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body = {
        cidr_or_ip: form.cidr_or_ip.trim(),
        label: form.label.trim(),
        apply_ibkr_bridge: form.apply_ibkr_bridge,
        apply_workflow_desktop: form.apply_workflow_desktop,
        apply_a2a: form.apply_a2a,
        apply_browser_worker: form.apply_browser_worker,
        definition_id: form.definition_id.trim() || null,
        publish_id: form.publish_id.trim() || null,
      };
      if (editingId) {
        await api.ipWhitelistsUpdate(editingId, body);
        setMessage('Rule updated. Enforcement is immediate for new connections.');
      } else {
        await api.ipWhitelistsAdd(body);
        setMessage('Rule added. Empty lists still allow any IP for desktop/browser/IBKR until the first rule applies.');
      }
      cancelEdit();
      await load();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entryId) => {
    if (!window.confirm('Remove this IP whitelist rule?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.ipWhitelistsRemove(entryId);
      setMessage('Rule removed.');
      if (editingId === entryId) cancelEdit();
      await load();
    } catch (e) {
      setError(e.message || 'Remove failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nav-menus-page">
      <header className="this-week-header">
        <div>
          <h1>IP Whitelists</h1>
          <p className="this-week-sub">
            One owner-scoped firewall for laptop and public surfaces. Rules you add here (or in
            Connectors, Download for Windows, or AgentExchange Security) share the same store.
          </p>
        </div>
        <div className="this-week-header-actions">
          <Link className="btn secondary" to="/connectors">
            Connectors
          </Link>
          <Link className="btn secondary" to="/agent-exchange">
            AgentExchange
          </Link>
        </div>
      </header>

      {loading && <p>Loading…</p>}
      {error && <p className="error-text">{error}</p>}
      {message && <p className="success-text">{message}</p>}

      {!loading && (
        <>
          <section className="this-week-card" style={{ marginBottom: '1rem' }}>
            <h3 className="this-week-card-title">{editingId ? 'Edit rule' : 'Add rule'}</h3>
            <p className="this-week-muted" style={{ marginTop: 0 }}>
              Use exact IPv4/IPv6 or IPv4 CIDR (e.g. <code>203.0.113.0/24</code>). IPv6 ranges are
              not supported — use an exact address.
              {currentIp ? (
                <>
                  {' '}
                  Your current IP: <code>{currentIp}</code>{' '}
                  <button
                    type="button"
                    className="btn secondary"
                    style={{ fontSize: '0.8rem', padding: '0.15rem 0.5rem' }}
                    onClick={() => setFlag('cidr_or_ip', currentIp)}
                  >
                    Use my IP
                  </button>
                </>
              ) : null}
            </p>
            <div style={{ display: 'grid', gap: '0.65rem', maxWidth: 560 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>IP or CIDR</span>
                <input
                  value={form.cidr_or_ip}
                  onChange={(e) => setFlag('cidr_or_ip', e.target.value)}
                  placeholder="203.0.113.10 or 203.0.113.0/24"
                  autoComplete="off"
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>Label (optional)</span>
                <input
                  value={form.label}
                  onChange={(e) => setFlag('label', e.target.value)}
                  placeholder="Home office"
                  autoComplete="off"
                />
              </label>
              <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem' }}>
                <legend style={{ padding: '0 0.35rem' }}>Apply to</legend>
                {FEATURES.map((f) => (
                  <label
                    key={f.key}
                    style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}
                  >
                    <input
                      type="checkbox"
                      checked={!!form[f.key]}
                      onChange={(e) => setFlag(f.key, e.target.checked)}
                    />
                    <span>
                      <strong>{f.label}</strong>
                      <div className="this-week-muted" style={{ fontSize: '0.85rem' }}>
                        {f.help}
                      </div>
                    </span>
                  </label>
                ))}
              </fieldset>
              <details>
                <summary className="this-week-muted" style={{ cursor: 'pointer' }}>
                  Optional scope (advanced)
                </summary>
                <div style={{ display: 'grid', gap: '0.5rem', marginTop: 8 }}>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span>Workflow definition id (desktop only; leave empty = all workflows)</span>
                    <input
                      value={form.definition_id}
                      onChange={(e) => setFlag('definition_id', e.target.value)}
                      placeholder="optional"
                      autoComplete="off"
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span>A2A publish id (leave empty = all your A2A agents on whitelist policy)</span>
                    <input
                      value={form.publish_id}
                      onChange={(e) => setFlag('publish_id', e.target.value)}
                      placeholder="optional"
                      autoComplete="off"
                    />
                  </label>
                </div>
              </details>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={save} disabled={busy || !form.cidr_or_ip.trim()}>
                  {busy ? 'Saving…' : editingId ? 'Update rule' : 'Add rule'}
                </button>
                {editingId && (
                  <button type="button" className="btn secondary" onClick={cancelEdit} disabled={busy}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </section>

          <section className="this-week-card">
            <h3 className="this-week-card-title">Your rules ({entries.length})</h3>
            <p className="this-week-muted" style={{ marginTop: 0 }}>
              For desktop, browser worker, and IBKR bridge: <strong>no rules</strong> for that feature
              means any client IP is accepted (token/secret still required). For A2A, set AgentExchange →
              Security to <strong>IP whitelist</strong>; with that policy, an empty matching list denies all.
            </p>
            {!entries.length ? (
              <p className="this-week-muted">No IP whitelist rules yet.</p>
            ) : (
              <ul className="nav-menus-list" style={{ listStyle: 'none', padding: 0 }}>
                {entries.map((e) => (
                  <li
                    key={e.id}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.5rem 1rem',
                      alignItems: 'center',
                      padding: '0.65rem 0',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <code style={{ fontWeight: 600 }}>{e.cidr_or_ip}</code>
                    <span className="this-week-muted">{e.label || '—'}</span>
                    <span style={{ fontSize: '0.85rem' }}>{featureChips(e)}</span>
                    {e.definition_id && (
                      <span className="this-week-muted" style={{ fontSize: '0.8rem' }}>
                        wf:{e.definition_id.slice(0, 8)}…
                      </span>
                    )}
                    {e.publish_id && (
                      <span className="this-week-muted" style={{ fontSize: '0.8rem' }}>
                        a2a:{e.publish_id.slice(0, 8)}…
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                      <button type="button" className="btn secondary" onClick={() => startEdit(e)} disabled={busy}>
                        Edit
                      </button>
                      <button type="button" className="btn secondary" onClick={() => remove(e.id)} disabled={busy}>
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}