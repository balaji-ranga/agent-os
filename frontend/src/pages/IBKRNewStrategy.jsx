import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const KINDS = ['goal', 'strategy_skill', 'strategy', 'policy', 'universe', 'market_data'];
const label = (value) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const list = (value) => String(value || '').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
const listText = (value) => (value || []).join(', ');

export default function IBKRNewStrategy() {
  const [data, setData] = useState(null);
  const [kind, setKind] = useState('goal');
  const [editor, setEditor] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [goalDraft, setGoalDraft] = useState({ name: 'IBKRNew 5% in 30 Days', mode: 'PERPETUAL', target_return_pct: 5, duration_days: 30 });
  const load = async () => { try { setData(await api.ibkrNewDashboard()); setError(''); } catch (e) { setError(e.message); } };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (data?.configs?.[kind]) setEditor(JSON.stringify(data.configs[kind], null, 2)); }, [data, kind]);
  useEffect(() => { if (data?.goal?.definition) setGoalDraft((prior) => ({ ...prior, ...data.goal.definition })); }, [data?.goal?.definition]);
  const parsed = useMemo(() => { try { return JSON.parse(editor); } catch { return null; } }, [editor]);
  const update = (path, value) => {
    if (!parsed) return;
    const next = structuredClone(parsed); let cursor = next;
    path.slice(0, -1).forEach((part) => { cursor[part] ||= {}; cursor = cursor[part]; });
    cursor[path.at(-1)] = value; setEditor(JSON.stringify(next, null, 2));
  };
  const publish = async () => {
    setBusy(true); setNotice('');
    try {
      const document = JSON.parse(editor); delete document.id; delete document.version; delete document.status;
      try { await api.ibkrNewPublishConfig(kind, document, false); }
      catch (e) {
        if (e.status !== 409 || !window.confirm('This change loosens trading risk. Publish with explicit CEO confirmation?')) throw e;
        await api.ibkrNewPublishConfig(kind, document, true);
      }
      setNotice(`${label(kind)} published as a new immutable version.`); await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const saveGoal = () => actGoal(async () => { await api.ibkrNewSetGoal({ ...goalDraft, duration_basis: 'CALENDAR_DAYS', capital_basis: 'CYCLE_START_ELIGIBLE_CAPITAL_CAPPED_BY_TOTAL_BUDGET', profit_basis: 'NET_REALIZED_AFTER_COMMISSIONS' }); setNotice('A new immutable goal and cycle were activated.'); });
  const actGoal = async (fn) => { setBusy(true); setNotice(''); try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const universe = kind === 'universe' ? parsed : null;
  const stock = universe?.filters?.stock; const fundamentals = stock?.fundamentals; const events = stock?.corporate_events; const etf = universe?.filters?.etf;
  const numberField = (caption, path, value, options = {}) => <label className="ibkrnew-field"><span>{caption}</span><input type="number" min={options.min ?? 0} step={options.step ?? 'any'} value={value ?? ''} onChange={(e) => update(path, Number(e.target.value))} /></label>;
  const checkField = (caption, path, checked, hint) => <label className="ibkrnew-check"><input type="checkbox" checked={checked === true} onChange={(e) => update(path, e.target.checked)} /><span><strong>{caption}</strong>{hint && <small>{hint}</small>}</span></label>;

  return <div className="page page-wide ibkrnew-page">
    <header className="page-hero"><div className="page-hero-top"><div className="page-hero-titles"><p className="page-hero-kicker">Prebuilt Workflows · IBKRNew0</p><h1>Goal, strategy &amp; universe</h1></div><span className="ibkrnew-environment">Paper only</span></div><p className="page-hero-sub">The goal owns the outcome and cycle; strategy chooses how to pursue it; deterministic risk gates enforce both.</p></header>
    {error && <div className="page-banner page-banner-error" role="alert"><span>{error}</span><button type="button" className="btn-ghost" onClick={() => setError('')}>Dismiss</button></div>}
    {notice && <div className="page-banner ibkrnew-success" role="status"><span>{notice}</span><button type="button" className="btn-ghost" onClick={() => setNotice('')}>Dismiss</button></div>}
    <nav className="ibkrnew-tabs" aria-label="IBKRNew configuration sections">{KINDS.map((item) => <button type="button" key={item} className={kind === item ? 'btn-primary' : 'btn-secondary'} aria-current={kind === item ? 'page' : undefined} onClick={() => setKind(item)}>{label(item)}</button>)}</nav>

    {kind === 'goal' ? <section className="panel ibkrnew-section">
      <div className="ibkrnew-section-heading"><div><p className="page-hero-kicker">Outcome authority</p><h2>Trading objective</h2><p className="page-muted">New openings stop when net realized profit after commissions reaches the target or the cycle duration ends. Existing positions remain protected and manageable.</p></div><span className="ibkrnew-version">{data?.goal?.cycle?.status || data?.goal?.block_reason || 'WAITING'}</span></div>
      <div className="ibkrnew-form-grid">
        <label className="ibkrnew-field ibkrnew-field-wide"><span>Goal name</span><input value={goalDraft.name} onChange={(e) => setGoalDraft({ ...goalDraft, name: e.target.value })} /></label>
        <label className="ibkrnew-field"><span>Cycle mode</span><select value={goalDraft.mode} onChange={(e) => setGoalDraft({ ...goalDraft, mode: e.target.value })}><option value="PERPETUAL">Perpetual 30-day cycles</option><option value="ONE_TIME">One-time objective</option></select></label>
        <label className="ibkrnew-field"><span>Target return (%)</span><input type="number" min="0.01" max="100" step="0.01" value={goalDraft.target_return_pct} onChange={(e) => setGoalDraft({ ...goalDraft, target_return_pct: Number(e.target.value) })} /></label>
        <label className="ibkrnew-field"><span>Cycle duration (calendar days)</span><input type="number" min="1" max="3650" step="1" value={goalDraft.duration_days} onChange={(e) => setGoalDraft({ ...goalDraft, duration_days: Number(e.target.value) })} /></label>
      </div>
      {data?.goal?.cycle && <div className="this-week-grid"><article><small>Cycle capital</small><strong>${Number(data.goal.cycle.capital_basis_usd).toFixed(2)}</strong></article><article><small>Target net profit</small><strong>${Number(data.goal.cycle.target_profit_usd).toFixed(2)}</strong></article><article><small>Net realized</small><strong>${Number(data.goal.cycle.net_realized_profit_usd).toFixed(2)}</strong></article><article><small>Remaining</small><strong>${Number(data.goal.cycle.remaining_profit_usd).toFixed(2)} · {data.goal.cycle.days_remaining} days</strong></article></div>}
      <div className="ibkrnew-actions"><button type="button" className="btn-primary" disabled={busy} onClick={saveGoal}>Activate as a new goal</button>{data?.goal?.definition?.status === 'ACTIVE' ? <button type="button" className="btn-secondary" disabled={busy} onClick={() => actGoal(api.ibkrNewPauseGoal)}>Pause goal</button> : data?.goal?.definition?.status === 'PAUSED' ? <button type="button" className="btn-secondary" disabled={busy} onClick={() => actGoal(api.ibkrNewResumeGoal)}>Resume goal</button> : null}</div>
    </section> : universe && stock && fundamentals && events && etf ? <>
      <section className="panel ibkrnew-section">
        <div className="ibkrnew-section-heading"><div><p className="page-hero-kicker">Stock filter</p><h2>Stock universe and index membership</h2><p className="page-muted">Index identifiers apply only to stocks. Leave the list empty to consider stocks from any index.</p></div>{checkField('Enable stocks', ['filters', 'stock', 'enabled'], stock.enabled)}</div>
        <div className="ibkrnew-form-grid">
          <label className="ibkrnew-field ibkrnew-field-wide"><span>Stock indexes</span><input value={listText(stock.indexes)} placeholder="SPX, NDX, RUT, DJIA" onChange={(e) => update(['filters', 'stock', 'indexes'], list(e.target.value))} /><small>Any configured identifier is accepted; the desktop profile must report matching membership.</small></label>
          <label className="ibkrnew-field"><span>Membership match</span><select value={stock.index_match} onChange={(e) => update(['filters', 'stock', 'index_match'], e.target.value)}><option value="ANY">Any selected index</option><option value="ALL">All selected indexes</option></select></label>
          {numberField('Membership freshness (hours)', ['filters', 'stock', 'index_membership_maximum_age_hours'], stock.index_membership_maximum_age_hours, { min: 1 })}
          {numberField('Minimum stock price (USD)', ['filters', 'stock', 'minimum_price_usd'], stock.minimum_price_usd)}
          {numberField('Maximum stock price (USD)', ['filters', 'stock', 'maximum_price_usd'], stock.maximum_price_usd)}
          {numberField('Minimum average daily volume', ['filters', 'stock', 'minimum_average_daily_volume'], stock.minimum_average_daily_volume, { min: 1, step: 1 })}
          {numberField('Maximum spread (%)', ['filters', 'stock', 'maximum_spread_pct'], stock.maximum_spread_pct, { step: 0.01 })}
        </div>
      </section>
      <div className="ibkrnew-two-column">
        <section className="panel ibkrnew-section">
          <div className="ibkrnew-section-heading"><div><p className="page-hero-kicker">Slow-moving data</p><h2>Company fundamentals</h2></div>{checkField('Enable', ['filters', 'stock', 'fundamentals', 'enabled'], fundamentals.enabled)}</div>
          <div className="ibkrnew-check-row">{checkField('Fail closed', ['filters', 'stock', 'fundamentals', 'fail_closed'], fundamentals.fail_closed, 'Block when required data is missing or stale.')}{checkField('Positive operating cash flow', ['filters', 'stock', 'fundamentals', 'require_positive_operating_cash_flow'], fundamentals.require_positive_operating_cash_flow)}</div>
          <div className="ibkrnew-form-grid">
            {numberField('Freshness (hours)', ['filters', 'stock', 'fundamentals', 'maximum_age_hours'], fundamentals.maximum_age_hours, { min: 1 })}
            {numberField('Minimum market cap (USD)', ['filters', 'stock', 'fundamentals', 'minimum_market_cap_usd'], fundamentals.minimum_market_cap_usd)}
            {numberField('Minimum TTM revenue (USD)', ['filters', 'stock', 'fundamentals', 'minimum_revenue_ttm_usd'], fundamentals.minimum_revenue_ttm_usd)}
            {numberField('Maximum debt/equity', ['filters', 'stock', 'fundamentals', 'maximum_debt_to_equity'], fundamentals.maximum_debt_to_equity, { step: 0.1 })}
            <label className="ibkrnew-field"><span>Allowed sectors</span><input value={listText(fundamentals.allowed_sectors)} placeholder="Optional" onChange={(e) => update(['filters', 'stock', 'fundamentals', 'allowed_sectors'], list(e.target.value))} /></label>
            <label className="ibkrnew-field"><span>Excluded sectors</span><input value={listText(fundamentals.excluded_sectors)} placeholder="Optional" onChange={(e) => update(['filters', 'stock', 'fundamentals', 'excluded_sectors'], list(e.target.value))} /></label>
          </div>
        </section>
        <section className="panel ibkrnew-section">
          <div className="ibkrnew-section-heading"><div><p className="page-hero-kicker">Scheduled risk</p><h2>Corporate events</h2></div>{checkField('Enable', ['filters', 'stock', 'corporate_events', 'enabled'], events.enabled)}</div>
          {checkField('Fail closed', ['filters', 'stock', 'corporate_events', 'fail_closed'], events.fail_closed, 'Block when the corporate-event calendar is unavailable.')}
          <div className="ibkrnew-form-grid">{numberField('Freshness (hours)', ['filters', 'stock', 'corporate_events', 'maximum_age_hours'], events.maximum_age_hours, { min: 1 })}{numberField('Days before earnings', ['filters', 'stock', 'corporate_events', 'earnings_blackout_days_before'], events.earnings_blackout_days_before, { step: 1 })}{numberField('Days after earnings', ['filters', 'stock', 'corporate_events', 'earnings_blackout_days_after'], events.earnings_blackout_days_after, { step: 1 })}</div>
        </section>
      </div>
      <section className="panel ibkrnew-section">
        <div className="ibkrnew-section-heading"><div><p className="page-hero-kicker">ETF filter</p><h2>Exchange-traded funds</h2><p className="page-muted">ETF rules are evaluated independently and never inherit stock-index membership or company-fundamental thresholds.</p></div>{checkField('Enable ETFs', ['filters', 'etf', 'enabled'], etf.enabled)}</div>
        <div className="ibkrnew-check-row">{checkField('Fail closed', ['filters', 'etf', 'fail_closed'], etf.fail_closed, 'Require a fresh ETF profile.')}</div>
        <div className="ibkrnew-form-grid">
          <label className="ibkrnew-field"><span>ETF allowlist</span><input value={listText(etf.allowlist)} placeholder="Optional: SPY, QQQ" onChange={(e) => update(['filters', 'etf', 'allowlist'], list(e.target.value))} /></label>
          <label className="ibkrnew-field"><span>ETF denylist</span><input value={listText(etf.denylist)} placeholder="Optional" onChange={(e) => update(['filters', 'etf', 'denylist'], list(e.target.value))} /></label>
          <label className="ibkrnew-field"><span>ETF categories</span><input value={listText(etf.categories)} placeholder="EQUITY, INDEX" onChange={(e) => update(['filters', 'etf', 'categories'], list(e.target.value))} /></label>
          {numberField('Profile freshness (hours)', ['filters', 'etf', 'profile_maximum_age_hours'], etf.profile_maximum_age_hours, { min: 1 })}
          {numberField('Minimum ETF price (USD)', ['filters', 'etf', 'minimum_price_usd'], etf.minimum_price_usd)}
          {numberField('Maximum ETF price (USD)', ['filters', 'etf', 'maximum_price_usd'], etf.maximum_price_usd)}
          {numberField('Minimum average daily volume', ['filters', 'etf', 'minimum_average_daily_volume'], etf.minimum_average_daily_volume, { min: 1, step: 1 })}
          {numberField('Maximum spread (%)', ['filters', 'etf', 'maximum_spread_pct'], etf.maximum_spread_pct, { step: 0.01 })}
          {numberField('Minimum assets under management (USD)', ['filters', 'etf', 'minimum_assets_under_management_usd'], etf.minimum_assets_under_management_usd)}
        </div>
      </section>
      <details className="panel ibkrnew-json"><summary>Advanced universe JSON</summary><textarea rows={24} value={editor} onChange={(e) => setEditor(e.target.value)} spellCheck="false" /></details>
    </> : <section className="panel ibkrnew-json"><div className="ibkrnew-section-heading"><div><h2>{label(kind)}</h2><p className="page-muted">Published owner versions are immutable and retained for audit and rollback.</p></div><span className="ibkrnew-version">v{data?.configs?.[kind]?.version || '—'}</span></div><textarea rows={30} value={editor} onChange={(e) => setEditor(e.target.value)} spellCheck="false" /></section>}
    {kind !== 'goal' && <div className="ibkrnew-actions"><button type="button" className="btn-primary" disabled={busy || !parsed} onClick={publish}>{busy ? 'Publishing…' : `Publish immutable ${label(kind)} version`}</button>{kind === 'strategy_skill' && <span className="page-muted">Default skill: <code>.cursor/skills/ibkrnew-trade-strategy/SKILL.md</code></span>}</div>}
  </div>;
}
