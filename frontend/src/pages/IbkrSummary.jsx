import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { RequireAuth } from '../context/AuthContext';

const CLEAR_CONFIRM = 'CLEAR_IBKR_TRANSACTIONAL';

function money(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function StatusPill({ status }) {
  const s = String(status || 'unknown').toLowerCase();
  const tone =
    s === 'executed'
      ? 'ok'
      : s === 'approved' || s === 'executing'
        ? 'warn'
        : s === 'failed'
          ? 'bad'
          : s === 'partial'
            ? 'warn'
            : 'muted';
  return <span className={`ibkr-pill ibkr-pill-${tone}`}>{s}</span>;
}

function Metric({ label, value, hint }) {
  return (
    <div className="ibkr-metric">
      <div className="ibkr-metric-label">{label}</div>
      <div className="ibkr-metric-value">{value}</div>
      {hint ? <div className="ibkr-metric-hint">{hint}</div> : null}
    </div>
  );
}

function Card({ title, hint, children, className = '', actions = null }) {
  return (
    <section className={`ibkr-card ${className}`.trim()}>
      <div className="ibkr-card-head">
        <div>
          <h2 className="ibkr-card-title">{title}</h2>
          {hint ? <p className="ibkr-card-hint">{hint}</p> : null}
        </div>
        {actions ? <div className="ibkr-card-actions">{actions}</div> : null}
      </div>
      <div className="ibkr-card-body">{children}</div>
    </section>
  );
}

function IbkrSummaryPanel() {
  const [days, setDays] = useState(30);
  const [includeLive, setIncludeLive] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [drill, setDrill] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState(null);

  const [clearOpen, setClearOpen] = useState(false);
  const [clearPreview, setClearPreview] = useState(null);
  const [clearLoading, setClearLoading] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearTyped, setClearTyped] = useState('');
  const [clearMsg, setClearMsg] = useState(null);
  const [clearErr, setClearErr] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .ibkrSummary({ days, includeLive })
      .then((res) => setData(res))
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }, [days, includeLive]);

  useEffect(() => {
    load();
  }, [load]);

  const openDay = async (planDate) => {
    setSelectedDate(planDate);
    setDrillLoading(true);
    setDrillError(null);
    setDrill(null);
    try {
      const res = await api.ibkrSummaryDay(planDate);
      setDrill(res);
    } catch (e) {
      setDrillError(e.message || String(e));
    } finally {
      setDrillLoading(false);
    }
  };

  const openClear = async () => {
    setClearOpen(true);
    setClearMsg(null);
    setClearErr(null);
    setClearTyped('');
    setClearLoading(true);
    setClearPreview(null);
    try {
      const prev = await api.ibkrSummaryClearPreview();
      setClearPreview(prev);
    } catch (e) {
      setClearErr(e.message || String(e));
    } finally {
      setClearLoading(false);
    }
  };

  const runClear = async () => {
    if (clearTyped.trim() !== CLEAR_CONFIRM) {
      setClearErr(`Type ${CLEAR_CONFIRM} exactly to confirm.`);
      return;
    }
    setClearBusy(true);
    setClearErr(null);
    setClearMsg(null);
    try {
      const res = await api.ibkrSummaryClearTransactional({ confirm: CLEAR_CONFIRM });
      setClearMsg(res.message || `Deleted ${res.total_deleted || 0} row(s).`);
      setSelectedDate(null);
      setDrill(null);
      setClearTyped('');
      const prev = await api.ibkrSummaryClearPreview();
      setClearPreview(prev);
      load();
    } catch (e) {
      setClearErr(e.message || String(e));
    } finally {
      setClearBusy(false);
    }
  };

  const portfolio = data?.portfolio;
  const budget = data?.budget || portfolio?.budget;
  const positions =
    portfolio?.positions?.live?.length > 0
      ? portfolio.positions.live
      : portfolio?.positions?.last_persisted_snapshot || [];

  const previewCounts = clearPreview?.counts || {};

  return (
    <div className="page ibkr-summary-page">
      <header className="ibkr-hero">
        <div className="ibkr-hero-text">
          <p className="eyebrow">Prebuilt Workflows</p>
          <h1>IBKR Summary</h1>
          <p className="page-lead">
            Portfolio snapshot and day-wise planned vs executed plans for your account only.
          </p>
        </div>
        <div className="ibkr-toolbar">
          <label>
            Window{' '}
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
          <label className="ibkr-check">
            <input
              type="checkbox"
              checked={includeLive}
              onChange={(e) => setIncludeLive(e.target.checked)}
            />{' '}
            Try live Gateway
          </label>
          <button type="button" className="btn secondary" onClick={load} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className="btn secondary ibkr-danger-outline" onClick={openClear}>
            Clear data…
          </button>
          <Link to="/workflows" className="btn secondary">
            Workflows
          </Link>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}
      {loading && !data && <p className="muted">Loading IBKR summary…</p>}

      {data && (
        <>
          <div className="ibkr-metrics ibkr-metrics-strip">
            <Metric
              label="Day budget"
              value={money(budget?.budget_usd)}
              hint={`Remaining ${money(budget?.budget_remaining_usd ?? budget?.spendable_usd)}`}
            />
            <Metric
              label="Consumed / reserved"
              value={`${money(budget?.consumed_usd)} / ${money(budget?.reserved_usd)}`}
              hint={`Trades ${budget?.trades_placed ?? '—'} · left ${budget?.trades_remaining ?? '—'}`}
            />
            <Metric
              label="Realized P&L"
              value={money(portfolio?.pnl?.realized_usd)}
              hint={`${portfolio?.pnl?.realized_trades ?? 0} lots · ${data.days}d`}
            />
            <Metric
              label="Unrealized"
              value={money(portfolio?.pnl?.unrealized_usd_from_last_snapshot)}
              hint={
                portfolio?.cash?.live_cash_usd != null
                  ? `Cash ${money(portfolio.cash.live_cash_usd)}`
                  : portfolio?.cash?.live_error
                    ? String(portfolio.cash.live_error).slice(0, 48)
                    : 'From last snapshot'
              }
            />
            <Metric
              label="Open plans"
              value={String(data.totals?.open_plans ?? 0)}
              hint={`${data.totals?.plan_days ?? 0} plan days`}
            />
            <Metric
              label="Mode"
              value={data.gateway?.isPaper !== false ? 'Paper' : 'Live'}
              hint={data.gateway?.tradingEnabled ? 'Trading flags on' : 'Trading flag off'}
            />
          </div>

          <div className={`ibkr-grid ${selectedDate ? 'ibkr-grid-with-drill' : ''}`}>
            <Card
              title="Positions in hand"
              hint="Latest laptop snapshot or live Gateway when available"
            >
              {positions.length === 0 ? (
                <p className="muted ibkr-empty">No positions on latest snapshot.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Key</th>
                        <th>Symbol</th>
                        <th>Qty</th>
                        <th>Avg cost</th>
                        <th>Unrealized</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((p) => (
                        <tr key={p.key || p.symbol || `${p.symbol}-${p.qty}`}>
                          <td>{p.key || '—'}</td>
                          <td>{p.symbol || '—'}</td>
                          <td>{p.qty ?? '—'}</td>
                          <td>{p.avg_cost != null ? money(p.avg_cost) : '—'}</td>
                          <td>
                            {p.unrealized_pnl_usd != null ? money(p.unrealized_pnl_usd) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card
              title="Day-wise planned vs executed"
              hint="Click a row for drilldown"
            >
              {(data.day_rows || []).length === 0 ? (
                <p className="muted ibkr-empty">No day plans in this window.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table ibkr-day-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Status</th>
                        <th>Actions</th>
                        <th>Mappable</th>
                        <th>Notional</th>
                        <th>Orders</th>
                        <th>Gap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.day_rows.map((row) => (
                        <tr
                          key={row.id || row.plan_date}
                          className={selectedDate === row.plan_date ? 'ibkr-row-active' : ''}
                          onClick={() => openDay(row.plan_date)}
                        >
                          <td>
                            <strong>{row.plan_date}</strong>
                          </td>
                          <td>
                            <StatusPill status={row.status} />
                          </td>
                          <td>{row.planned?.action_count ?? 0}</td>
                          <td>
                            {row.planned?.mappable?.actionable ?? 0}
                            <span className="muted">
                              {' '}
                              (T{row.planned?.mappable?.trades ?? 0}/S
                              {row.planned?.mappable?.stops ?? 0}/X
                              {row.planned?.mappable?.sells ?? 0})
                            </span>
                          </td>
                          <td>{money(row.planned?.planned_notional_usd)}</td>
                          <td>{row.executed?.order_ids?.length ?? 0}</td>
                          <td className="ibkr-gap">
                            {(row.planned_vs_executed?.gap_notes || []).slice(0, 2).join(' · ') ||
                              '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {selectedDate ? (
              <Card
                className="ibkr-card-drill"
                title={`Drilldown · ${selectedDate}`}
                actions={
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => {
                      setSelectedDate(null);
                      setDrill(null);
                    }}
                  >
                    Close
                  </button>
                }
              >
                {drillLoading && <p className="muted">Loading day…</p>}
                {drillError && <div className="error-banner">{drillError}</div>}
                {drill?.ok && (
                  <div className="ibkr-drill-inner">
                    <div className="ibkr-metrics ibkr-metrics-compact">
                      <Metric label="Status" value={drill.day?.status || '—'} />
                      <Metric
                        label="Actionable"
                        value={String(drill.day?.planned?.mappable?.actionable ?? 0)}
                      />
                      <Metric
                        label="Order ids"
                        value={String((drill.day?.executed?.order_ids || []).join(', ') || '—')}
                      />
                      <Metric
                        label="Source"
                        value={drill.day?.executed?.source || '—'}
                        hint={
                          drill.day?.executed?.dry_run
                            ? 'Dry-run'
                            : drill.day?.executed?.phase || ''
                        }
                      />
                    </div>

                    <h3 className="ibkr-subh">Planned actions</h3>
                    <div className="table-wrap table-wrap-nested">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Type</th>
                            <th>Key</th>
                            <th>Qty</th>
                            <th>Entry</th>
                            <th>Stop</th>
                            <th>TP</th>
                            <th>Notional</th>
                            <th>CEO</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(drill.day?.planned?.actions || []).length === 0 ? (
                            <tr>
                              <td colSpan={8} className="muted">
                                No actions
                              </td>
                            </tr>
                          ) : (
                            drill.day.planned.actions.map((a, i) => (
                              <tr key={`${a.key}-${i}`}>
                                <td>{a.type}</td>
                                <td>{a.key || '—'}</td>
                                <td>{a.qty ?? '—'}</td>
                                <td>{a.entry_price != null ? money(a.entry_price) : '—'}</td>
                                <td>{a.stop_price != null ? money(a.stop_price) : '—'}</td>
                                <td>{a.tp_price != null ? money(a.tp_price) : '—'}</td>
                                <td>{money(a.notional_usd)}</td>
                                <td>{a.requires_ceo_approval ? 'yes' : '—'}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    <h3 className="ibkr-subh">Bridge mapping</h3>
                    <pre className="ibkr-json">
                      {JSON.stringify(
                        {
                          summary: drill.mapping?.summary,
                          trades: drill.mapping?.trades,
                          stop_updates: drill.mapping?.stop_updates,
                          sells: drill.mapping?.sells,
                          skipped: drill.mapping?.skipped,
                        },
                        null,
                        2
                      )}
                    </pre>

                    <h3 className="ibkr-subh">Execution report</h3>
                    <pre className="ibkr-json">
                      {JSON.stringify(
                        drill.day?.executed?.raw || { note: 'no execution report' },
                        null,
                        2
                      )}
                    </pre>

                    <h3 className="ibkr-subh">
                      Order events ({(drill.order_events || []).length})
                    </h3>
                    {(drill.order_events || []).length === 0 ? (
                      <p className="muted">No order events for this calendar day.</p>
                    ) : (
                      <div className="table-wrap table-wrap-nested">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Time</th>
                              <th>Type</th>
                              <th>Symbol</th>
                              <th>Order</th>
                              <th>Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {drill.order_events.map((ev) => (
                              <tr key={ev.id}>
                                <td>{ev.created_at}</td>
                                <td>{ev.event_type}</td>
                                <td>{ev.symbol_key || '—'}</td>
                                <td>{ev.order_id ?? '—'}</td>
                                <td>{ev.reason || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <h3 className="ibkr-subh">Fills ({(drill.fills || []).length})</h3>
                    {(drill.fills || []).length === 0 ? (
                      <p className="muted">No fills recorded for this day.</p>
                    ) : (
                      <pre className="ibkr-json">{JSON.stringify(drill.fills, null, 2)}</pre>
                    )}
                  </div>
                )}
              </Card>
            ) : null}
          </div>
        </>
      )}

      {clearOpen && (
        <div
          className="ibkr-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !clearBusy) setClearOpen(false);
          }}
        >
          <div className="ibkr-modal" role="dialog" aria-labelledby="ibkr-clear-title">
            <h2 id="ibkr-clear-title">Clear IBKR transactional data</h2>
            <p className="muted">
              Deletes <strong>your</strong> plans, execution reports, order events, fills, equity
              marks, snapshot cache, reservations, and day spend ledgers.
              Strategy Variables (budget, allowlist, risk %, crons) and workflow graphs are{' '}
              <strong>not</strong> removed.
            </p>

            {clearLoading && <p className="muted">Counting rows…</p>}
            {clearPreview && (
              <div className="ibkr-clear-counts">
                <p>
                  <strong>{clearPreview.total_rows ?? 0}</strong> transactional row(s) found.
                </p>
                <ul>
                  {Object.entries(previewCounts)
                    .filter(([, n]) => Number(n) > 0)
                    .map(([k, n]) => (
                      <li key={k}>
                        {k}: {n}
                      </li>
                    ))}
                  {(Object.values(previewCounts).every((n) => !n) ||
                    !Object.keys(previewCounts).length) && (
                    <li className="muted">Nothing to delete</li>
                  )}
                </ul>
              </div>
            )}

            <label className="ibkr-clear-type">
              Type <code>{CLEAR_CONFIRM}</code> to confirm
              <input
                type="text"
                value={clearTyped}
                onChange={(e) => setClearTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={clearBusy}
                placeholder={CLEAR_CONFIRM}
              />
            </label>

            {clearErr && <div className="error-banner">{clearErr}</div>}
            {clearMsg && <div className="ibkr-ok-banner">{clearMsg}</div>}

            <div className="ibkr-modal-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={clearBusy}
                onClick={() => setClearOpen(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn ibkr-danger-btn"
                disabled={clearBusy || clearTyped.trim() !== CLEAR_CONFIRM}
                onClick={runClear}
              >
                {clearBusy ? 'Clearing…' : 'Clear transactional data'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .ibkr-summary-page {
          max-width: 1200px;
          height: calc(100vh - 4.5rem);
          max-height: calc(100dvh - 4.5rem);
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow: hidden;
          padding-bottom: 0.5rem;
          box-sizing: border-box;
        }
        .ibkr-hero {
          flex: 0 0 auto;
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 0.75rem 1.25rem;
          margin-bottom: 0.75rem;
        }
        .ibkr-hero-text h1 { margin: 0.15rem 0 0; font-size: 1.45rem; }
        .ibkr-hero-text .page-lead { margin: 0.25rem 0 0; max-width: 40rem; font-size: 0.9rem; }
        .ibkr-toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem 0.75rem; align-items: center; }
        .ibkr-check { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.85rem; }
        .ibkr-metrics-strip {
          flex: 0 0 auto;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 0.5rem;
          margin-bottom: 0.75rem;
        }
        .ibkr-metrics-compact {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: 0.45rem;
          margin-bottom: 0.65rem;
        }
        .ibkr-metric {
          border: 1px solid var(--border, #ddd);
          border-radius: 8px;
          padding: 0.5rem 0.65rem;
          background: var(--surface, transparent);
        }
        .ibkr-metric-label {
          font-size: 0.7rem;
          color: var(--muted, #666);
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .ibkr-metric-value {
          font-size: 1.05rem;
          font-weight: 600;
          margin-top: 0.15rem;
          word-break: break-word;
        }
        .ibkr-metric-hint { font-size: 0.72rem; color: var(--muted, #666); margin-top: 0.2rem; }

        .ibkr-grid {
          flex: 1 1 auto;
          min-height: 0;
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-template-rows: minmax(0, 1fr);
          gap: 0.75rem;
        }
        .ibkr-grid-with-drill {
          grid-template-columns: 1fr 1fr;
          grid-template-rows: minmax(0, 1fr) minmax(0, 1.15fr);
        }
        .ibkr-card-drill { grid-column: 1 / -1; min-height: 0; }

        .ibkr-card {
          min-height: 0;
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border, #ddd);
          border-radius: 10px;
          background: var(--surface, transparent);
          overflow: hidden;
        }
        .ibkr-card-head {
          flex: 0 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 0.75rem;
          padding: 0.65rem 0.85rem 0.45rem;
          border-bottom: 1px solid var(--border, #eee);
        }
        .ibkr-card-title { margin: 0; font-size: 1rem; }
        .ibkr-card-hint { margin: 0.2rem 0 0; font-size: 0.78rem; color: var(--muted, #666); }
        .ibkr-card-body {
          flex: 1 1 auto;
          min-height: 0;
          overflow: auto;
          padding: 0.55rem 0.75rem 0.75rem;
          scrollbar-width: thin;
          scrollbar-color: color-mix(in srgb, var(--muted, #888) 35%, transparent) transparent;
        }
        .ibkr-card-body::-webkit-scrollbar { width: 5px; height: 5px; }
        .ibkr-card-body::-webkit-scrollbar-thumb {
          background: color-mix(in srgb, var(--muted, #888) 40%, transparent);
          border-radius: 999px;
        }
        .ibkr-card-body::-webkit-scrollbar-track { background: transparent; }
        .ibkr-card-body:hover::-webkit-scrollbar-thumb {
          background: color-mix(in srgb, var(--muted, #888) 55%, transparent);
        }

        .ibkr-subh { margin: 0.75rem 0 0.4rem; font-size: 0.88rem; }
        .ibkr-pill {
          display: inline-block;
          padding: 0.1rem 0.45rem;
          border-radius: 999px;
          font-size: 0.75rem;
          text-transform: lowercase;
          border: 1px solid var(--border, #ccc);
        }
        .ibkr-pill-ok { background: color-mix(in srgb, #1a7f37 12%, transparent); color: #1a7f37; }
        .ibkr-pill-warn { background: color-mix(in srgb, #b86e00 12%, transparent); color: #b86e00; }
        .ibkr-pill-bad { background: color-mix(in srgb, #c01c28 12%, transparent); color: #c01c28; }
        .ibkr-pill-muted { background: transparent; color: var(--muted, #666); }
        .ibkr-day-table tbody tr { cursor: pointer; }
        .ibkr-day-table tbody tr:hover {
          background: color-mix(in srgb, var(--accent, #2563eb) 6%, transparent);
        }
        .ibkr-row-active { outline: 1px solid var(--accent, #2563eb); }
        .ibkr-gap { max-width: 220px; font-size: 0.82rem; color: var(--muted, #555); }
        .ibkr-json {
          background: var(--code-bg, color-mix(in srgb, var(--fg, #111) 4%, transparent));
          border: 1px solid var(--border, #ddd);
          border-radius: 8px;
          padding: 0.6rem;
          overflow: auto;
          max-height: 200px;
          font-size: 0.75rem;
          margin: 0;
          scrollbar-width: thin;
          scrollbar-color: color-mix(in srgb, var(--muted, #888) 35%, transparent) transparent;
        }
        .ibkr-json::-webkit-scrollbar { width: 5px; height: 5px; }
        .ibkr-json::-webkit-scrollbar-thumb {
          background: color-mix(in srgb, var(--muted, #888) 40%, transparent);
          border-radius: 999px;
        }
        .table-wrap { overflow: visible; }
        .table-wrap-nested { overflow-x: auto; max-width: 100%; }
        .data-table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
        .data-table th, .data-table td {
          text-align: left;
          padding: 0.4rem 0.45rem;
          border-bottom: 1px solid var(--border, #e5e5e5);
          vertical-align: top;
        }
        .data-table th {
          font-size: 0.7rem;
          text-transform: uppercase;
          color: var(--muted, #666);
          letter-spacing: 0.03em;
          position: sticky;
          top: 0;
          background: var(--surface, #fff);
          z-index: 1;
        }
        .error-banner {
          background: color-mix(in srgb, #c01c28 12%, transparent);
          border: 1px solid #c01c28;
          padding: 0.55rem 0.7rem;
          border-radius: 8px;
          margin-bottom: 0.65rem;
          font-size: 0.88rem;
        }
        .ibkr-ok-banner {
          background: color-mix(in srgb, #1a7f37 12%, transparent);
          border: 1px solid #1a7f37;
          padding: 0.55rem 0.7rem;
          border-radius: 8px;
          margin-bottom: 0.65rem;
          font-size: 0.88rem;
        }
        .muted { color: var(--muted, #666); }
        .ibkr-empty { margin: 0.5rem 0; }
        .eyebrow {
          margin: 0;
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted, #666);
        }
        .ibkr-danger-outline {
          border-color: color-mix(in srgb, #c01c28 45%, var(--border, #ccc));
          color: #a01620;
        }
        .ibkr-danger-btn {
          background: #c01c28;
          color: #fff;
          border: 1px solid #a01620;
        }
        .ibkr-danger-btn:disabled { opacity: 0.45; cursor: not-allowed; }

        .ibkr-modal-backdrop {
          position: fixed;
          inset: 0;
          background: color-mix(in srgb, #000 40%, transparent);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 80;
          padding: 1rem;
        }
        .ibkr-modal {
          width: min(480px, 100%);
          max-height: min(80vh, 640px);
          overflow: auto;
          background: var(--surface, #fff);
          color: var(--fg, #111);
          border-radius: 12px;
          border: 1px solid var(--border, #ddd);
          padding: 1rem 1.1rem 1rem;
          box-shadow: 0 12px 40px color-mix(in srgb, #000 18%, transparent);
          scrollbar-width: thin;
        }
        .ibkr-modal h2 { margin: 0 0 0.5rem; font-size: 1.1rem; }
        .ibkr-clear-counts {
          font-size: 0.88rem;
          margin: 0.65rem 0;
          padding: 0.55rem 0.65rem;
          border-radius: 8px;
          border: 1px solid var(--border, #e5e5e5);
          max-height: 160px;
          overflow: auto;
          scrollbar-width: thin;
        }
        .ibkr-clear-counts ul { margin: 0.35rem 0 0; padding-left: 1.1rem; }
        .ibkr-clear-type {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          font-size: 0.85rem;
          margin: 0.75rem 0;
        }
        .ibkr-clear-type input {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          padding: 0.45rem 0.55rem;
          border-radius: 6px;
          border: 1px solid var(--border, #ccc);
          background: transparent;
        }
        .ibkr-modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.5rem;
          margin-top: 0.75rem;
        }

        @media (max-width: 900px) {
          .ibkr-summary-page {
            height: auto;
            max-height: none;
            overflow: visible;
          }
          .ibkr-grid,
          .ibkr-grid-with-drill {
            display: flex;
            flex-direction: column;
            flex: none;
          }
          .ibkr-card {
            max-height: 55vh;
          }
          .ibkr-card-drill { max-height: 70vh; }
        }
      `}</style>
    </div>
  );
}

export default function IbkrSummary() {
  return (
    <RequireAuth>
      <IbkrSummaryPanel />
    </RequireAuth>
  );
}
