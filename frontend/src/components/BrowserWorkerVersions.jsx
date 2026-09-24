import { Link } from 'react-router-dom';
import { compareWorkerVersions } from '../utils/workerVersion';

export default function BrowserWorkerVersions({ status, showDownloadLink = false }) {
  const latest = status?.latest_worker_version;
  const nodes = Array.isArray(status?.nodes) ? status.nodes : status?.worker ? [status.worker] : [];
  const desktop = nodes.filter(node => node.driver_mode !== 'chrome_extension');
  const extensions = nodes.filter(node => node.driver_mode === 'chrome_extension');
  const latestExtension = status?.latest_extension_version;
  const updateNeeded = desktop.some(node => compareWorkerVersions(node.worker_version, latest) === -1);
  return <div style={{ marginTop: '0.65rem', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 8, overflowWrap: 'anywhere' }}>
    <div><strong>Desktop worker versions</strong> · Latest server package: <strong>{latest ? `v${latest}` : 'Unavailable'}</strong></div>
    {desktop.length ? <ul style={{ paddingLeft: '1.25rem', margin: '0.5rem 0' }}>{desktop.map((node, index) => {
      const comparison = compareWorkerVersions(node.worker_version, latest);
      const label = comparison === -1 ? 'Update available' : comparison === 0 ? 'Up to date' : comparison === 1 ? 'Newer than server package' : 'Version not verified';
      return <li key={node.id || index} style={{ marginTop: '0.3rem' }}>
        {node.device_name || 'Desktop worker'} — {node.online ? 'Running' : 'Offline · Last reported'} {node.worker_version ? `v${node.worker_version}` : 'version unknown'} · <strong>{label}</strong>
      </li>;
    })}</ul> : <p style={{ margin: '0.5rem 0', color: 'var(--muted)' }}>No Desktop worker reported yet. Chrome extension versions are separate.</p>}
    <div style={{ marginTop: '0.7rem' }}><strong>Flolah Chrome extension</strong> · Latest server package: <strong>{latestExtension ? `v${latestExtension}` : 'Unavailable'}</strong></div>
    {extensions.length ? <ul style={{ paddingLeft: '1.25rem', margin: '0.5rem 0' }}>{extensions.map((node, index) => {
      const comparison = compareWorkerVersions(node.worker_version, latestExtension);
      const label = comparison === -1 ? 'Update required' : comparison === 0 ? 'Up to date' : comparison === 1 ? 'Newer than server package' : 'Version not verified';
      return <li key={node.id || index} style={{ marginTop: '0.3rem' }}>
        {node.device_name || 'Flolah Chrome extension'} — {node.online ? 'Online' : 'Offline'} {node.worker_version ? `v${node.worker_version}` : 'version unknown'} · <strong>{label}</strong>
      </li>;
    })}</ul> : <p style={{ margin: '0.5rem 0', color: 'var(--muted)' }}>No Flolah Chrome extension reported yet.</p>}
    {extensions.some(node => compareWorkerVersions(node.worker_version, latestExtension) === -1) && <p role="status" style={{ margin: '0.5rem 0 0', color: 'var(--danger, #b91c1c)' }}>Publishing recipe replay is blocked until you download the latest Flolah extension, replace the unpacked files, reload it in Chrome, and allow the target tab again.</p>}
    {updateNeeded && <p role="status" style={{ margin: '0.5rem 0 0', color: 'var(--text)' }}>To update, stop the old worker, download the latest package, and start it. Keep your existing browser profile safe to preserve logins. Updating the server does not update your PC automatically.</p>}
    {showDownloadLink && <Link to="/connectors">Download Desktop worker from Connectors →</Link>}
  </div>;
}
