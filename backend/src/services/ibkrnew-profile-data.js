// Slow-moving eligibility data only. Never used for executable prices or orders.
export function profileProviders(universe, environment = 'paper') {
  const value = universe?.profile_data?.[environment] || {};
  return { fundamentals_provider: value.fundamentals_provider || 'IBKR', earnings_provider: value.earnings_provider || 'IBKR' };
}

export function fmpSymbol(symbol) {
  const value = String(symbol || '').trim().toUpperCase().replace(/[ .]/g, '-');
  if (!/^[A-Z][A-Z0-9-]{0,15}$/.test(value)) throw new Error('PROFILE_SYMBOL_INVALID');
  return value;
}
const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
function selected(rows, symbol) {
  if (!Array.isArray(rows)) throw new Error('FMP_RESPONSE_INVALID');
  return rows.filter(row => row && row.symbol === fmpSymbol(symbol));
}

export function mapFmpFundamentals({ symbol, profiles, ratios, income, cashFlow, now = new Date() }) {
  const p = selected(profiles, symbol)[0], r = selected(ratios, symbol)[0];
  const quarters = selected(income, symbol).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 4);
  if (!p || p.isEtf === true || p.isFund === true || p.currency !== 'USD' || !(number(p.marketCap) > 0) || number(r?.debtToEquityRatioTTM) === null) throw new Error('FMP_REQUIRED_FUNDAMENTALS_MISSING');
  if (quarters.length !== 4 || quarters.some(q => !date(q.date) || q.reportedCurrency !== 'USD' || number(q.revenue) === null || !/^Q[1-4]$/.test(q.period))) throw new Error('FMP_REVENUE_QUARTERS_INVALID');
  const ordinals = quarters.map(q => Number(q.fiscalYear) * 4 + Number(q.period.slice(1)));
  if (ordinals.some((n, i) => !Number.isInteger(n) || i > 0 && ordinals[i - 1] - n !== 1)) throw new Error('FMP_REVENUE_QUARTERS_NOT_CONSECUTIVE');
  const age = now.getTime() - Date.parse(`${quarters[0].date}T00:00:00Z`);
  if (age < 0 || age > 200 * 86400000) throw new Error('FMP_FINANCIAL_PERIOD_STALE');
  const fundamentals = { market_cap_usd: p.marketCap, revenue_ttm_usd: quarters.reduce((sum, q) => sum + q.revenue, 0), debt_to_equity: r.debtToEquityRatioTTM, sector: typeof p.sector === 'string' ? p.sector.slice(0, 100) : '', currency: 'USD', revenue_period_end: quarters[0].date, revenue_basis: 'four_consecutive_fiscal_quarters', fetched_at: now.toISOString() };
  if (cashFlow) {
    const cash = selected(cashFlow, symbol);
    const matched = quarters.map(q => cash.find(c => c.date === q.date && c.period === q.period && c.reportedCurrency === 'USD' && number(c.operatingCashFlow) !== null));
    if (matched.some(c => !c)) throw new Error('FMP_CASH_FLOW_QUARTERS_INVALID');
    fundamentals.operating_cash_flow_ttm_usd = matched.reduce((sum, q) => sum + q.operatingCashFlow, 0);
  }
  return { symbol, security_type: 'STK', fundamentals, fundamentals_at: now.toISOString(), fundamentals_source: 'FMP' };
}

export function mapFmpEarnings({ symbol, earnings, now = new Date() }) {
  const today = now.toISOString().slice(0, 10);
  const rows = selected(earnings, symbol);
  if (!rows.length || rows.some(r => !date(r.date))) throw new Error('FMP_EARNINGS_UNVERIFIED');
  // An empty response must never mean "no earnings risk". Require both historical
  // and upcoming coverage from the symbol-specific endpoint, not a global list.
  const upcoming = rows.filter(r => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  if (!upcoming.length || !rows.some(r => r.date < today)) throw new Error('FMP_EARNINGS_COVERAGE_INCOMPLETE');
  if (upcoming.some(r => !date(r.lastUpdated) || Date.parse(`${r.lastUpdated}T00:00:00Z`) > now.getTime() || now.getTime() - Date.parse(`${r.lastUpdated}T00:00:00Z`) > 7 * 86400000)) throw new Error('FMP_EARNINGS_SOURCE_STALE');
  const unique = [...new Map(rows.map(r => [r.date, { type: 'earnings', date: r.date, date_only: true, source: 'FMP', source_updated_at: r.lastUpdated || null }])).values()];
  return { symbol, security_type: 'STK', corporate_events: unique, corporate_events_at: now.toISOString(), corporate_events_source: 'FMP', earnings_coverage: { verified: true, next_earnings_date: upcoming[0].date, fetched_at: now.toISOString() } };
}

export function earningsBlackout(events, beforeDays, afterDays, now = new Date()) {
  const nyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const day = Date.parse(`${nyDate}T00:00:00Z`);
  return events.some(event => {
    if (String(event.type || event.event_type || '').toLowerCase() !== 'earnings') return false;
    if (event.date_only === true) {
      if (!date(event.date)) return true; // Invalid event dates fail closed.
      const at = Date.parse(`${event.date}T00:00:00Z`);
      return day >= at - beforeDays * 86400000 && day <= at + afterDays * 86400000;
    }
    const at = Date.parse(event.at || event.date);
    return Number.isFinite(at) && at >= now.getTime() - afterDays * 86400000 && at <= now.getTime() + beforeDays * 86400000;
  });
}
