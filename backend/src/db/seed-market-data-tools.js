/**
 * Seed market-data APIs into content_tools_meta (regime / screener / history / fundamentals).
 */
import { getDb } from './schema.js';
import { writeOpenClawToolsList } from '../services/content-tools-meta.js';
import {
  getAgentToolGrants,
  syncAllowlistsFile,
  syncOpenClawJsonForAgent,
  writeAgentToolsMd,
} from '../services/openclaw-agent-tools.js';

export const MARKET_DATA_TOOLS = [
  {
    name: 'market_regime',
    display_name: 'Market Regime',
    endpoint: '/api/market-data/regime',
    method: 'POST',
    purpose:
      'Index (default SPY) vs 200-DMA regime. Returns last_close, sma_200, risk_on. Body optional: { "indexSymbol": "SPY", "force": false }. Requires MARKET_DATA_API_KEY.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'market_screener',
    display_name: 'Market Screener',
    endpoint: '/api/market-data/screener',
    method: 'POST',
    purpose:
      'Screen liquid large-cap US names (default mcap ≥ $50B). Returns ranked candidates. Body optional: minMarketCap, limit, country, exchange, volumeMoreThan, force.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'market_history',
    display_name: 'Market History',
    endpoint: '/api/market-data/history',
    method: 'POST',
    purpose:
      'Daily bars + SMA50/200, 3m/6m momentum, 52w high distance, avg volume 20. Body: { "symbol": "AAPL", "days": 260, "force": false }.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
  {
    name: 'market_fundamentals',
    display_name: 'Market Fundamentals',
    endpoint: '/api/market-data/fundamentals',
    method: 'POST',
    purpose:
      'Annual income-statement growth approx (revenue_yoy, eps_yoy). Body: { "symbol": "AAPL", "force": false }.',
    model_used: '',
    enabled: 1,
    is_builtin: 0,
  },
];

export const MARKET_DATA_TOOL_NAMES = MARKET_DATA_TOOLS.map((t) => t.name);

/** Sample bodies for Content tools UI Test panel. */
export const MARKET_DATA_DEFAULT_TEST_BODIES = {
  market_regime: { indexSymbol: 'SPY', force: false },
  market_screener: { minMarketCap: 5e10, limit: 25, country: 'US', force: false },
  market_history: { symbol: 'AAPL', days: 260, force: false },
  market_fundamentals: { symbol: 'AAPL', force: false },
};

/** Read-only market data useful for COO chat. */
export const MARKET_DATA_COO_TOOL_NAMES = [...MARKET_DATA_TOOL_NAMES];

export function seedMarketDataToolsIfMissing() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const upd = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ? WHERE name = ?'
  );
  for (const t of MARKET_DATA_TOOLS) {
    stmt.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used, t.enabled, t.is_builtin);
    upd.run(t.purpose, t.display_name, t.endpoint, t.method, t.name);
  }
  writeOpenClawToolsList();
  grantMarketDataToolsToCoo();
}

export function grantMarketDataToolsToCoo(agentId = 'balserve') {
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? OR openclaw_agent_id = ?').get(agentId, agentId);
  if (!agent) {
    console.warn(`[market-data-tools] skip COO grant — agent ${agentId} not found`);
    return { granted: [], agent_id: null };
  }
  const ins = db.prepare(
    'INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)'
  );
  let added = 0;
  for (const name of MARKET_DATA_COO_TOOL_NAMES) {
    const info = ins.run(agent.id, name);
    if (info.changes) added += 1;
  }
  try {
    syncAllowlistsFile();
    syncOpenClawJsonForAgent(agent);
    writeAgentToolsMd(agent, getAgentToolGrants(agent.id)).catch(() => {});
  } catch (e) {
    console.warn('[market-data-tools] COO allowlist sync:', e?.message || e);
  }
  if (added) console.log(`[market-data-tools] granted ${added} market-data tool(s) to ${agent.id}`);
  return { granted: MARKET_DATA_COO_TOOL_NAMES, agent_id: agent.id, added };
}
