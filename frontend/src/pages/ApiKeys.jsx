import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { RequireAuth, useAuth } from '../context/AuthContext';
import MaskedSecretInput from '../components/MaskedSecretInput';

function ApiKeysPanel() {
  const { user } = useAuth();
  const [keys, setKeys] = useState([]);
  const [platformByok, setPlatformByok] = useState('Platform_BYOK');
  const [replicateByok, setReplicateByok] = useState('Replicate_BYOK');
  const [braveSearchByok, setBraveSearchByok] = useState('BRAVE_SEARCH_BYOK');
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    key_name: '',
    api_key: '',
    encryption_phrase: '',
  });
  const [editId, setEditId] = useState(null);
  const [depsModal, setDepsModal] = useState(null);

  const load = async () => {
    try {
      const r = await api.userApiKeysList();
      setKeys(r.keys || []);
      if (r.platform_byok_key_name) setPlatformByok(r.platform_byok_key_name);
      if (r.replicate_byok_key_name) setReplicateByok(r.replicate_byok_key_name);
      if (r.brave_search_byok_key_name) setBraveSearchByok(r.brave_search_byok_key_name);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  const resetForm = () => {
    setEditId(null);
    setForm({ key_name: '', api_key: '', encryption_phrase: '' });
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (editId) {
        const body = {
          key_name: form.key_name,
        };
        if (form.api_key.trim()) body.api_key = form.api_key.trim();
        if (form.encryption_phrase.trim()) body.encryption_phrase = form.encryption_phrase.trim();
        await api.userApiKeysUpdate(editId, body);
        setMessage('API key updated.');
      } else {
        await api.userApiKeysCreate({
          key_name: form.key_name,
          api_key: form.api_key,
          encryption_phrase: form.encryption_phrase || undefined,
        });
        setMessage('API key created.');
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (row) => {
    setEditId(row.id);
    setForm({
      key_name: row.key_name,
      api_key: '',
      encryption_phrase: '',
    });
    setMessage(null);
    setError(null);
  };

  const requestDelete = async (row) => {
    setError(null);
    try {
      await api.userApiKeysDelete(row.id, false);
      setMessage(`Deleted ${row.key_name}.`);
      await load();
    } catch (err) {
      if (err.status === 409 || err.data?.requires_confirm || err.requires_confirm) {
        const data = err.data || err;
        setDepsModal({
          id: row.id,
          key_name: row.key_name,
          dependencies: data.dependencies || [],
        });
      } else {
        setError(err.message);
      }
    }
  };

  const confirmDelete = async () => {
    if (!depsModal) return;
    setBusy(true);
    try {
      await api.userApiKeysDelete(depsModal.id, true);
      setDepsModal(null);
      setMessage(`Deleted ${depsModal.key_name}.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: 920, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>API Keys</h1>
      <p style={{ color: 'var(--muted)' }}>
        Store named secrets for workflows (Brain, API, MCP, External agents), Connectors, and BYOK.
        Optional encryption phrase encrypts the secret at rest. For OpenAI/OpenRouter agents, create{' '}
        <code>{platformByok}</code> here (required) — do not paste keys on Profile/Register.
        For <code>generate_video</code> when Profile is not Platform default, create{' '}
        <code>{replicateByok}</code> (Replicate token); Platform default still uses the ops Replicate key.
        For <code>brave_web_search</code> when Profile is not Platform default, create{' '}
        <code>{braveSearchByok}</code>; Platform default uses ops <code>BRAVE_API_KEY</code>.
        Non-platform Profiles auto-seed recommended vault slots as <code>unset</code> — Edit each and paste
        your secret.
      </p>

      {error && (
        <div style={{ color: '#b91c1c', marginBottom: '0.75rem' }}>{error}</div>
      )}
      {message && (
        <div style={{ color: '#047857', marginBottom: '0.75rem' }}>{message}</div>
      )}

      <form
        onSubmit={save}
        style={{
          display: 'grid',
          gap: '0.65rem',
          padding: '1rem',
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface)',
          marginBottom: '1.25rem',
        }}
      >
        <strong>{editId ? 'Edit key' : 'Add key'}</strong>
        <label>
          Key name
          <input
            required
            value={form.key_name}
            onChange={(e) => setForm((f) => ({ ...f, key_name: e.target.value }))}
            placeholder={platformByok}
            style={{ display: 'block', width: '100%', marginTop: 4 }}
          />
        </label>
        <label>
          API key {editId ? (keys.find((k) => k.id === editId)?.is_unset ? '(required)' : '(leave blank to keep)') : ''}
          <MaskedSecretInput
            required={!editId || !!keys.find((k) => k.id === editId)?.is_unset}
            value={form.api_key}
            onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
            placeholder="sk-…"
            style={{ display: 'block', width: '100%', marginTop: 4 }}
          />
        </label>
        <label>
          Encryption phrase (optional)
          <MaskedSecretInput
            value={form.encryption_phrase}
            onChange={(e) => setForm((f) => ({ ...f, encryption_phrase: e.target.value }))}
            placeholder="optional passphrase"
            style={{ display: 'block', width: '100%', marginTop: 4 }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : editId ? 'Update' : 'Add'}
          </button>
          {editId && (
            <button type="button" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '0.5rem' }}>Key name</th>
              <th style={{ padding: '0.5rem' }}>API key</th>
              <th style={{ padding: '0.5rem' }}>Encrypted</th>
              <th style={{ padding: '0.5rem' }}>Updated</th>
              <th style={{ padding: '0.5rem' }} />
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '0.75rem', color: 'var(--muted)' }}>
                  No API keys yet.
                </td>
              </tr>
            )}
            {keys.map((k) => (
              <tr key={k.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '0.5rem' }}>
                  <code>{k.key_name}</code>
                  {k.key_name === platformByok && (
                    <span style={{ marginLeft: 6, fontSize: '0.75rem', color: 'var(--muted)' }}>
                      (BYOK)
                    </span>
                  )}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  {k.is_unset || k.key_hint === 'unset' ? (
                    <span style={{ color: '#b45309' }}>unset — edit to paste key</span>
                  ) : (
                    k.key_hint || '••••'
                  )}
                </td>
                <td style={{ padding: '0.5rem' }}>{k.is_encrypted ? 'Yes' : 'No'}</td>
                <td style={{ padding: '0.5rem', fontSize: '0.85rem' }}>{k.updated_at}</td>
                <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => startEdit(k)} style={{ marginRight: 6 }}>
                    Edit
                  </button>
                  <button type="button" onClick={() => requestDelete(k)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {depsModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 80,
          }}
          onClick={() => setDepsModal(null)}
        >
          <div
            style={{
              background: 'var(--surface)',
              padding: '1.25rem',
              borderRadius: 10,
              maxWidth: 480,
              width: '90%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Delete {depsModal.key_name}?</h3>
            <p>This key is referenced by:</p>
            <ul>
              {(depsModal.dependencies || []).map((d, i) => (
                <li key={i}>
                  <strong>{d.type}</strong>: {d.name} {d.detail ? `(${d.detail})` : ''}
                </li>
              ))}
            </ul>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
              Dependents will fail at next run until updated. Continue?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setDepsModal(null)}>
                Cancel
              </button>
              <button type="button" onClick={confirmDelete} disabled={busy}>
                Delete anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApiKeys() {
  return (
    <RequireAuth>
      <ApiKeysPanel />
    </RequireAuth>
  );
}
