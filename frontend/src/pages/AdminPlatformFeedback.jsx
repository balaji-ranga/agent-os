import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import ActionFeedbackBanner from '../components/ActionFeedbackBanner';
import { useActionFeedback } from '../hooks/useActionFeedback';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';

export default function AdminPlatformFeedback() {
  const { feedback, showError, showSuccess, clearFeedback } = useActionFeedback();
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [rejectReason, setRejectReason] = useState({});
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = async (append = false) => {
    try {
      const data = await api.adminPlatformFeedbackList({
        status: status || undefined,
        category: category || undefined,
        q: q || undefined,
        limit: 25,
        offset: append ? items.length : 0,
      });
      setItems((current) => append ? [...current, ...(data.items || [])] : (data.items || []));
      setHasMore(!!data.has_more);
    } catch (e) {
      showError(e.message || 'Failed to load feedback');
    }
  };
  const loadMore = useCallback(async () => { if (!hasMore || loadingMore) return; setLoadingMore(true); try { await load(true); } finally { setLoadingMore(false); } }, [hasMore, loadingMore, items.length, status, category, q]);
  const sentinelRef = useInfiniteScroll(loadMore, hasMore && !loadingMore);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only; Refresh button for filters
  }, []);

  const setStatusFor = async (id, next, reason) => {
    setBusyId(id);
    try {
      await api.adminPlatformFeedbackUpdate(id, {
        status: next,
        status_reason: reason || '',
      });
      showSuccess(`Marked ${next}`);
      await load();
    } catch (e) {
      showError(e.message || 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page" style={{ padding: '1rem 1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>Platform feedback</h1>
        <Link to="/admin" className="wf-btn">
          Back to Admin
        </Link>
      </div>
      <p style={{ color: 'var(--muted)' }}>
        Bugs, feedback, and enhancements submitted by COO (and related agents). Update status as you triage.
      </p>
      <ActionFeedbackBanner feedback={feedback} onDismiss={clearFeedback} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="open">open</option>
          <option value="implemented">implemented</option>
          <option value="rejected">rejected</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          <option value="bug">bug</option>
          <option value="feedback">feedback</option>
          <option value="enhancement">enhancement</option>
        </select>
        <input
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 180 }}
        />
        <button type="button" className="wf-btn" onClick={load}>
          Refresh
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.length === 0 && <p style={{ color: 'var(--muted)' }}>No feedback yet.</p>}
        {items.map((row) => (
          <div
            key={row.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '0.85rem 1rem',
              background: 'var(--surface)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <strong>
                [{row.category}] {row.title}
              </strong>
              <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{row.status}</span>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 4 }}>
              {row.initiator_name || '?'}
              {row.initiator_email ? ` <${row.initiator_email}>` : ''}
              {row.initiator_agent_id ? ` · agent ${row.initiator_agent_id}` : ''}
              {row.created_at ? ` · ${row.created_at}` : ''}
            </div>
            {row.body ? (
              <pre style={{ whiteSpace: 'pre-wrap', margin: '0.65rem 0 0', fontSize: '0.9rem' }}>{row.body}</pre>
            ) : null}
            {row.status_reason ? (
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>Reason: {row.status_reason}</p>
            ) : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <button
                type="button"
                className="wf-btn"
                disabled={busyId === row.id || row.status === 'open'}
                onClick={() => setStatusFor(row.id, 'open')}
              >
                Open
              </button>
              <button
                type="button"
                className="wf-btn wf-btn-primary"
                disabled={busyId === row.id || row.status === 'implemented'}
                onClick={() => setStatusFor(row.id, 'implemented')}
              >
                Implemented
              </button>
              <input
                placeholder="Reject reason"
                value={rejectReason[row.id] || ''}
                onChange={(e) => setRejectReason((p) => ({ ...p, [row.id]: e.target.value }))}
                style={{ flex: 1, minWidth: 160 }}
              />
              <button
                type="button"
                className="wf-btn wf-btn-danger"
                disabled={busyId === row.id}
                onClick={() => setStatusFor(row.id, 'rejected', rejectReason[row.id])}
              >
                Reject
              </button>
            </div>
          </div>
        ))}
        <div ref={sentinelRef} style={{ minHeight: 1 }} aria-hidden="true" />
        {hasMore && <button type="button" className="wf-btn" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading…' : 'Load more feedback'}</button>}
      </div>
    </div>
  );
}
