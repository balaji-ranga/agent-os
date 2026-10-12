import { formatServerDateTime } from '../utils/formatDateTime.js';

export default function ActionApprovalBanner({ state, expiresAt, timeZone, busy, canMutate, comment, onComment, onDecision, error, success }) {
  return (
    <div role="status" style={{ position: 'sticky', top: 0, zIndex: 2, margin: '-1rem -1rem 1rem', padding: '0.75rem 1rem', borderBottom: '1px solid #ca8a04', background: 'rgba(202,138,4,0.12)' }}>
      <strong>{state?.label || 'Action approval required'}</strong>
      <div style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '4px 0 8px' }}>
        {state?.message || 'Approve permits only this exact pending action once. For a goal, execution resumes at the paused step. Reject stops the action.'}
        {expiresAt && <div>Approval expires: {formatServerDateTime(expiresAt, timeZone)}</div>}
      </div>
      {error && <div style={{ fontSize: '0.85rem', color: '#dc2626', marginBottom: 6 }}>{error}</div>}
      {success && <div style={{ fontSize: '0.85rem', color: '#166534', marginBottom: 6 }}>{success}</div>}
      {(!state || state.canDecide) && <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 6 }}>
        Comment (optional)
        <textarea rows={2} value={comment} onChange={(e) => onComment(e.target.value)} style={{ width: '100%', marginTop: 4, padding: '0.4rem', borderRadius: 6, border: '1px solid var(--border)' }} />
      </label>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => onDecision('approve')} disabled={busy || !canMutate || state?.canDecide === false} style={{ flex: 1, padding: '0.65rem', borderRadius: 6, background: '#16a34a', color: 'white', border: 'none', fontWeight: 700 }}>Approve &amp; continue</button>
        <button type="button" onClick={() => onDecision('reject')} disabled={busy || !canMutate || state?.canDecide === false} style={{ flex: 1, padding: '0.65rem', borderRadius: 6, background: '#dc2626', color: 'white', border: 'none', fontWeight: 700 }}>Reject</button>
      </div>
    </div>
  );
}
