import { useEffect, useState } from 'react';
import {physicalEnrollmentArchive} from '../../services/physicalEnrollment';
import { getAuthToken } from '../../api';

const base = `${import.meta.env.VITE_API_URL || '/api'}/physical`;
async function call(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { Authorization: `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json', ...options.headers } });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || `Request failed (${response.status})`); }
  return response;
}
function save(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export default function PhysicalAiPanel() {
  const [catalog, setCatalog] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [site, setSite] = useState(''), [name, setName] = useState('');
  useEffect(() => { let active = true; call('/packages').then(r => r.json()).then(data => { if (active) setCatalog(data); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  async function download(pkg) { setBusy(true); setError(''); try { const r = await call(`/packages/${encodeURIComponent(pkg.file)}`); const blob = await r.blob(); const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(n => n.toString(16).padStart(2, '0')).join(''); if (hash !== pkg.sha256) throw new Error('Package checksum mismatch'); save(blob, pkg.file); } catch(e) { setError(e.message); } finally { setBusy(false); } }
  async function enroll() { setBusy(true); setError(''); try { const r = await call('/hubs', { method: 'POST', body: JSON.stringify({ siteId: site, name }) }); const h = await r.json(); const bytes = crypto.getRandomValues(new Uint8Array(32)); const cloudUrl = new URL(base + '/hub', location.origin).href.replace(/^http/, 'ws'); const localToken = Array.from(bytes).map(n => n.toString(16).padStart(2, '0')).join(''); save(physicalEnrollmentArchive(h,cloudUrl,localToken), 'flolah-edge-private-config.zip'); } catch(e) { setError(e.message); } finally { setBusy(false); } }
  return <section className="card" style={{ marginTop: '1rem', padding: '1.25rem' }}>
    <h2>Physical AI — edge hubs and devices</h2>
    <p>Connect supported physical devices through an enrolled local hub. Start with the included virtual TV, switch and sensor before pairing equipment.</p>
    {error && <p role="alert">{error}</p>}
    <h3>1. Download the edge suite</h3>
    {catalog?.packages.map(pkg => <div key={pkg.file} style={{ marginBottom: '1rem' }}><button type="button" disabled={busy} onClick={() => download(pkg)}>Download {pkg.label}</button><details><summary>Version {catalog.version} · SHA-256</summary><code style={{ overflowWrap: 'anywhere' }}>{pkg.sha256}</code></details></div>)}
    {catalog && !catalog.packages.length && <p>Packages have not been published by the operator yet.</p>}
    <h3>2. Extract and run</h3>
    <p>Windows/Linux require Node.js 22 or later. Extract the complete ZIP, then open its physical-edge folder.</p>
    <p>Windows PowerShell: <code>./run.ps1</code></p>
    <p>Linux: <code>sh run.sh</code></p>
    <p>These launch the local simulator lab. Its two URLs and protected local credentials are separate from your company account.</p>
    <p>Android Edge APK is outside Phase 1. Android/Google TV devices connect through the Windows/Linux hub and a supported Home Assistant integration.</p>
    <h3>3. Enroll a hub for your company</h3>
    <label>Site ID <input value={site} onChange={e => setSite(e.target.value)} placeholder="your-site" /></label>{' '}
    <label>Hub name <input value={name} onChange={e => setName(e.target.value)} placeholder="Your local hub" /></label>{' '}
    <button type="button" disabled={busy || !site || !name} onClick={enroll}>Enroll and download private config ZIP</button>
    <p>The private ZIP separates config/gateway.json from credentials/hub.token and credentials/local-ui.token. Extract it and restrict the credentials folder to your operating-system account. Keep it private, leave adapters empty to test the included simulator, or add approved adapter mappings and retain the journal directory. </p>
    <h3>4. Connect, register and verify</h3>
    <p>Windows: <code>./run.ps1 -Mode gateway -Config C:/FlolahEdge/config/gateway.json</code><br />Linux: <code>sh run.sh gateway /absolute/path/config/gateway.json</code></p>
    <p>Open the dashboard, refresh the online hub, select explicit action permissions and choose <strong>Register selected candidate</strong>. Request an action, approve it when required, and inspect the observed outcome.</p>
    <p><a href={base + '/ui'} target="_blank" rel="noreferrer">Open Physical AI dashboard</a>{' · '}<a href="/docs/systems/physical-ai-onboarding/" target="_blank" rel="noreferrer">Step-by-step device guide and PRISM+ TV example</a></p>
    <p>TV compatibility depends on the exact model, pairing and available feedback. A command acknowledgement alone is not verified completion.</p>
  </section>;
}
