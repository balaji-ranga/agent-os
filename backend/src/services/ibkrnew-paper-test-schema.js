// Separate, immutable origin evidence. Never infer a test from client metadata
// alone; only a matching server-created row can exempt goal-performance linkage.
export function ensurePaperExecutionTestSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ibkrnew_paper_execution_tests (
    test_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL,
    bridge_id TEXT NOT NULL, request_id TEXT NOT NULL, trading_day TEXT NOT NULL,
    source_event_id TEXT NOT NULL, authorization_id TEXT NOT NULL UNIQUE,
    exit_authorization_id TEXT, symbol TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(owner_user_id,request_id), UNIQUE(owner_user_id,trading_day)
  )`);
}

export function assertPaperExecutionTestAuthorization(db, bridge, authorization) {
  if (!authorization.execution_test) return;
  const row = db.prepare(`SELECT * FROM ibkrnew_paper_execution_tests
    WHERE test_id=? AND owner_user_id=? AND bridge_id=?`).get(
    authorization.execution_test.test_id, bridge.owner_user_id, bridge.bridge_id);
  const opening = authorization.action === 'OPEN';
  const matches = opening ? row?.authorization_id === authorization.authorization_id
    : authorization.action === 'EXIT' && authorization.side === 'SELL' && row?.authorization_id === authorization.parent_trade_authorization_id;
  if (bridge.environment !== 'paper' || authorization.environment !== 'paper' || !matches
    || authorization.execution_test.purpose !== 'paper_execution_test'
    || authorization.quantity !== 1 || authorization.contract?.symbol !== row.symbol
    || !['EEM','TLT'].includes(row.symbol)) throw Object.assign(new Error('invalid_paper_execution_test'), { status:409 });
  if (opening && (authorization.side !== 'BUY' || authorization.expression !== 'LONG_STOCK'
    || authorization.entry?.order_type !== 'LIMIT' || !(authorization.entry.limit_price > 0)
    || authorization.entry.limit_price > 100
    || !(authorization.protection?.stop_price > 0 && authorization.protection.stop_price < authorization.entry.limit_price)
    || authorization.entry.limit_price - authorization.protection.stop_price > 1
    || !(authorization.budget?.daily_opening_reserved_usd > 0 && authorization.budget.daily_opening_reserved_usd <= 103)
    || !(authorization.budget?.total_exposure_reserved_usd > 0 && authorization.budget.total_exposure_reserved_usd <= 103)
    || !(authorization.budget?.estimated_round_trip_commission_usd >= 0 && authorization.budget.estimated_round_trip_commission_usd <= 3)
    || !(authorization.protection.targets?.length === 1 && authorization.protection.targets[0].quantity === 1 && authorization.protection.targets[0].limit_price > authorization.entry.limit_price))) {
    throw Object.assign(new Error('paper_execution_test_bound_exceeded'), { status:409 });
  }
}
