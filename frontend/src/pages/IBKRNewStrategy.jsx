import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const KINDS = ['goal', 'strategy_skill', 'strategy', 'policy', 'universe', 'market_data'];
const label = (value) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const statusLabel = (value = '') => label(String(value).toLowerCase());
const list = (value) => String(value || '').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
const listText = (value) => (value || []).join(', ');
function validateDocument(value, schema, path = '$') {
  const errors = [];
  if (!schema) return errors;
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [{ path, message: 'must be an object' }];
    for (const key of schema.required || []) if (!(key in value)) errors.push({ path: `${path}.${key}`, message: 'is required' });
    for (const [key, child] of Object.entries(schema.properties || {})) if (key in value) errors.push(...validateDocument(value[key], child, `${path}.${key}`));
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) errors.push({ path, message: 'must be an array' });
    else if (schema.items) value.forEach((item, index) => errors.push(...validateDocument(item, schema.items, `${path}[${index}]`)));
  } else if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push({ path, message: 'must be a number' });
    else if (schema.minimum != null && value < schema.minimum) errors.push({ path, message: `must be at least ${schema.minimum}` });
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') errors.push({ path, message: 'must be true or false' });
  else if (schema.type === 'string' && typeof value !== 'string') errors.push({ path, message: 'must be text' });
  if (schema.enum && !schema.enum.includes(value)) errors.push({ path, message: `must be one of: ${schema.enum.join(', ')}` });
  return errors;
}

export default function IBKRNewStrategy() {
  const [data, setData] = useState(null);
  const [kind, setKind] = useState('goal');
  const [editor, setEditor] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [profileStatus, setProfileStatus] = useState(null);
  const [providerDraft, setProviderDraft] = useState({ fundamentals_provider: 'IBKR', earnings_provider: 'IBKR' });
  const [schemas, setSchemas] = useState(null);
  const [history, setHistory] = useState([]);
  const [goalHistory, setGoalHistory] = useState([]);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [goalDraft, setGoalDraft] = useState({ name: 'IBKRNew 5% in 30 Days', mode: 'PERPETUAL', target_return_pct: 5, duration_days: 30 });
  const load = async () => { try { const [dashboard, schemaSet] = await Promise.all([api.ibkrNewDashboard(), api.ibkrNewSchemas()]); const environment = dashboard.execution_mode?.requested_mode || dashboard.environment; const [goals, profiles] = await Promise.all([api.ibkrNewGoalHistory(50, environment), api.ibkrNewProfileStatus(environment)]); setData(dashboard); setSchemas(schemaSet); setGoalHistory(goals.items || []); setProfileStatus(profiles); setProviderDraft(dashboard.configs?.universe?.profile_data?.[environment] || { fundamentals_provider: 'IBKR', earnings_provider: 'IBKR' }); setError(''); } catch (e) { setError(e.message); } };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (kind !== 'goal') api.ibkrNewConfigHistory(kind).then((result) => setHistory(result.items || [])).catch((e) => setError(e.message)); }, [kind, data]);
  useEffect(() => { if (data?.configs?.[kind]) setEditor(JSON.stringify(data.configs[kind], null, 2)); }, [data, kind]);
  useEffect(() => { if (data?.goal?.definition) setGoalDraft((prior) => ({ ...prior, ...data.goal.definition })); }, [data?.goal?.definition]);
  const parsed = useMemo(() => { try { return JSON.parse(editor); } catch { return null; } }, [editor]);
  const currentSchema = schemas?.[kind];
  const validate = () => { if (!parsed) { setValidationErrors([{ path: '$', message: 'Enter valid JSON before validating.' }]); return false; } const next = validateDocument(parsed, currentSchema); setValidationErrors(next); return next.length === 0; };
  const update = (path, value) => {
    if (!parsed) return;
    const next = structuredClone(parsed); let cursor = next;
    path.slice(0, -1).forEach((part) => { cursor[part] ||= {}; cursor = cursor[part]; });
    cursor[path.at(-1)] = value; setEditor(JSON.stringify(next, null, 2));
  };
  const publish = async () => {
    if (!validate()) return;
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
  const saveGoal = () => actGoal(async () => { await api.ibkrNewSetGoal({ ...goalDraft, duration_basis: 'CALENDAR_DAYS', capital_basis: 'CYCLE_START_ELIGIBLE_CAPITAL_CAPPED_BY_TOTAL_BUDGET', profit_basis: 'NET_REALIZED_AFTER_COMMISSIONS' }, executionMode.requested_mode); setNotice(`A new immutable ${executionMode.requested_mode} goal and cycle were activated.`); });
  const actGoal = async (fn) => { setBusy(true); setNotice(''); try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const switchMode = (mode) => actGoal(async () => {
    const result = await api.ibkrNewSetExecutionMode(mode);
    const readiness = result.activation_state === 'ACTIVE' ? 'The matching bridge is attested and execution is enabled.' : 'Orders remain blocked until a matching desktop bridge attests its IBKR account context.';
    setNotice(`${mode.toUpperCase()} account context selected. ${readiness} ${result.cancelled_authorizations || 0} unsubmitted authorization(s) from the prior context were cancelled.`);
  });
  const downloadBridge = (environment) => actGoal(async () => { await api.ibkrNewBridgePackageDownload({ includeRuntime: true, environment }); setNotice(`${label(environment)} desktop bridge downloaded with fresh owner-scoped credentials.`); });
  const executionMode = data?.execution_mode || { requested_mode: 'paper', active_mode: null, activation_state: 'AWAITING_BRIDGE' };
  const publishProviders = () => actGoal(async () => {
    const document = structuredClone(data.configs.universe);
    delete document.id; delete document.version; delete document.status;
    document.profile_data ||= { live: { fundamentals_provider: 'IBKR', earnings_provider: 'IBKR' } };
    document.profile_data[executionMode.requested_mode] = providerDraft;
    await api.ibkrNewPublishConfig('universe', document);
    const refresh = await api.ibkrNewRefreshProfiles();
    setNotice(`${label(executionMode.requested_mode)} profile providers published. ${refresh.queued ? 'Refresh queued; coverage must pass validation before entries.' : `Refresh waiting: ${refresh.reason}.`} The goal, risk limits, IBKR quotes and orders are unchanged.`);
  });
  const universe = kind === 'universe' ? parsed : null;
  const stock = universe?.filters?.stock; const fundamentals = stock?.fundamentals; const events = stock?.corporate_events; const etf = universe?.filters?.etf;
  const numberField = (caption, path, value, options = {}) => <label className="ibkrnew-field"><span>{caption}</span><input type="number" min={options.min ?? 0} step={options.step ?? 'any'} value={value ?? ''} onChange={(e) => update(path, Number(e.target.value))} /></label>;
  const checkField = (caption, path, checked, hint) => <label className="ibkrnew-check"><input type="checkbox" checked={checked === true} onChange={(e) => update(path, e.target.checked)} /><span><strong>{caption}</strong>{hint && <small>{hint}</small>}</span></label>;

  return <div className="page page-wide ibkrnew-page">
    <header className="page-hero"><div className="page-hero-top"><div className="page-hero-titles"><p className="page-hero-kicker">Prebuilt Workflows · IBKRNew0</p><h1>Goal, strategy &amp; universe</h1></div><span className={`ibkrnew-environment is-${executionMode.requested_mode}`}>{executionMode.requested_mode.toUpperCase()} · {statusLabel(executionMode.activation_state)}</span></div><p className="page-hero-sub">The selected account context owns its goal and progress; shared strategy and deterministic risk controls use one execution path in Paper and Live.</p></header>
    {error && <div className="page-banner page-banner-error" role="alert"><span>{error}</span><button type="button" className="btn-ghost" onClick={() => setError('')}>Dismiss</button></div>}
    {notice && <div className="page-banner ibkrnew-success" role="status"><span>{notice}</span><button type="button" className="btn-ghost" onClick={() => setNotice('')}>Dismiss</button></div>}
    <section className={`panel ibkrnew-mode-panel is-${executionMode.requested_mode}`}>
      <div><p className="page-hero-kicker">Broker account context</p><h2>Paper or Live</h2><p className="page-muted">Both contexts use the same strategy, policy, universe, budgets, workflow, planner, risk gates, and bridge code. Goals, progress, account snapshots, positions, orders, events, and reports remain isolated by account context.</p></div>
      <div className="ibkrnew-mode-controls" role="group" aria-label="Trading mode">
        <button type="button" className={executionMode.requested_mode === 'paper' ? 'btn-primary' : 'btn-secondary'} disabled={busy || executionMode.requested_mode === 'paper'} onClick={() => switchMode('paper')}>Paper</button>
        <button type="button" className={executionMode.requested_mode === 'live' ? 'btn-danger' : 'btn-secondary'} disabled={busy || executionMode.requested_mode === 'live'} onClick={() => switchMode('live')}>Live</button>
      </div>
      <dl className="ibkrnew-mode-state"><div><dt>Requested mode</dt><dd>{executionMode.requested_mode}</dd></div><div><dt>Execution state</dt><dd>{statusLabel(executionMode.activation_state)}</dd></div><div><dt>Executable mode</dt><dd>{executionMode.execution_enabled ? executionMode.active_mode : 'Blocked'}</dd></div><div><dt>Account attestation</dt><dd>{executionMode.attestation_status || 'Waiting'}</dd></div></dl>
      {executionMode.activation_state !== 'ACTIVE' && <div className="page-banner page-banner-warning"><span>{executionMode.requested_mode.toUpperCase()} orders are blocked. Download the matching bridge, configure its desktop-only account, enable the single local execution gate, and connect it to the corresponding IB Gateway session.</span><button type="button" className="btn-secondary" disabled={busy} onClick={() => downloadBridge(executionMode.requested_mode)}>Download {executionMode.requested_mode} bridge</button></div>}
    </section>
    <section className="panel ibkrnew-section">
      <div className="ibkrnew-section-heading"><div><p className="page-hero-kicker">Eligibility data · {executionMode.requested_mode.toUpperCase()}</p><h2>Fundamentals and earnings providers</h2><p className="page-muted">Quotes, volume and order execution remain IBKR. Provider selections and profile caches are separate for Paper and Live; saving providers does not activate or switch trading mode. ETFs do not require company fundamentals or earnings.</p></div></div>
      <div className="ibkrnew-form-grid">{[['fundamentals_provider', 'Fundamentals'], ['earnings_provider', 'Earnings calendar']].map(([field, caption]) => <label className="ibkrnew-field" key={field}><span>{caption} provider</span><select disabled={busy} value={providerDraft[field]} onChange={e => setProviderDraft({ ...providerDraft, [field]: e.target.value })}><option value="IBKR">IBKR · requires validated entitlement/feed</option><option value="FMP">FMP · existing server API key</option></select></label>)}</div>
      <p className="page-muted">IBKR fundamentals currently returned error 10358; IBKR earnings requires Wall Street Horizon Corporate Event Data and a validated feed. Selecting IBKR does not activate an entitlement. FMP refresh checks symbol matching, USD units, consecutive revenue quarters and dated historical/upcoming earnings coverage. Missing or stale data remains blocked; no silent provider fallback.</p>
      <div className="ibkrnew-actions"><button className="btn-primary" type="button" disabled={busy || !data} onClick={publishProviders}>Save {label(executionMode.requested_mode)} profile providers</button><button className="btn-secondary" type="button" disabled={busy} onClick={() => actGoal(async () => { const result = await api.ibkrNewRefreshProfiles(); setNotice(result.queued ? 'Profile refresh queued; pacing and retry limits remain enforced.' : `Refresh waiting: ${result.reason}`); })}>Refresh required profiles</button><button className="btn-ghost" type="button" disabled={busy} onClick={load}>Check refresh progress</button></div>
      {profileStatus?.automatic_fmp_refresh && <p role="status">FMP refresh: {profileStatus.ready_fundamentals || 0} fundamentals ready · {profileStatus.ready_earnings || 0} earnings calendars ready · {profileStatus.failed || 0} failed. Profile readiness is not trade readiness.</p>}
      {!!profileStatus?.items?.some(item => item.status === 'failed') && <details><summary>Profile refresh failures</summary><ul>{profileStatus.items.filter(item => item.status === 'failed').map(item => <li key={`${item.symbol}-${item.family}`}>{item.symbol} · {item.family} · {item.reason_code}</li>)}</ul></details>}
    </section>
    <nav className="ibkrnew-tabs" aria-label="IBKRNew configuration sections">{KINDS.map((item) => <button type="button" key={item} className={kind === item ? 'btn-primary' : 'btn-secondary'} aria-current={kind === item ? 'page' : undefined} onClick={() => { setKind(item); setValidationErrors([]); }}>{label(item)}</button>)}<button type="button" className="btn-ghost ibkrnew-info-button" title="Show the schema and allowed values" aria-label="Show schema" onClick={() => setSchemaOpen(true)}>ⓘ Schema</button></nav>

    {kind === 'goal' ? <section className="panel ibkrnew-section">
      <div className="ibkrnew-section-heading"><div><p className="page-hero-kicker">{executionMode.requested_mode.toUpperCase()} outcome authority</p><h2>{label(executionMode.requested_mode)} trading objective</h2><p className="page-muted">This goal and its progress belong only to the selected account context. New openings stop when net realized profit after commissions reaches the target or the cycle duration ends.</p></div><span className="ibkrnew-version">{data?.goal?.cycle?.status || data?.goal?.block_reason || 'WAITING'}</span></div>
      <div className="ibkrnew-form-grid">
        <label className="ibkrnew-field ibkrnew-field-wide"><span>Goal name</span><input value={goalDraft.name} onChange={(e) => setGoalDraft({ ...goalDraft, name: e.target.value })} /></label>
        <label className="ibkrnew-field"><span>Cycle mode</span><select value={goalDraft.mode} onChange={(e) => setGoalDraft({ ...goalDraft, mode: e.target.value })}><option value="PERPETUAL">Perpetual 30-day cycles</option><option value="ONE_TIME">One-time objective</option></select></label>
        <label className="ibkrnew-field"><span>Target return (%)</span><input type="number" min="0.01" max="100" step="0.01" value={goalDraft.target_return_pct} onChange={(e) => setGoalDraft({ ...goalDraft, target_return_pct: Number(e.target.value) })} /></label>
        <label className="ibkrnew-field"><span>Cycle duration (calendar days)</span><input type="number" min="1" max="3650" step="1" value={goalDraft.duration_days} onChange={(e) => setGoalDraft({ ...goalDraft, duration_days: Number(e.target.value) })} /></label>
      </div>
      {data?.goal?.cycle && <div className="this-week-grid"><article><small>Cycle capital</small><strong>${Number(data.goal.cycle.capital_basis_usd).toFixed(2)}</strong></article><article><small>Target net profit</small><strong>${Number(data.goal.cycle.target_profit_usd).toFixed(2)}</strong></article><article><small>Net realized</small><strong>${Number(data.goal.cycle.net_realized_profit_usd).toFixed(2)}</strong></article><article><small>Remaining</small><strong>${Number(data.goal.cycle.remaining_profit_usd).toFixed(2)} · {data.goal.cycle.days_remaining} days</strong></article></div>}
      <div className="ibkrnew-actions"><button type="button" className="btn-primary" disabled={busy} onClick={saveGoal}>Activate as a new {executionMode.requested_mode} goal</button>{data?.goal?.definition?.status === 'ACTIVE' ? <button type="button" className="btn-secondary" disabled={busy} onClick={() => actGoal(() => api.ibkrNewPauseGoal(executionMode.requested_mode))}>Pause goal</button> : data?.goal?.definition?.status === 'PAUSED' ? <button type="button" className="btn-secondary" disabled={busy} onClick={() => actGoal(() => api.ibkrNewResumeGoal(executionMode.requested_mode))}>Resume goal</button> : null}<button type="button" className="btn-secondary" onClick={() => setHistoryOpen(true)}>View goal history</button></div>
      {goalHistory.length > 0 && <section className="ibkrnew-history-summary"><strong>Past goals retained</strong><span>{goalHistory.filter((item) => item.status !== 'ACTIVE' && item.status !== 'PAUSED').length} readonly versions are available in history.</span></section>}
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
    </> : <section className="panel ibkrnew-json"><div className="ibkrnew-section-heading"><div><h2>{label(kind)} <button type="button" className="ibkrnew-inline-info" title="Show schema" aria-label={`Show ${label(kind)} schema`} onClick={() => setSchemaOpen(true)}>ⓘ</button></h2><p className="page-muted">Published owner versions are immutable and retained for audit and rollback.</p></div><div className="ibkrnew-section-heading-actions"><span className="ibkrnew-version">v{data?.configs?.[kind]?.version || '—'}</span><button type="button" className="btn-secondary" onClick={() => setHistoryOpen(true)}>Version history</button></div></div><textarea rows={30} value={editor} onChange={(e) => { setEditor(e.target.value); setValidationErrors([]); }} spellCheck="false" />{validationErrors.length > 0 && <div className="ibkrnew-validation-errors" role="alert"><strong>Schema validation failed</strong>{validationErrors.map((item, index) => <div key={`${item.path}-${index}`}><code>{item.path}</code> {item.message}</div>)}</div>}</section>}
    {kind !== 'goal' && <div className="ibkrnew-actions"><button type="button" className="btn-secondary" disabled={!parsed || !currentSchema} onClick={validate}>Validate JSON</button><button type="button" className="btn-primary" disabled={busy || !parsed || validationErrors.length > 0} onClick={publish}>{busy ? 'Publishing…' : `Publish immutable ${label(kind)} version`}</button>{kind === 'strategy_skill' && <span className="page-muted">Default skill: <code>.cursor/skills/ibkrnew-trade-strategy/SKILL.md</code></span>}</div>}
    {schemaOpen && <div className="ibkrnew-modal-backdrop" role="presentation" onClick={() => setSchemaOpen(false)}><section className="ibkrnew-modal" role="dialog" aria-modal="true" aria-labelledby="ibkrnew-schema-title" onClick={(event) => event.stopPropagation()}><div className="ibkrnew-modal-header"><div><h2 id="ibkrnew-schema-title">{label(kind)} schema</h2><p className="page-muted">Field descriptions and allowed values used by the backend validator and IBKR agent.</p></div><button type="button" className="btn-ghost" onClick={() => setSchemaOpen(false)}>Close</button></div><pre className="ibkrnew-schema-view">{JSON.stringify(currentSchema, null, 2)}</pre></section></div>}
    {historyOpen && <div className="ibkrnew-modal-backdrop" role="presentation" onClick={() => setHistoryOpen(false)}><section className="ibkrnew-modal ibkrnew-history-modal" role="dialog" aria-modal="true" aria-labelledby="ibkrnew-history-title" onClick={(event) => event.stopPropagation()}><div className="ibkrnew-modal-header"><div><h2 id="ibkrnew-history-title">{kind === 'goal' ? 'Goal history' : `${label(kind)} version history`}</h2><p className="page-muted">Read-only audit history. Older versions are never edited or silently reactivated.</p></div><button type="button" className="btn-ghost" onClick={() => setHistoryOpen(false)}>Close</button></div><div className="ibkrnew-table-wrap"><table className="ibkrnew-table"><thead><tr><th>Version</th><th>Status</th><th>Created</th><th>Details</th></tr></thead><tbody>{(kind === 'goal' ? goalHistory : history).map((item) => <tr key={item.goal_id || item.id}><td>{item.version ? `v${item.version}` : item.goal_id}</td><td><span className="ibkrnew-status">{item.status}</span></td><td>{item.created_at || '—'}</td><td><details><summary>View readonly JSON</summary><pre className="ibkrnew-history-json">{JSON.stringify(item.document || item, null, 2)}</pre></details></td></tr>)}</tbody></table>{(kind === 'goal' ? goalHistory : history).length === 0 && <p className="page-muted">No prior versions.</p>}</div></section></div>}
  </div>;
}
