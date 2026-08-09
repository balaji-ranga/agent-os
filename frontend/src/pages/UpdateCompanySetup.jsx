/**
 * Profile -> Update Company Setup - company_memory Knowledge + strategic profile.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function UpdateCompanySetup() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [presets, setPresets] = useState([]);
  const [companyTypes, setCompanyTypes] = useState([]);
  const [tableInfo, setTableInfo] = useState(null);
  const [form, setForm] = useState({
    company_name: '',
    mission: '',
    org_dna: '',
    org_dna_notes: '',
    company_type: '',
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.companyMemoryCaptureGet();
      const f = res.fields || {};
      setForm({
        company_name: f.company_name || '',
        mission: f.mission || '',
        org_dna: f.org_dna || '',
        org_dna_notes: f.org_dna_notes || '',
        company_type: f.company_type || '',
      });
      setPresets(res.org_dna_presets || []);
      setCompanyTypes(res.company_types || []);
      setTableInfo(res.table || null);
    } catch (e) {
      setError(e.message || 'Failed to load company capture');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const save = async (e) => {
    e?.preventDefault?.();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.companyMemoryCaptureUpdate(form);
      setMessage('Saved to Knowledge table company_memory and company setup profile.');
      const cap = res.capture || (await api.companyMemoryCaptureGet());
      const f = cap.fields || {};
      setForm({
        company_name: f.company_name || '',
        mission: f.mission || '',
        org_dna: f.org_dna || '',
        org_dna_notes: f.org_dna_notes || '',
        company_type: f.company_type || '',
      });
      setTableInfo(cap.table || res.table || null);
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const selectedDna = presets.find((p) => p.id === form.org_dna);

  return (
    <div className="nav-menus-page">
      <header className="this-week-header">
        <div>
          <h1>Update Company Setup</h1>
          <p className="this-week-sub">
            Edit company identity stored in Knowledge <code>company_memory</code> (mission, DNA, company name, industry). Creates the table if missing. Full team/blueprint wizard:{' '}
            <Link to="/company-setup">Company setup</Link>.
          </p>
        </div>
        <div className="this-week-header-actions">
          <Link className="btn secondary" to="/master-data">Knowledge</Link>
          <Link className="btn secondary" to="/company-setup">Full Company setup</Link>
        </div>
      </header>

      {loading && <p>Loading…</p>}
      {error && <p className="error-text">{error}</p>}
      {message && <p className="success-text">{message}</p>}

      {!loading && (
        <section className="this-week-card" style={{ maxWidth: 640 }}>
          <h3 className="this-week-card-title">Company memory</h3>
          <p className="this-week-muted" style={{ marginTop: 0 }}>
            Table:{' '}
            {tableInfo?.exists === false ? (
              <em>will be created on save</em>
            ) : (
              <>
                <code>company_memory</code>
                {tableInfo?.id ? <> · id {tableInfo.id}</> : null}
              </>
            )}
          </p>
          <form onSubmit={save} style={{ display: 'grid', gap: '0.85rem' }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Company name</span>
              <input value={form.company_name} onChange={(ev) => setField('company_name', ev.target.value)} placeholder="Your company" autoComplete="organization" />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Industry / company type</span>
              {companyTypes.length > 0 ? (
                <select value={form.company_type} onChange={(ev) => setField('company_type', ev.target.value)}>
                  <option value="">— Select —</option>
                  {companyTypes.map((t) => (
                    <option key={t.id || t.label} value={t.id || t.label}>{t.label || t.id}</option>
                  ))}
                </select>
              ) : (
                <input value={form.company_type} onChange={(ev) => setField('company_type', ev.target.value)} placeholder="e.g. content_creator" />
              )}
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Mission</span>
              <textarea rows={4} value={form.mission} onChange={(ev) => setField('mission', ev.target.value)} placeholder="What does the company exist to achieve?" />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Organization DNA</span>
              <select value={form.org_dna} onChange={(ev) => setField('org_dna', ev.target.value)}>
                <option value="">— Select —</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              {selectedDna ? (
                <span className="this-week-muted" style={{ fontSize: '0.85rem' }}>{selectedDna.seed}</span>
              ) : null}
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>DNA notes (optional)</span>
              <textarea rows={3} value={form.org_dna_notes} onChange={(ev) => setField('org_dna_notes', ev.target.value)} placeholder="Extra operating notes" />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="submit" className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save to Knowledge'}</button>
              <button type="button" className="btn secondary" disabled={saving} onClick={load}>Reload</button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
