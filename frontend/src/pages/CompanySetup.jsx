import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

const STYLES = [
  { id: 'suggest', title: 'AI suggests', desc: 'AI employees draft; you decide and act.' },
  { id: 'after_approval', title: 'AI after approval', desc: 'AI prepares work; public actions wait for CEO approval.' },
  { id: 'autonomous', title: 'AI autonomous', desc: 'AI may execute within budgets and tool grants. Use carefully.' },
];

const HEADCOUNTS = [
  { id: 'just_me', label: 'Just me' },
  { id: '2-10', label: '2-10' },
  { id: '10-100', label: '10-100' },
  { id: '100+', label: '100+' },
];

const FALLBACK_DNA = [
  { id: 'fast_startup', label: 'Fast-moving startup', seed: 'Low ceremony; short feedback loops.' },
  { id: 'cost_conscious', label: 'Cost-conscious', seed: 'Tighter budgets; justify spend.' },
  { id: 'enterprise', label: 'Enterprise governance', seed: 'Approvals default; formal escalation.' },
  { id: 'creative_agency', label: 'Creative agency', seed: 'Brand voice; publish review gates.' },
  { id: 'customer_obsessed', label: 'Customer-obsessed', seed: 'Customer risk escalates fast.' },
  { id: 'data_driven', label: 'Data-driven', seed: 'Metrics-first; weekly rollups.' },
];

const STEPS = ['welcome', 'type', 'identity', 'mission', 'dna', 'preview', 'meet_team', 'systems', 'style', 'review', 'done'];

function btnPrimary(extra = {}) {
  return {
    padding: '0.55rem 1rem',
    background: 'var(--accent)',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.95rem',
    ...extra,
  };
}

function btnSecondary(extra = {}) {
  return {
    padding: '0.55rem 1rem',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.95rem',
    ...extra,
  };
}

export default function CompanySetup() {
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('welcome');
  const [describe, setDescribe] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [headcount, setHeadcount] = useState('just_me');
  const [country, setCountry] = useState('');
  const [industry, setIndustry] = useState('');
  const [selectedType, setSelectedType] = useState('content_creator');
  const [mission, setMission] = useState('');
  const [orgDna, setOrgDna] = useState('fast_startup');
  const [orgDnaNotes, setOrgDnaNotes] = useState('');
  const [systems, setSystems] = useState([]);
  const [mgmtStyle, setMgmtStyle] = useState('after_approval');
  const [selection, setSelection] = useState({});
  const [day1, setDay1] = useState(null);
  const [connectorQuery, setConnectorQuery] = useState('');
  const [connectorHits, setConnectorHits] = useState([]);
  const [connectorSearchBusy, setConnectorSearchBusy] = useState(false);
  const [connectorSearchErr, setConnectorSearchErr] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await api.companySetupFunnel();
      setState(data);
      // Resume only mid-funnel. Completed/skipped/profile visits always show Create/Open menu.
      const gate = data.setup_gate;
      const fs = data.funnel_step;
      if (gate === 'in_progress' && fs && fs !== 'welcome' && fs !== 'done') {
        setStep(fs);
      } else {
        setStep('welcome');
      }
      if (data.company_type_card) setSelectedType(data.company_type_card);
      else if (data.company_type) setSelectedType(data.company_type);
      if (data.mission) setMission(data.mission);
      if (data.org_dna) setOrgDna(data.org_dna);
      if (data.org_dna_notes) setOrgDnaNotes(data.org_dna_notes);
      if (data.company_name) setCompanyName(data.company_name);
      if (data.strategic_profile?.describe_company) setDescribe(data.strategic_profile.describe_company);
      if (data.strategic_profile?.headcount) setHeadcount(data.strategic_profile.headcount);
      if (data.strategic_profile?.country) setCountry(data.strategic_profile.country);
      if (data.strategic_profile?.industry) setIndustry(data.strategic_profile.industry);
      if (Array.isArray(data.systems)) setSystems(data.systems);
      if (data.management_style) setMgmtStyle(data.management_style);
      if (data.day1) setDay1(data.day1);
      const sel = {};
      for (const item of data.selectable_items || []) sel[item.id] = item.selected !== false;
      if (Object.keys(sel).length) setSelection(sel);
    } catch (e) {
      setError(e?.message || 'Failed to load company setup');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const types = state?.company_types || [];
  const dnaPresets = state?.org_dna_presets?.length ? state.org_dna_presets : FALLBACK_DNA;
  const catalog = state?.systems_top?.length ? state.systems_top : (state?.systems_catalog || []).slice(0, 10);
  const orgTree = state?.org_tree;
  const blueprint = state?.blueprint;
  const proposal = state?.proposal;

  const selectable = useMemo(() => {
    if (state?.selectable_items?.length) return state.selectable_items;
    const add = (kind, items = []) =>
      (items || []).map((item, index) => {
        const label = typeof item === 'string' ? item : item.name || item.title || String(index);
        const id = `${kind}:${String(label).trim().toLowerCase().replace(/\s+/g, '-')}`;
        return { id, kind, label, selected: selection[id] !== false };
      });
    return [
      ...add('department', proposal?.departments),
      ...add('agent', proposal?.agents),
      ...add('workflow', proposal?.workflows),
      ...add('knowledge_table', proposal?.knowledge_tables),
      ...add('md_file', proposal?.md_files || proposal?.sop_documents),
    ];
  }, [state, proposal, selection]);

  async function saveDraft(body) {
    setBusy(true);
    setError('');
    try {
      const data = await api.companySetupSaveFunnel(body);
      setState(data);
      const sel = {};
      for (const item of data.selectable_items || []) sel[item.id] = item.selected !== false;
      if (Object.keys(sel).length) setSelection((prev) => ({ ...sel, ...prev }));
      return data;
    } catch (e) {
      setError(e?.message || 'Save failed');
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function openExisting() {
    setBusy(true);
    setError('');
    try {
      if (state?.setup_gate !== 'completed' && state?.setup_gate !== 'skipped') {
        await api.companySetupSkip();
      }
      navigate('/', { replace: true });
    } catch (e) {
      setError(e?.message || 'Could not open existing company');
    } finally {
      setBusy(false);
    }
  }

  async function beginCreate() {
    setBusy(true);
    setError('');
    try {
      const data = await api.companySetupBegin();
      setState(data);
      setStep('type');
    } catch (e) {
      setError(e?.message || 'Could not start company setup');
    } finally {
      setBusy(false);
    }
  }

  async function goTypeNext() {
    await saveDraft({
      funnel_step: 'identity',
      company_type: selectedType,
      describe_company: describe || undefined,
    });
    setStep('identity');
  }

  async function goIdentityNext() {
    if (!String(companyName).trim()) {
      setError('Company name is required');
      return;
    }
    await saveDraft({
      funnel_step: 'mission',
      company_name: companyName.trim(),
      headcount,
      country: country || undefined,
      industry: industry || undefined,
      company_type: selectedType,
    });
    setStep('mission');
  }

  async function goMissionNext() {
    if (String(mission || '').trim().length < 10) {
      setError('Mission should be at least ~10 characters');
      return;
    }
    await saveDraft({
      funnel_step: 'dna',
      mission: mission.trim(),
      company_type: selectedType,
      keep_proposal: true,
    });
    setStep('dna');
  }

  async function goDnaNext() {
    setBusy(true);
    setError('');
    try {
      await saveDraft({
        funnel_step: 'preview',
        org_dna: orgDna,
        org_dna_notes: orgDnaNotes || undefined,
        mission: mission.trim(),
        company_type: selectedType,
      });
      const designed = await api.companySetupDesign();
      setState(designed);
      const sel = {};
      for (const item of designed.selectable_items || []) sel[item.id] = item.selected !== false;
      if (Object.keys(sel).length) setSelection(sel);
      setStep('preview');
    } catch (e) {
      setError(e?.message || 'Could not design organization');
    } finally {
      setBusy(false);
    }
  }

  async function goPreviewNext() {
    await saveDraft({ funnel_step: 'meet_team', company_type: selectedType, keep_proposal: true });
    setStep('meet_team');
  }

  async function goMeetNext() {
    await saveDraft({ funnel_step: 'systems', company_type: selectedType, keep_proposal: true });
    setStep('systems');
  }

  async function goSystemsNext() {
    await saveDraft({ funnel_step: 'style', systems, company_type: selectedType, keep_proposal: true });
    setStep('style');
  }

  async function goStyleNext() {
    await saveDraft({
      funnel_step: 'review',
      management_style: mgmtStyle,
      company_type: selectedType,
      keep_proposal: true,
    });
    setStep('review');
  }

  async function searchConnectors() {
    const q = String(connectorQuery || '').trim();
    if (q.length < 2) {
      setConnectorSearchErr('Type at least 2 characters');
      return;
    }
    setConnectorSearchBusy(true);
    setConnectorSearchErr('');
    try {
      const data = await api.companySetupConnectorSearch(q);
      setConnectorHits(data.apps || []);
      if (data.error) setConnectorSearchErr(data.error);
      else if (data.warning && !(data.apps || []).length) setConnectorSearchErr(data.warning);
      else setConnectorSearchErr('');
    } catch (e) {
      setConnectorSearchErr(e?.message || 'Search failed');
      setConnectorHits([]);
    } finally {
      setConnectorSearchBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setError('');
    try {
      await saveDraft({
        funnel_step: 'review',
        management_style: mgmtStyle,
        systems,
        company_type: selectedType,
        company_name: companyName,
        keep_proposal: true,
      });
      const result = await api.companySetupApply(selection);
      setState(result);
      setDay1(result.day1 || null);
      setStep('done');
    } catch (e) {
      setError(e?.message || 'Apply failed');
    } finally {
      setBusy(false);
    }
  }

  function toggleSystem(id) {
    setSystems((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleItem(id) {
    setSelection((prev) => ({ ...prev, [id]: prev[id] === false ? true : false }));
  }

  if (!state && !error) {
    return <div style={{ padding: '2rem' }}>Loading company setup…</div>;
  }

  const stepIdx = STEPS.indexOf(step);

  return (
    <div className="company-setup" style={{ maxWidth: 960, margin: '0 auto', padding: '1.5rem 1.25rem 3rem' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <p style={{ margin: 0, opacity: 0.7, fontSize: '0.85rem' }}>Flolah · Company setup</p>
        <h1 style={{ margin: '0.25rem 0 0.35rem', fontSize: '1.75rem', fontWeight: 700 }}>
          {step === 'welcome' ? 'Welcome to Flolah' : step === 'done' ? 'Your company is ready' : 'Set up your company'}
        </h1>
        {step === 'welcome' && (
          <p style={{ margin: 0, opacity: 0.75, maxWidth: '40rem' }}>
            The Operating System for AI-Native Companies
          </p>
        )}
        {step !== 'welcome' && step !== 'done' && (
          <p style={{ margin: '0.35rem 0 0', opacity: 0.65, fontSize: '0.85rem' }}>
            Step {Math.max(1, stepIdx)} of {STEPS.length - 2}
          </p>
        )}
      </header>

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            border: '1px solid color-mix(in srgb, #c44 40%, var(--border))',
            borderRadius: 8,
            background: 'color-mix(in srgb, #c44 10%, var(--surface))',
          }}
        >
          {error}
        </div>
      )}

      {step === 'welcome' && (
        <section style={{ display: 'grid', gap: '1rem', maxWidth: 480 }}>
          {(state?.setup_gate === 'completed' || state?.setup_gate === 'skipped') && (
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                fontSize: '0.9rem',
              }}
            >
              {state?.setup_gate === 'completed' ? (
                <>
                  <strong>{state.company_name || 'Your company'}</strong>
                  {state.company_type ? (
                    <span style={{ opacity: 0.75 }}>
                      {' '}- {String(state.company_type).replace(/_/g, ' ')}
                    </span>
                  ) : null}
                  <div style={{ opacity: 0.75, marginTop: 4 }}>
                    Setup is complete. Open Home, or run setup again to add another blueprint pack
                    (adds AI employees; does not delete existing ones).
                  </div>
                </>
              ) : (
                <div style={{ opacity: 0.8 }}>
                  Company setup was skipped. You can create a company now or go to Home.
                </div>
              )}
            </div>
          )}
          <button type="button" disabled={busy} style={btnPrimary()} onClick={beginCreate}>
            {state?.setup_gate === 'completed' ? 'Run company setup again' : 'Create a company'}
          </button>
          <button type="button" disabled={busy} style={btnSecondary()} onClick={openExisting}>
            {state?.setup_gate === 'completed' || state?.setup_gate === 'skipped'
              ? 'Open existing company (Home)'
              : 'Open existing company'}
          </button>
          {state?.setup_gate === 'completed' && (
            <button type="button" disabled={busy} style={btnSecondary()} onClick={() => setStep('done')}>
              View day-1 briefing
            </button>
          )}
          <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.7 }}>
            You can reopen this anytime from Profile - Company setup. Detailed chat onboarding remains under{' '}
            <Link to="/onboarding">Onboarding</Link>.
          </p>
        </section>
      )}

      {step === 'type' && (
        <section>
          <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>What are you building?</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))',
              gap: '0.65rem',
              marginBottom: '1.25rem',
            }}
          >
            {types.map((card) => {
              const active = selectedType === card.id;
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setSelectedType(card.id)}
                  style={btnSecondary({
                    textAlign: 'left',
                    minHeight: 72,
                    borderColor: active ? 'var(--accent)' : 'var(--border)',
                    background: active ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))' : 'var(--surface)',
                    fontWeight: card.featured ? 600 : 400,
                  })}
                >
                  <div>{card.label}</div>
                  {card.featured && <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: 4 }}>Full blueprint</div>}
                </button>
              );
            })}
          </div>
          <label style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.9rem' }}>
            Or describe your company (optional)
          </label>
          <textarea
            value={describe}
            onChange={(e) => setDescribe(e.target.value)}
            rows={3}
            placeholder="I run an online jewellery store with Instagram sales…"
            style={{
              width: '100%',
              maxWidth: 560,
              padding: '0.65rem 0.75rem',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              font: 'inherit',
              marginBottom: '1rem',
            }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" style={btnSecondary()} disabled={busy} onClick={() => setStep('welcome')}>
              Back
            </button>
            <button type="button" style={btnPrimary()} disabled={busy} onClick={goTypeNext}>
              Continue
            </button>
          </div>
        </section>
      )}

      {step === 'identity' && (
        <section style={{ maxWidth: 480 }}>
          <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>Company identity</h2>
          <label style={{ display: 'block', marginBottom: 4 }}>Company name</label>
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            style={{
              width: '100%',
              padding: '0.55rem 0.7rem',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              font: 'inherit',
              marginBottom: '0.85rem',
            }}
          />
          <label style={{ display: 'block', marginBottom: 4 }}>Team size</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.85rem' }}>
            {HEADCOUNTS.map((h) => (
              <button
                key={h.id}
                type="button"
                style={btnSecondary({
                  borderColor: headcount === h.id ? 'var(--accent)' : 'var(--border)',
                  background: headcount === h.id ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))' : 'var(--surface)',
                })}
                onClick={() => setHeadcount(h.id)}
              >
                {h.label}
              </button>
            ))}
          </div>
          <label style={{ display: 'block', marginBottom: 4 }}>Country / region</label>
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            style={{
              width: '100%',
              padding: '0.55rem 0.7rem',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              font: 'inherit',
              marginBottom: '0.85rem',
            }}
          />
          <label style={{ display: 'block', marginBottom: 4 }}>Industry (optional)</label>
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            style={{
              width: '100%',
              padding: '0.55rem 0.7rem',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              font: 'inherit',
              marginBottom: '1rem',
            }}
          />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" style={btnSecondary()} disabled={busy} onClick={() => setStep('type')}>
              Back
            </button>
            <button type="button" style={btnPrimary()} disabled={busy} onClick={goIdentityNext}>
              {busy ? 'Designing org?' : 'Continue'}
            </button>
          </div>
        </section>
      )}


      {step === 'mission' && (
        <section style={{ maxWidth: 560 }}>
          <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>What is your mission?</h2>
          <p style={{ opacity: 0.75 }}>
            Every AI employee will evaluate decisions against this mission. This becomes the top of Company Memory.
          </p>
          <textarea
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            rows={4}
            placeholder="Help creators publish better content every day."
            style={{
              width: '100%',
              padding: '0.65rem 0.75rem',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              font: 'inherit',
              marginBottom: '1rem',
            }}
          />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" style={btnSecondary()} disabled={busy} onClick={() => setStep('identity')}>
              Back
            </button>
            <button type="button" style={btnPrimary()} disabled={busy} onClick={goMissionNext}>
              Continue
            </button>
          </div>
        </section>
      )}

      {step === 'dna' && (
        <section style={{ maxWidth: 560 }}>
          <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>Organization DNA</h2>
          <p style={{ opacity: 0.75 }}>
            How should the company operate? This shapes policy tone, escalation, and how AI employees work under you as CEO.
          </p>
          <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1rem' }}>
            {dnaPresets.map((d) => {
              const on = orgDna === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  style={btnSecondary({
                    textAlign: 'left',
                    borderColor: on ? 'var(--accent)' : 'var(--border)',
                    background: on ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))' : 'var(--surface)',
                  })}
                  onClick={() => setOrgDna(d.id)}
                >
                  <div style={{ fontWeight: 600 }}>{d.label}</div>
                  <div style={{ fontSize: '0.85rem', opacity: 0.75 }}>{d.seed || d.description || ''}</div>
                </button>
              );
            })}
          </div>
          <label style={{ display: 'block', marginBottom: 4 }}>Optional notes</label>
          <input
            value={orgDnaNotes}
            onChange={(e) => setOrgDnaNotes(e.target.value)}
            placeholder="Any blend or constraints for how the company should run"
            style={{
              width: '100%',
              padding: '0.55rem 0.7rem',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              font: 'inherit',
              marginBottom: '1rem',
            }}
          />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" style={btnSecondary()} disabled={busy} onClick={() => setStep('mission')}>
              Back
            </button>
            <button type="button" style={btnPrimary()} disabled={busy} onClick={goDnaNext}>
              {busy ? 'Designing org?' : 'Design organization'}
            </button>
          </div>
        </section>
      )}

      {step === 'meet_team' && (
        <section>
          <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>Meet your team</h2>
          <p style={{ opacity: 0.75 }}>
            Built around you as CEO. These AI employees report toward COO / your leadership; Company Memory holds mission and DNA for the whole company.
          </p>
          {mission && (
            <p style={{ padding: '0.75rem 1rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}>
              <strong>Mission:</strong> {mission}
            </p>
          )}
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '1rem 1.1rem',
              margin: '1rem 0',
              background: 'var(--surface)',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>You ? CEO (owner)</div>
            <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '0.75rem' }}>
              Design source:{' '}
              {state?.design_source === 'llm' ? 'AI-designed for your industry' : state?.design_source || 'template'}
            </div>
            {(proposal?.agents || []).map((a) => (
              <div key={a.name} style={{ marginBottom: '0.65rem', paddingLeft: '0.75rem', borderLeft: '2px solid var(--border)' }}>
                <div style={{ fontWeight: 600 }}>{a.name}</div>
                <div style={{ fontSize: '0.85rem', opacity: 0.75 }}>
                  {a.role}
                  {a.department ? ` ? ${a.department}` : ''}
                </div>
              </div>
            ))}
            {!(proposal?.agents || []).length && (
              <p style={{ opacity: 0.7 }}>No AI employees in proposal yet ? go back and redesign.</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" style={btnSecondary()} disabled={busy} onClick={() => setStep('preview')}>
              Back
            </button>
            <button type="button" style={btnPrimary()} disabled={busy} onClick={goMeetNext}>
              Continue to systems
            </button>
          </div>
        </section>
      )}

      {step === 'preview' && (
        <section>
          <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>Your organization is ready to hire</h2>
          <p style={{ opacity: 0.75 }}>
            Based on <strong>{blueprint?.label || selectedType}</strong>
            {state?.design_source === 'llm'
              ? ' (AI-designed for your industry ? no dedicated template), '
              : state?.design_source === 'template'
                ? ' (template pack), '
                : ', '}
            we prepared departments and AI employees. Nothing is created until you apply.
          </p>
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '1rem 1.1rem',
              marginBottom: '1rem',
              background: 'var(--surface)',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: '0.75rem' }}>{orgTree?.root?.label || 'You — CEO'}</div>
            {(orgTree?.departments || []).map((d) => (
              <div key={d.name} style={{ marginBottom: '0.75rem', paddingLeft: '0.75rem', borderLeft: '2px solid var(--border)' }}>
                <div style={{ fontWeight: 600 }}>{d.name}</div>
                {d.purpose && <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>{d.purpose}</div>}
                <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
                  {(d.employees || []).map((e) => (
                    <li key={e.name}>
                      {e.name}
                      {e.role ? <span style={{ opacity: 0.65 }}> — {e.role}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" style={btnSecondary()} disabled={busy} onClick={() => setStep('dna')}>
              Back
            </button>
            <button type="button" style={btnPrimary()} disabled={busy} onClick={goPreviewNext}>
              Continue to meet the team
            </button>
          </div>
        </section>
      )}

      {step === 'systems' && (
        <section>
          <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>What systems do you use?</h2>
          <p style={{ opacity: 0.75, maxWidth: 520 }}>
            We will recommend connection steps after apply. Selecting an item does not grant remote access now.
          </p>
          <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>Top systems (not live connections yet ? day-1 checklist only).</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(12rem, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
            {catalog.map((s) => {
              const on = systems.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  style={btnSecondary({
                    textAlign: 'left',
                    borderColor: on ? 'var(--accent)' : 'var(--border)',
                    background: on ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))' : 'var(--surface)',
                  })}
                  onClick={() => toggleSystem(s.id)}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          <h3 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>Search OpenConnector inventory</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem', maxWidth: 520 }}>
            <input
              value={connectorQuery}
              onChange={(e) => setConnectorQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  searchConnectors();
                }
              }}
              placeholder="Search apps (e.g. Shopify, Asana)..."
              style={{
                flex: '1 1 14rem',
                padding: '0.55rem 0.7rem',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                font: 'inherit',
              }}
            />
            <button type="button" style={btnSecondary()} disabled={connectorSearchBusy} onClick={searchConnectors}>
              {connectorSearchBusy ? 'Searching...' : 'Search'}
            </button>
          </div>
          {connectorSearchErr && (
            <p style={{ color: '#b45309', fontSize: '0.85rem' }}>{connectorSearchErr}</p>
          )}
          {connectorHits.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(12rem, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
              {connectorHits.map((s) => {
                const id = s.id || s.oc_id;
                const on = systems.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    style={btnSecondary({
                      textAlign: 'left',
                      borderColor: on ? 'var(--accent)' : 'var(--border)',
                      background: on ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))' : 'var(--surface)',
                    })}
                    onClick={() => toggleSystem(id)}
                  >
                    {s.label}
                    <div style={{ fontSize: '0.75rem', opacity: 0.65 }}>OpenConnector</div>
                  </button>
                );
              })}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" style={btnSecondary()} disabled={busy} onClick={() => setStep('meet_team')}>
              Back
            </button>
            <button type="button" style={btnPrimary()} disabled={busy} onClick={goSystemsNext}>
              Continue
            </button>
          </div>
        </section>
      )}

      {step === 'style' && (
        <section style={{ maxWidth: 560 }}>
          <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>Management style</h2>
          <p style={{ opacity: 0.75 }}>This seeds your company Policies for AI employees.</p>
          <div style={{ display: 'grid', gap: '0.55rem', marginBottom: '1rem' }}>
            {STYLES.map((s) => {
              const on = mgmtStyle === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  style={btnSecondary({
                    textAlign: 'left',
                    borderColor: on ? 'var(--accent)' : 'var(--border)',
                    background: on ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))' : 'var(--surface)',
                  })}
                  onClick={() => setMgmtStyle(s.id)}
                >
                  <div style={{ fontWeight: 600 }}>{s.title}</div>
                  <div style={{ fontSize: '0.85rem', opacity: 0.75 }}>{s.desc}</div>
                </button>
              );
            })}
          </div>
          {state?.policy_preview && (
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: '0.8rem',
                padding: '0.75rem',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                marginBottom: '1rem',
              }}
            >
              {state.policy_preview}
            </pre>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" style={btnSecondary()} disabled={busy} onClick={() => setStep('systems')}>
              Back
            </button>
            <button type="button" style={btnPrimary()} disabled={busy} onClick={goStyleNext}>
              Review and apply
            </button>
          </div>
        </section>
      )}

      {step === 'review' && (
        <section>
          <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>Review and create</h2>
          <p style={{ opacity: 0.75 }}>
            Choose what to create now. You can hire more AI employees later under AI Employees.
          </p>
          {state?.existing_org?.has_custom_agents && (
            <p style={{ color: '#b45309' }}>
              You already have custom AI employees ({state.existing_org.custom_agent_count}). Applying will add blueprint
              hires (not delete existing).
            </p>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem' }}>
            {selectable.map((item) => (
              <li key={item.id} style={{ marginBottom: '0.35rem' }}>
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selection[item.id] !== false}
                    onChange={() => toggleItem(item.id)}
                  />
                  <span style={{ opacity: 0.65, fontSize: '0.8rem', minWidth: 100 }}>{item.kind}</span>
                  <span>{item.label}</span>
                </label>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" style={btnSecondary()} disabled={busy} onClick={() => setStep('style')}>
              Back
            </button>
            <button type="button" style={btnPrimary()} disabled={busy} onClick={apply}>
              {busy ? 'Creating…' : 'Create company org'}
            </button>
          </div>
        </section>
      )}

      {step === 'done' && (
        <section>
          <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>Day-1 briefing</h2>
          <p style={{ fontSize: '1.05rem' }}>
            {day1?.message || state?.day1?.message || 'Company setup complete.'}
          </p>
          {(day1?.mission || state?.day1?.mission || mission) && (
            <p style={{ opacity: 0.85 }}>
              <strong>Mission:</strong> {day1?.mission || state?.day1?.mission || mission}
            </p>
          )}
          {(day1?.next_steps || state?.day1?.next_steps || []).length > 0 && (
            <>
              <h3 style={{ fontSize: '1rem' }}>Recommended next steps</h3>
              <ul>
                {(day1?.next_steps || state?.day1?.next_steps || []).map((n) => (
                  <li key={n.id || n.label}>
                    {n.path ? <Link to={n.path}>{n.label}</Link> : n.label}
                    {n.note ? <span style={{ opacity: 0.7 }}> — {n.note}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' }}>
            <button type="button" style={btnSecondary()} onClick={() => setStep('welcome')}>
              Setup menu
            </button>
            {(day1?.links ||
              state?.day1?.links || [
                { label: 'Home', path: '/' },
                { label: 'AI Employees', path: '/workspace' },
              ]).map((l) => (
              <Link
                key={l.path}
                to={l.path}
                style={{ ...btnPrimary({ textDecoration: 'none', display: 'inline-block' }) }}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
