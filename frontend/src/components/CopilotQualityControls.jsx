import { useEffect, useState } from 'react';
import { api } from '../api';

export default function CopilotQualityControls() {
  const [settings, setSettings] = useState(null), [enabled, setEnabled] = useState(false), [mode, setMode] = useState('platform_inactive');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [deployment,setDeployment]=useState(''),[thinking,setThinking]=useState(false);
  const [budget,setBudget]=useState(700);
  const apply = value => { setSettings(value); setEnabled(value.enabled); setMode(value.checkerMode);setDeployment(value.checkerDeploymentId||'');setThinking(value.localThinking===true);setBudget(value.checkerMaxTokens??700); };
  useEffect(() => { let mounted = true; api.adminCopilotQualityGet().then(value => { if (mounted) apply(value); }).catch(e => { if (mounted) setError(e.message); }); return () => { mounted = false; }; }, []);
  const save = async () => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { const result = await api.adminCopilotQualitySave({ enabled, checkerMode: mode,checkerMaxTokens:budget,...(mode==='ollama_local'?{checkerDeploymentId:deployment,localThinking:thinking}:{}) }); apply(result); setMessage(result.enabled ? 'Maker/checker enabled for all Digital Adoption copilots. New requests require checker review.' : 'Maker-only enabled for all Digital Adoption copilots.'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <section className="panel" aria-labelledby="copilot-quality-heading">
    <h2 id="copilot-quality-heading">Digital Adoption copilot review</h2>
    <p>One platform setting applies to every website copilot, including visitor chat, private-task guidance and workflow proposals. Field approval and Action Policies still apply.</p>
    {settings && <p>Current mode: <strong>{settings.enabled ? 'Maker / checker' : 'Maker only'}</strong>. Maker: {settings.maker.label}. Checker: {settings.checker.label} ({settings.checker.slot}).</p>}
    <fieldset disabled={busy || !settings} style={{ border: 0, padding: 0 }}>
      <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Enable maker/checker for all copilots</label>
      <label style={{ display: 'block', marginTop: 12 }}>Checker route{' '}<select value={mode} onChange={e => setMode(e.target.value)}>
        <option value="platform_inactive">Inactive platform model slot</option><option value="ollama_local">Local / efficiency model (choose registered deployment)</option><option value="ollama_reasoning">Legacy Ollama reasoning route</option>
      </select></label>
      {mode==='ollama_local'&&<>
        <label style={{display:'block',marginTop:12}}>Local checker model{' '}<select value={deployment} onChange={e=>setDeployment(e.target.value)}>
          <option value="">Select a registered local model</option>
          {deployment&&!settings?.localModels?.some(row=>row.id===deployment)&&<option value={deployment}>{deployment} (unavailable)</option>}
          {(settings?.localModels||[]).map(row=><option key={row.id} value={row.id}>{row.name} — {row.model}</option>)}
        </select></label>
        <label style={{display:'block',marginTop:8}}><input type="checkbox" checked={thinking} onChange={e=>setThinking(e.target.checked)}/> Enable thinking for this checker (requires model support; may increase latency)</label>
        <p>This selection is independent of the general efficiency and reasoning model routes. A configured model is not a quality certification. Unsupported capabilities, incomplete output and contradictory verdicts stop review.</p>
      </>}
      <label style={{display:'block',marginTop:12}}>Checker output token budget{' '}<input type="number" min="128" max="2048" step="1" value={budget} onChange={e=>setBudget(Number(e.target.value))}/></label>
      <p>128–2,048 output tokens, including local reasoning. A larger budget may need more time; the shared request deadline still applies. There is no hidden minimum. Compare model quality and latency before changing this value.</p>
      <p>The active model makes the proposal. The checker accepts, requests one revision, asks for clarification or rejects it. An unavailable checker stops the request. Disabling review preserves maker-only behavior for new requests.</p>
      <button type="button" className="wf-btn" disabled={busy || !settings || !Number.isInteger(budget)||budget<128||budget>2048 || mode==='ollama_local'&&!deployment || enabled === settings.enabled && mode === settings.checkerMode && budget===(settings.checkerMaxTokens??700) && (mode!=='ollama_local'||deployment===settings.checkerDeploymentId&&thinking===settings.localThinking)} aria-busy={busy} onClick={save}>{busy ? 'Saving…' : 'Save copilot review settings'}</button>
    </fieldset>
    {settings?.enabled && !settings.checker.configured && <p role="alert">The selected checker is not configured. Copilot requests will stop until it is available or review is disabled.</p>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
