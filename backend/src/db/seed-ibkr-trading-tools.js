/**
 * Seed IBKR paper-trading APIs into content_tools_meta so they appear in
 * Content tools UI and can be tested via POST /api/tools/test/:name.
 */
import { getDb } from './schema.js';
import { writeOpenClawToolsList } from '../services/content-tools-meta.js';
import {
  getAgentToolGrants,
  syncAllowlistsFile,
  syncOpenClawJsonForAgent,
  writeAgentToolsMd,
} from '../services/openclaw-agent-tools.js';

export const IBKR_TRADING_TOOLS = [
  {
    name: 'ibkr_gateway_ping',
    display_name: 'IBKR Gateway Ping',
    endpoint: '/api/ibkr-trading/gateway-ping',
    method: 'GET',
    purpose:
      'Ping the IBKR Client Portal Gateway / IB Gateway connectivity. Returns ok status and latency. Use to verify paper trading plumbing before day-plan runs.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_config',
    display_name: 'IBKR Trading Config',
    endpoint: '/api/ibkr-trading/config',
    method: 'GET',
    purpose:
      'Return IBKR gateway settings plus day-plan policy (budget, allowlist, max trades) resolved from the IBKR maker/checker workflow variables.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_day_status',
    display_name: 'IBKR Day Status',
    endpoint: '/api/ibkr-trading/day-status',
    method: 'GET',
    purpose:
      'Return today\'s budget ledger for the CEO: spent, remaining, trade count, residuals. Optional query/body cash_usd to compute remaining against live cash.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_account_snapshot',
    display_name: 'IBKR Account Snapshot',
    endpoint: '/api/ibkr-trading/account-snapshot',
    method: 'POST',
    purpose:
      'Live Gateway snapshot when co-located, else last laptop bridge push (auto-fallback). Prefer GET /account-snapshot/latest or body { prefer_cached: true } on VPS. Body optional: force_live, prefer_cached.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_account_snapshot_latest',
    display_name: 'IBKR Account Snapshot (cached)',
    endpoint: '/api/ibkr-trading/account-snapshot/latest',
    method: 'GET',
    purpose:
      'Return last successful laptop IBKR session book (cash, positions, open orders) pushed by local-ibkr-bridge via W3. Use for Maker/W1 when VPS has no Gateway.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_account_snapshot_ingest',
    display_name: 'IBKR Account Snapshot Ingest',
    endpoint: '/api/ibkr-trading/account-snapshot/ingest',
    method: 'POST',
    purpose:
      'Ingest a full account snapshot from the laptop bridge (W3 webhook path). Owner from session — never spoof body owner_user_id. Body: gateway snapshot or equity/eod payload with positions/cash/equity.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_preflight',
    display_name: 'IBKR Preflight',
    endpoint: '/api/ibkr-trading/preflight',
    method: 'POST',
    purpose:
      'Check whether the CEO can still place trades today (budget + max trades). Body optional: cash_usd, snapshot, require_live_cash overrides from workflow variables.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_validate_plan',
    display_name: 'IBKR Validate Plan',
    endpoint: '/api/ibkr-trading/validate-plan',
    method: 'POST',
    purpose:
      'Validate a maker day-plan JSON (trades array with key/side/qty/entry/stop/tp/rationale) against allowlist, budget, and risk rules. Body: { "plan": { "trades": [...] } } or raw trades.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_exit_candidates',
    display_name: 'IBKR Exit Candidates',
    endpoint: '/api/ibkr-trading/exit-candidates',
    method: 'POST',
    purpose:
      'List open positions past max_hold_days (from workflow variables or body). Body: { "positions": [...], "max_hold_days": 5 }. Used by the position poller.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_record_hold',
    display_name: 'IBKR Record Hold',
    endpoint: '/api/ibkr-trading/record-hold',
    method: 'POST',
    purpose:
      'Extend hold_until for one position after a HOLD review. Body: { "key": "PAXOS:BTC", "extend_days": 1, "review": { "decision": "HOLD" } }.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_record_holds_batch',
    display_name: 'IBKR Record Holds Batch',
    endpoint: '/api/ibkr-trading/record-holds-batch',
    method: 'POST',
    purpose:
      'Batch record HOLD decisions. Body: { "holds": [{ "key": "PAXOS:BTC", "extend_days": 1, "review": {} }] }.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_reserve',
    display_name: 'IBKR Reserve Budget',
    endpoint: '/api/ibkr-trading/reserve',
    method: 'POST',
    purpose:
      'Reserve daily budget for approved trades before Gateway place. Body: { "trades_to_place": [...], "residual": [], "run_id": null }.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_release',
    display_name: 'IBKR Release Reservation',
    endpoint: '/api/ibkr-trading/release',
    method: 'POST',
    purpose:
      'Release a pending budget reservation (e.g. place rejected). Body: { "reservation_id": 123, "reason": "rejected" }.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_confirm_fill',
    display_name: 'IBKR Confirm Fill',
    endpoint: '/api/ibkr-trading/confirm-fill',
    method: 'POST',
    purpose:
      'Mark a reservation as filled after Gateway reports fill. Body: { "reservation_id": 123 }.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_place',
    display_name: 'IBKR Place Trades',
    endpoint: '/api/ibkr-trading/place',
    method: 'POST',
    purpose:
      'Place (or dry-run) validated trades via IB Gateway. When IBKR_TRADING_ENABLED is off, always dry-run. Body: { "trades": [...], "dry_run": true, "residual": [], "run_id": null }.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_portfolio_analytics',
    display_name: 'IBKR Portfolio Analytics',
    endpoint: '/api/ibkr-trading/analytics/summary',
    method: 'POST',
    purpose:
      'Entitled portfolio summary for the logged-in CEO: budget, live cash/positions, fills count, realized/unrealized PnL, pending deposit-like cash events. Body optional: { "days": 30, "include_live": true }. Owner is always the session user.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_fills_history',
    display_name: 'IBKR Fills History',
    endpoint: '/api/ibkr-trading/analytics/fills',
    method: 'GET',
    purpose:
      'List durable fill records for the session owner. Query: days, limit, symbol_key.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_pnl',
    display_name: 'IBKR P&L',
    endpoint: '/api/ibkr-trading/analytics/pnl',
    method: 'GET',
    purpose:
      'Realized P&L rows + unrealized from last position snapshot for the session owner. Query: days, limit.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_cash_events',
    display_name: 'IBKR Cash Events',
    endpoint: '/api/ibkr-trading/analytics/cash-events',
    method: 'GET',
    purpose:
      'Cash balance snapshots and inferred inflow/outflow (pending_review) for the session owner. Query: days, limit, pending_only=1.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_order_learnings',
    display_name: 'IBKR Order Learnings',
    endpoint: '/api/ibkr-trading/order-learnings',
    method: 'POST',
    purpose:
      'Summarize prior IBKR order cancels/fills/rejects for the session CEO (Maker context). Body: days (default 7), response_type actual|summarized (default summarized), optional symbol_key, limit, purpose. Owner from session — never spoof owner_user_id.',
    model_used: 'platform LLM when response_type=summarized',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_equity_mark',
    display_name: 'IBKR Equity Mark',
    endpoint: '/api/ibkr-trading/equity-mark',
    method: 'POST',
    purpose:
      'Record an equity/cash mark for monthly guardrail HWM tracking. Body: { "equity": 100000, "cash": 40000, "date": "YYYY-MM-DD" }. Owner from session.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'ibkr_monthly_guardrail',
    display_name: 'IBKR Monthly Guardrail',
    endpoint: '/api/ibkr-trading/monthly-guardrail',
    method: 'POST',
    purpose:
      'Compute MTD return and drawdown-from-HWM vs monthly_drawdown_stop_pct (default 4 or env). Returns risk_mode normal|reduce|halt_new. Body optional: drawdown_stop_pct, as_of.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'trading_plan_save',
    display_name: 'Trading Plan Save',
    endpoint: '/api/ibkr-trading/day-plan',
    method: 'POST',
    purpose:
      'Save/upsert a trading day plan for the session owner. Body: { "plan_date": "YYYY-MM-DD", "status": "pending|approved|executing|partial|executed|failed|superseded", "plan": {...}, "checker_verdict": {...}, "approvals": {...} }.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'trading_plan_fetch',
    display_name: 'Trading Plan Fetch',
    endpoint: '/api/ibkr-trading/day-plan',
    method: 'GET',
    purpose:
      'Fetch trading day plan by date for the session owner. Query: plan_date or date (YYYY-MM-DD). Pass open=true (or list=open) to list open plans (approved|executing|partial|failed). Pass open=true (or list=open) to list open plans (approved|executing|partial|failed).',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'trading_journal',
    display_name: 'Trading Journal',
    endpoint: '/api/ibkr-trading/trading-journal',
    method: 'POST',
    purpose:
      'Summarize fills / realized PnL / order events for weekly review (win rate, profit factor, avg win/loss). Body optional: { "days": 30 }. Graceful if tables empty.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
];

/** Sample bodies for Content tools UI Test panel. */
export const IBKR_DEFAULT_TEST_BODIES = {
  ibkr_gateway_ping: {},
  ibkr_config: {},
  ibkr_day_status: {},
  ibkr_account_snapshot: { prefer_cached: true },
  ibkr_account_snapshot_latest: {},
  ibkr_account_snapshot_ingest: {
    cash_usd: 100000,
    equity_usd: 100000,
    positions: [],
    open_orders: [],
    source: 'ui-smoke-test',
    captured_at: null,
  },
  ibkr_preflight: {},
  ibkr_validate_plan: {
    plan: {
      trades: [
        {
          key: 'PAXOS:BTC',
          side: 'BUY',
          qty: 0.001,
          entry: 65000,
          stop: 63000,
          tp: 70000,
          rationale: 'UI smoke-test plan — do not place live unless intentional.',
        },
      ],
    },
  },
  ibkr_exit_candidates: { positions: [], max_hold_days: 5 },
  ibkr_record_hold: { key: 'PAXOS:BTC', extend_days: 1, review: { decision: 'HOLD' } },
  ibkr_record_holds_batch: { holds: [] },
  ibkr_reserve: { trades_to_place: [], residual: [] },
  ibkr_release: { reservation_id: 0, reason: 'ui-test' },
  ibkr_confirm_fill: { reservation_id: 0 },
  ibkr_place: { trades: [], dry_run: true, residual: [] },
  ibkr_portfolio_analytics: { days: 30, include_live: false },
  ibkr_fills_history: {},
  ibkr_pnl: {},
  ibkr_cash_events: {},
  ibkr_order_learnings: {
    days: 7,
    response_type: 'summarized',
    limit: 40,
    purpose: 'IBKR Maker order learnings (content-tools test)',
  },
  ibkr_equity_mark: { equity: 100000, cash: 40000 },
  ibkr_monthly_guardrail: { drawdown_stop_pct: 4 },
  trading_plan_save: {
    plan_date: null,
    status: 'pending',
    plan: { holds: [], exits: [], entries: [], notes: 'UI smoke-test plan' },
  },
  trading_plan_fetch: {},
  trading_journal: { days: 30 },
};

export const IBKR_ANALYTICS_TOOL_NAMES = [
  'ibkr_portfolio_analytics',
  'ibkr_fills_history',
  'ibkr_pnl',
  'ibkr_cash_events',
];

/** Read-only IBKR tools useful for COO chat (analytics + status + learnings). */
export const IBKR_COO_TOOL_NAMES = [
  ...IBKR_ANALYTICS_TOOL_NAMES,
  'ibkr_gateway_ping',
  'ibkr_config',
  'ibkr_day_status',
  'ibkr_account_snapshot',
  'ibkr_account_snapshot_latest',
  'ibkr_preflight',
  'ibkr_order_learnings',
  'ibkr_monthly_guardrail',
  'trading_plan_fetch',
  'trading_journal',
];

export function seedIbkrTradingToolsIfMissing() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const upd = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ? WHERE name = ?'
  );
  for (const t of IBKR_TRADING_TOOLS) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
    upd.run(t.purpose, t.display_name, t.endpoint, t.method, t.name);
  }
  writeOpenClawToolsList();
  grantIbkrToolsToCoo();
}

/** Grant IBKR analytics (+ read status) tools to COO without wiping other grants. */
export function grantIbkrToolsToCoo(agentId = 'balserve') {
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? OR openclaw_agent_id = ?').get(agentId, agentId);
  if (!agent) {
    console.warn(`[ibkr-tools] skip COO grant — agent ${agentId} not found`);
    return { granted: [], agent_id: null };
  }
  const ins = db.prepare(
    'INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)'
  );
  let added = 0;
  for (const name of IBKR_COO_TOOL_NAMES) {
    const info = ins.run(agent.id, name);
    if (info.changes) added += 1;
  }
  try {
    syncAllowlistsFile();
    syncOpenClawJsonForAgent(agent);
    writeAgentToolsMd(agent, getAgentToolGrants(agent.id)).catch(() => {});
  } catch (e) {
    console.warn('[ibkr-tools] COO allowlist sync:', e?.message || e);
  }
  if (added) console.log(`[ibkr-tools] granted ${added} IBKR tool(s) to ${agent.id}`);
  return { granted: IBKR_COO_TOOL_NAMES, agent_id: agent.id, added };
}
