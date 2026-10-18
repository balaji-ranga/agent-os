import { useEffect, useState } from 'react';
import { api } from '../api';

export default function CopilotQualityControls() {
  const [settings, setSettings] = useState(null), [enabled, setEnabled] = useState(false), [mode, setMode] = useState('platform_inactive');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const apply = value => { setSettings(value); setEnabled(value.enabled); setMode(value.checkerMode); };
  useEffect(() => { let mounted = true; api.adminCopilotQualityGet().then(value => { if (mounted) apply(value); }).catch(e => { if (mounted) setError(e.message); }); return () => { mounted = false; }; }, []);
  const save = async () => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { const result = await api.adminCopilotQualitySave({ enabled, checkerMode: mode }); apply(result); setMessage(result.enabled ? 'Maker/checker enabled for all Digital Adoption copilots. New requests require checker review.' : 'Maker-only enabled for all Digital Adoption copilots.'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <section className="panel" aria-labelledby="copilot-quality-heading">
    <h2 id="copilot-quality-heading">Digital Adoption copilot review</h2>
    <p>One platform setting applies to every website copilot, including visitor chat, private-task guidance and workflow proposals. Field approval and Action Policies still apply.</p>
    {settings && <p>Current mode: <strong>{settings.enabled ? 'Maker / checker' : 'Maker only'}</strong>. Maker: {settings.maker.label}. Checker: {settings.checker.label} ({settings.checker.slot}).</p>}
    <fieldset disabled={busy || !settings} style={{ border: 0, padding: 0 }}>
      <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Enable maker/checker for all copilots</label>
      <label style={{ display: 'block', marginTop: 12 }}>Checker route{' '}<select value={mode} onChange={e => setMode(e.target.value)}>
        <option value="platform_inactive">Inactive platform model slot</option><option value="ollama_reasoning">Ollama reasoning (efficiency)</option>
      </select></label>
      <p>The active model makes the proposal. The checker accepts, requests one revision, asks for clarification or rejects it. An unavailable checker stops the request. Disabling review preserves maker-only behavior for new requests.</p>
      <button type="button" className="wf-btn" disabled={busy || !settings || enabled === settings.enabled && mode === settings.checkerMode} aria-busy={busy} onClick={save}>{busy ? 'Saving…' : 'Save copilot review settings'}</button>
    </fieldset>
    {settings?.enabled && !settings.checker.configured && <p role="alert">The selected checker is not configured. Copilot requests will stop until it is available or review is disabled.</p>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
