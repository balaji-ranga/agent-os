import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatLocalDateTime } from '../utils/formatDateTime.js';

const money = (value) => `$${Number(value || 0).toFixed(2)}`;
export default function IBKRNewSummary() {
  const [data, setData] = useState(null); const [error, setError] = useState('');
  useEffect(() => { api.ibkrNewSummary().then(setData).catch((e) => setError(e.message)); }, []);
  const totals = data?.totals || {};
  return <div className="page page-wide ibkrnew-page">
    <header className="page-hero"><div className="page-hero-top"><div className="page-hero-titles"><p className="page-hero-kicker">Prebuilt Workflows · IBKRNew0</p><h1>Trading summary</h1></div><span className="ibkrnew-environment">Paper only</span></div><p className="page-hero-sub">Commission-adjusted outcomes and allocation decisions retained for {data?.retention_days || '—'} days under your profile policy.</p></header>
    {error && <div className="page-banner page-banner-error" role="alert">{error}</div>}
    <div className="this-week-grid ibkrnew-metrics"><section className="this-week-card"><small>Trades</small><h2>{totals.trade_count || 0}</h2></section><section className="this-week-card"><small>Gross P&amp;L</small><h2>{money(totals.gross_pnl_usd)}</h2></section><section className="this-week-card"><small>Actual commissions</small><h2>{money(totals.actual_commission_usd)}</h2></section><section className="this-week-card"><small>Net P&amp;L</small><h2>{money(totals.net_pnl_usd)}</h2></section></div>
    <section className="panel ibkrnew-section"><h2 className="panel-title">Trade history</h2><div className="ibkrnew-table-wrap"><table className="ibkrnew-table"><thead><tr><th>Time</th><th>Symbol</th><th>Expression</th><th>Status</th><th>Qty</th><th>Est. commission</th><th>Actual commission</th><th>Required profitable exit</th><th>Gross P&amp;L</th><th>Net P&amp;L</th></tr></thead><tbody>{(data?.trades || []).map((trade) => <tr key={trade.trade_id}><td>{formatLocalDateTime(trade.created_at)}</td><td><strong>{trade.symbol}</strong></td><td>{trade.expression}</td><td><span className="ibkrnew-status">{trade.status}</span></td><td>{trade.quantity}</td><td>{money(trade.estimated_round_trip_commission_usd)}</td><td>{money(trade.actual_commission_usd)}</td><td>{money(trade.required_profitable_exit_price)}</td><td>{money(trade.gross_pnl_usd)}</td><td>{money(trade.net_pnl_usd)}</td></tr>)}</tbody></table>{!data?.trades?.length && <p className="page-muted">No trades recorded yet.</p>}</div></section>
    <section className="panel ibkrnew-section"><h2 className="panel-title">Allocation decisions</h2>{(data?.allocations || []).map((item) => <article key={item.decision_id} className="ibkrnew-list-item"><strong>{item.allocation_mode}</strong><span>{item.requested_quantity} requested / {item.approved_quantity} approved · net {money(item.expected_net_profit_usd)} · commission {money(item.estimated_commission_usd)}</span><small>{item.rationale}</small></article>)}{!data?.allocations?.length && <p className="page-muted">No allocation decisions recorded yet.</p>}</section>
  </div>;
}
