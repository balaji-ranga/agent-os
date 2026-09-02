import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import GoalPlanPanel from '../components/GoalPlanPanel';
import { goalOriginLabel, goalPlanTracePath } from '../components/GoalPlanTelemetry';
import { formatChatTimestamp } from '../utils/formatDateTime.js';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymd(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday–Sunday local window (matches digest). */
function resolveWeekWindow(offsetWeeks = 0) {
  const now = new Date();
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const dow = local.getDay();
  const monOffset = dow === 0 ? -6 : 1 - dow;
  let monday = addDays(local, monOffset);
  const off = Number(offsetWeeks) || 0;
  if (off) monday = addDays(monday, off * 7);
  const sunday = addDays(monday, 6);
  let label;
  try {
    const a = monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const b = sunday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    label = a + ' - ' + b;
  } catch {
    label = ymd(monday) + ' - ' + ymd(sunday);
  }
  return { start_date: ymd(monday), end_date: ymd(sunday), label };
}

/**
 * Full week list of durable goal plans (Digest shows only the recent 2).
 * Week follows Digest filter via ?offset= (0 = this calendar week).
 */
export default function GoalPlans() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const offset = Number(searchParams.get('offset') || 0) || 0;
  const startQ = searchParams.get('start') || '';
  const endQ = searchParams.get('end') || '';
  const highlight = searchParams.get('highlight') || '';

  const week = useMemo(() => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(startQ) && /^\d{4}-\d{2}-\d{2}$/.test(endQ) && startQ <= endQ) {
      let label = startQ + ' – ' + endQ;
      try {
        const from = new Date(startQ + 'T12:00:00');
        const to = new Date(endQ + 'T12:00:00');
        const a = from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        const b = to.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        label = a + ' - ' + b;
      } catch {
        /* keep ymd label */
      }
      return { start_date: startQ, end_date: endQ, label };
    }
    return resolveWeekWindow(offset);
  }, [offset, startQ, endQ]);

  const [goals, setGoals] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = String(highlight || '').trim();
    if (/^agr-[a-f0-9]{8,}$/i.test(id)) {
      navigate(goalPlanTracePath(id), { replace: true });
    }
  }, [highlight, navigate]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    const load = (initial = false) => api
        .agentGoalRunsList({
          from: week.start_date,
          to: week.end_date,
          limit: 100,
        })
        .then((d) => {
          if (!cancelled) {
            setGoals(d.goals || []);
            setErr('');
          }
        })
        .catch((e) => {
          if (!cancelled && initial) setErr(e?.message || 'Failed to load goal plans');
        })
        .finally(() => {
          if (!cancelled && initial) setLoading(false);
        });
    load(true);
    // Current-week goal plans include a short-lived maker/checker planning
    // state. Refresh quietly so it appears and advances without a page reload.
    const timer = offset === 0 ? setInterval(() => load(false), 3000) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [week.start_date, week.end_date, offset]);

  function setOffset(next) {
    const o = Math.min(0, Number(next) || 0);
    const w = resolveWeekWindow(o);
    setSearchParams({ offset: String(o), start: w.start_date, end: w.end_date });
  }

  return (
    <div className="digest-page">
      <header className="digest-header">
        <div>
          <h1 className="digest-title">Goal plans</h1>
          <p className="digest-sub">
            Ad-hoc (COO chat) and scheduled fires for {week.label}. Open <strong>Execution trace</strong> on a
            plan for KPI, plan version, and telemetry. Digest shows the 2 most recent for the week.
          </p>
        </div>
        <div className="digest-header-tools">
          <div className="digest-range" title="Week window">
            <button
              type="button"
              className="digest-range-btn"
              onClick={() => setOffset(offset - 1)}
              aria-label="Previous week"
            >
              ‹
            </button>
            <span>{week.label}</span>
            <button
              type="button"
              className="digest-range-btn"
              onClick={() => setOffset(Math.min(0, offset + 1))}
              disabled={offset >= 0}
              aria-label="Next week"
            >
              ›
            </button>
          </div>
          <Link className="btn secondary" to={'/this-week?offset=' + offset}>
            ← Digest
          </Link>
        </div>
      </header>

      {err ? (
        <p className="digest-muted" style={{ color: 'var(--danger, #c44)' }} role="alert">
          {err}
        </p>
      ) : null}
      {loading ? (
        <p className="digest-muted">Loading…</p>
      ) : !goals.length ? (
        <p className="digest-muted">No goal plans for this week.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', maxWidth: 720 }}>
          <p className="digest-muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            {goals.length} plan{goals.length === 1 ? '' : 's'}
          </p>
          {goals.map((g) => (
            <div key={g.id} className="digest-card" style={{ padding: '0.75rem 1rem' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 4 }}>
                {goalOriginLabel(g)} · {g.status}
                {g.scheduled_goal_id ? (
                  <>
                    {' · '}
                    <Link to="/scheduled-goals">scheduled goal</Link>
                  </>
                ) : null}
                {g.created_at ? (
                  <>
                    {' · '}
                    <time dateTime={String(g.created_at)} title="Goal run started">
                      {formatChatTimestamp(g.created_at)}
                    </time>
                  </>
                ) : null}
                {g.completed_at ? (
                  <>
                    {' · done '}
                    <time dateTime={String(g.completed_at)} title="Goal run completed">
                      {formatChatTimestamp(g.completed_at)}
                    </time>
                  </>
                ) : null}
                {' · '}
                {g.progress?.progress_pct ?? 0}%
              </div>
              <GoalPlanPanel goal={g} compact />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
