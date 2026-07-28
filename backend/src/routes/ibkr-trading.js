/**
 * IBKR paper trading budget / validate / reserve / snapshot API.
 */
import { Router } from 'express';
import { allowInternalOrAuth } from '../middleware/internal-auth.js';
import { getIbkrTradingConfig, findAllowlistEntry } from '../services/ibkr-trading-rules.js';
import * as ledger from '../services/ibkr-trading-ledger.js';
import { getDb } from '../db/schema.js';
import * as store from '../services/agent-workflow-store.js';
import { resolveIbkrPolicy } from '../services/ibkr-workflow-variables.js';
import { resolveEntitledOwnerUserId } from '../services/tool-owner-scope.js';
import { parseForceFlag } from '../services/tool-summary-cache.js';
import {
  ensureIbkrMonthlyTables,
  recordEquityMark,
  getMonthlyGuardrail,
} from '../services/ibkr-monthly-guardrail.js';
import {
  savePlan,
  getPlan,
  listOpenPlans,
  markPlanExecution,
  updateStatus,
  PLAN_STATUSES,
} from '../services/trading-day-plans.js';
import { summarizeJournal } from '../services/trading-journal.js';

const router = Router();

/**
 * Policy from the IBKR day-plan workflow definition variables only.
 * Request body must not override allowlist/budget/limits (hardening).
 */
function resolveWorkflowBudgetOpts(_req) {
  const def = store.getDefinition('ibkr-maker-checker-paper');
  const policy = resolveIbkrPolicy(def?.variables || {});
  return {
    policy,
    dailyBudgetUsd: policy.daily_budget_usd,
    maxTradesPerDay: policy.max_trades_per_day,
    allowlist: policy.allowlist,
    allowlistKeys: policy.allowlist_keys,
    minRationaleChars: policy.min_rationale_chars,
    blockDuplicateBuys: policy.block_duplicate_buys,
    requireLiveCash: policy.require_live_cash,
    maxHoldDays: policy.max_hold_days,
  };
}

/**
 * Owner from session / trusted headers (x-ceo-user-id set by /tools/invoke, /tools/test, workflow runner).
 * Never body/query spoof.
 */
function entitledOwnerId(req) {
  const owner = resolveEntitledOwnerUserId(req, { fallbackToBala: true });
  if (!owner) throw new Error('owner_user_id could not be resolved');
  return owner;
}

function enrichPositions(positions = [], catalog = null) {
  return (positions || []).map((p) => {
    const meta = findAllowlistEntry(p.key || `${p.exchange}:${p.symbol}` || p.symbol, catalog);
    return {
      ...p,
      key: meta?.key || p.key || `${p.exchange || 'SMART'}:${p.symbol}`,
      symbol: meta?.symbol || p.symbol,
    };
  });
}

function syncPositionMeta(ownerUserId, positions = [], catalog = null) {
  const db = getDb();
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO ibkr_position_meta (owner_user_id, symbol_key, opened_at, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(owner_user_id, symbol_key) DO UPDATE SET updated_at = datetime('now')`
  );
  for (const p of enrichPositions(positions, catalog)) {
    if (!(Number(p.qty) > 0) || !p.key) continue;
    const existing = db
      .prepare('SELECT opened_at FROM ibkr_position_meta WHERE owner_user_id = ? AND symbol_key = ?')
      .get(ownerUserId, p.key);
    if (!existing) upsert.run(ownerUserId, p.key, now);
    else upsert.run(ownerUserId, p.key, existing.opened_at || now);
  }
}

function ageDays(openedAt) {
  if (!openedAt) return 0;
  const t = Date.parse(openedAt);
  if (!Number.isFinite(t)) return 0;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

router.use(allowInternalOrAuth);

router.get('/config', (req, res) => {
  const budgetOpts = resolveWorkflowBudgetOpts(req);
  res.json({
    gateway: getIbkrTradingConfig(),
    policy: budgetOpts.policy,
    allowlist: budgetOpts.allowlist,
    allowlist_keys: budgetOpts.allowlistKeys,
    source: 'workflow_variables',
  });
});

router.get('/day-status', (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const cashUsd = req.query.cash_usd != null ? Number(req.query.cash_usd) : null;
    res.json(ledger.getDayStatus(owner, { cashUsd }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/account-snapshot', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const budgetOpts = resolveWorkflowBudgetOpts(req);
    const { fetchAccountSnapshot } = await import('../services/ibkr-gateway-client.js');
    const {
      reconcileReservationsWithBroker,
      buildOrderLearnings,
      ensureIbkrOrderEventTables,
    } = await import('../services/ibkr-order-events.js');
    ensureIbkrOrderEventTables();
    const snap = await fetchAccountSnapshot({ allowlist: budgetOpts.allowlist });
    const positions = enrichPositions(snap.positions || [], budgetOpts.allowlist);
    syncPositionMeta(owner, positions, budgetOpts.allowlist);

    const reconcile = await reconcileReservationsWithBroker(owner, {
      openOrders: snap.open_orders || [],
      positions,
    });
    const order_learnings = buildOrderLearnings(owner, { days: 30, limit: 40 });

    const db = getDb();
    const withAge = positions.map((p) => {
      const meta = db
        .prepare(
          'SELECT opened_at, hold_until, last_review_at FROM ibkr_position_meta WHERE owner_user_id = ? AND symbol_key = ?'
        )
        .get(owner, p.key);
      return {
        ...p,
        opened_at: meta?.opened_at || null,
        hold_until: meta?.hold_until || null,
        age_days: ageDays(meta?.opened_at),
      };
    });

    let analytics_persist = null;
    try {
      const { persistAccountAnalyticsSnapshot, ensureIbkrAnalyticsTables } = await import(
        '../services/ibkr-analytics.js'
      );
      ensureIbkrAnalyticsTables();
      analytics_persist = persistAccountAnalyticsSnapshot(owner, {
        positions: withAge,
        cashUsd: snap.cash_usd,
        referencePrices: snap.reference_prices || {},
        accountSummary: snap.summary || null,
        source: 'account_snapshot',
      });
    } catch (e) {
      analytics_persist = { ok: false, error: e.message };
    }

    const day = ledger.getDayStatus(owner, {
      cashUsd: snap.cash_usd,
      budgetUsd: budgetOpts.dailyBudgetUsd,
      maxTradesPerDay: budgetOpts.maxTradesPerDay,
      allowlistKeys: budgetOpts.allowlistKeys,
    });
    const body = {
      ...snap,
      positions: withAge,
      day_status: day,
      daily_budget_usd: budgetOpts.dailyBudgetUsd,
      max_trades_per_day: budgetOpts.maxTradesPerDay,
      allowlist_keys: budgetOpts.allowlistKeys,
      allowlist: budgetOpts.allowlist,
      min_rationale_chars: budgetOpts.minRationaleChars,
      block_duplicate_buys: budgetOpts.blockDuplicateBuys,
      require_live_cash: budgetOpts.requireLiveCash,
      reconcile,
      order_learnings,
      analytics_persist,
      ok: true,
      bodyText: null,
    };
    body.bodyText = JSON.stringify(body);
    res.json(body);
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

router.post('/preflight', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const cfg = getIbkrTradingConfig();
    const budgetOpts = resolveWorkflowBudgetOpts(req);
    let cashUsd = req.body?.cash_usd != null ? Number(req.body.cash_usd) : null;
    let snapshot = req.body?.snapshot || null;
    const requireLiveCash = budgetOpts.requireLiveCash;

    if (cashUsd == null && requireLiveCash) {
      try {
        const { fetchAccountSnapshot } = await import('../services/ibkr-gateway-client.js');
        snapshot = await fetchAccountSnapshot();
        cashUsd = snapshot.cash_usd;
        syncPositionMeta(owner, enrichPositions(snapshot.positions || [], budgetOpts.allowlist), budgetOpts.allowlist);
      } catch (e) {
        if (cfg.tradingEnabled) {
          return res.status(503).json({
            ok: false,
            error: `Live cash required but Gateway snapshot failed: ${e.message}`,
          });
        }
      }
    }

    if (cashUsd == null && cfg.tradingEnabled && requireLiveCash) {
      return res.status(400).json({ ok: false, error: 'cash_usd required when trading enabled' });
    }

    const result = ledger.preflight(owner, {
      cashUsd,
      budgetUsd: budgetOpts.dailyBudgetUsd,
      maxTradesPerDay: budgetOpts.maxTradesPerDay,
    });
    res.json({
      ...result,
      daily_budget_usd: budgetOpts.dailyBudgetUsd,
      max_trades_per_day: budgetOpts.maxTradesPerDay,
      allowlist_keys: budgetOpts.allowlistKeys,
      allowlist: budgetOpts.allowlist,
      snapshot: snapshot
        ? {
            cash_usd: snapshot.cash_usd,
            positions: enrichPositions(snapshot.positions || [], budgetOpts.allowlist),
            pending_sell_symbols: snapshot.pending_sell_symbols || [],
            open_orders_count: (snapshot.open_orders || []).length,
          }
        : null,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/validate-plan', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const budgetOpts = resolveWorkflowBudgetOpts(req);
    let plan = req.body?.plan ?? req.body?.text ?? req.body;
    if (plan && typeof plan === 'object' && plan.trades == null && plan.plan == null && req.body?.trades) {
      plan = req.body;
    }
    if (plan && typeof plan === 'object' && Array.isArray(plan.trades)) {
      // ok
    } else if (typeof req.body === 'string') {
      plan = req.body;
    }
    let snap = req.body?.snapshot || {};
    let cashUsd =
      req.body?.cash_usd != null
        ? Number(req.body.cash_usd)
        : snap.cash_usd != null
          ? Number(snap.cash_usd)
          : null;
    let positions = req.body?.positions || snap.positions || [];
    let pendingSellSymbols = req.body?.pending_sell_symbols || snap.pending_sell_symbols || [];

    if (cashUsd == null || !positions.length) {
      try {
        const { fetchAccountSnapshot } = await import('../services/ibkr-gateway-client.js');
        const live = await fetchAccountSnapshot();
        cashUsd = cashUsd ?? live.cash_usd;
        if (!positions.length) positions = enrichPositions(live.positions || [], budgetOpts.allowlist);
        if (!pendingSellSymbols.length) pendingSellSymbols = live.pending_sell_symbols || [];
        syncPositionMeta(owner, positions, budgetOpts.allowlist);
      } catch {
        /* optional when trading disabled */
      }
    }

    const result = ledger.validateAndPreview(owner, plan, {
      cashUsd,
      positions: enrichPositions(positions, budgetOpts.allowlist),
      allowlist: budgetOpts.allowlist,
      allowlistKeys: budgetOpts.allowlistKeys,
      policy: budgetOpts.policy,
      pendingSellSymbols,
      blockDuplicateBuys: budgetOpts.blockDuplicateBuys,
      minRationaleChars: budgetOpts.minRationaleChars,
      budgetUsd: budgetOpts.dailyBudgetUsd,
      maxTradesPerDay: budgetOpts.maxTradesPerDay,
    });
    const payload = {
      ...result,
      source: 'dayplan',
      cancel_source: 'dayplan',
      bodyText: null,
    };
    payload.bodyText = JSON.stringify(payload);
    res.status(result.ok ? 200 : 400).json(payload);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/exit-candidates', (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const budgetOpts = resolveWorkflowBudgetOpts(req);
    const maxHoldDays = Number(
      req.query.max_hold_days || req.body?.max_hold_days || budgetOpts.maxHoldDays || 5
    );
    const positions = enrichPositions(req.body?.positions || [], budgetOpts.allowlist);
    const db = getDb();
    const candidates = [];
    for (const p of positions) {
      if (!(Number(p.qty) > 0)) continue;
      const meta = db
        .prepare('SELECT opened_at, hold_until FROM ibkr_position_meta WHERE owner_user_id = ? AND symbol_key = ?')
        .get(owner, p.key);
      const opened = meta?.opened_at || p.opened_at;
      const holdUntil = meta?.hold_until;
      if (holdUntil && Date.parse(holdUntil) > Date.now()) continue;
      const age = ageDays(opened);
      if (age >= maxHoldDays) {
        candidates.push({ ...p, opened_at: opened, age_days: age, max_hold_days: maxHoldDays });
      }
    }
    res.json({
      ok: true,
      has_candidates: candidates.length > 0,
      candidates,
      count: candidates.length,
      text: candidates.length ? 'true' : 'false',
      bodyText: JSON.stringify({ ok: true, has_candidates: candidates.length > 0, candidates }),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/record-hold', (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const key = String(req.body?.key || '').toUpperCase();
    const extendDays = Number(req.body?.extend_days || 1);
    const db = getDb();
    const until = new Date(Date.now() + extendDays * 86400000).toISOString();
    db.prepare(
      `INSERT INTO ibkr_position_meta (owner_user_id, symbol_key, hold_until, last_review_at, last_review_json, updated_at)
       VALUES (?, ?, ?, datetime('now'), ?, datetime('now'))
       ON CONFLICT(owner_user_id, symbol_key) DO UPDATE SET
         hold_until = excluded.hold_until,
         last_review_at = datetime('now'),
         last_review_json = excluded.last_review_json,
         updated_at = datetime('now')`
    ).run(owner, key, until, JSON.stringify(req.body?.review || { decision: 'HOLD', extend_days: extendDays }));
    res.json({ ok: true, key, hold_until: until });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/record-holds-batch', (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const holds = req.body?.holds || [];
    const db = getDb();
    const out = [];
    for (const h of holds) {
      const key = String(h.key || '').toUpperCase();
      if (!key) continue;
      const extendDays = Number(h.extend_days || 1);
      const until = new Date(Date.now() + extendDays * 86400000).toISOString();
      db.prepare(
        `INSERT INTO ibkr_position_meta (owner_user_id, symbol_key, hold_until, last_review_at, last_review_json, updated_at)
         VALUES (?, ?, ?, datetime('now'), ?, datetime('now'))
         ON CONFLICT(owner_user_id, symbol_key) DO UPDATE SET
           hold_until = excluded.hold_until,
           last_review_at = datetime('now'),
           last_review_json = excluded.last_review_json,
           updated_at = datetime('now')`
      ).run(owner, key, until, JSON.stringify(h.review || h));
      out.push({ key, hold_until: until });
    }
    res.json({ ok: true, recorded: out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/reserve', (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const budgetOpts = resolveWorkflowBudgetOpts(req);
    const trades = req.body?.trades_to_place || req.body?.trades || [];
    const residual = req.body?.residual || [];
    const runId = req.body?.run_id ?? null;
    const plan = { trades_to_place: trades, residual };
    const preview = ledger.validateAndPreview(owner, plan, {
      cashUsd: req.body?.cash_usd != null ? Number(req.body.cash_usd) : null,
      positions: req.body?.positions || [],
      allowlist: budgetOpts.allowlist,
      allowlistKeys: budgetOpts.allowlistKeys,
      policy: budgetOpts.policy,
      blockDuplicateBuys: budgetOpts.blockDuplicateBuys,
      minRationaleChars: budgetOpts.minRationaleChars,
      budgetUsd: budgetOpts.dailyBudgetUsd,
      maxTradesPerDay: budgetOpts.maxTradesPerDay,
    });
    if (!preview.ok) {
      return res.status(400).json({ ok: false, error: preview.error || 'Plan validation failed', validation: preview });
    }
    const reserved = ledger.reserveTrades(owner, trades, {
      runId,
      budgetUsd: budgetOpts.dailyBudgetUsd,
      maxTradesPerDay: budgetOpts.maxTradesPerDay,
    });
    if (reserved.ok && residual.length) ledger.saveResidual(owner, residual);
    res.status(reserved.ok ? 200 : 400).json(reserved);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/release', (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const id = Number(req.body?.reservation_id || req.body?.id);
    const reason = req.body?.reason || 'rejected';
    const result = ledger.releaseReservation(id, { reason, ownerUserId: owner });
    res.status(result.ok ? 200 : 403).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/confirm-fill', (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const id = Number(req.body?.reservation_id || req.body?.id);
    const result = ledger.confirmFill(id, {
      ownerUserId: owner,
      fillPrice: req.body?.fill_price,
      fillQty: req.body?.fill_qty,
      ibOrderId: req.body?.ib_order_id,
    });
    res.status(result.ok ? 200 : 403).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/place', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const budgetOpts = resolveWorkflowBudgetOpts(req);
    const cancelSource =
      req.body?.cancel_source ||
      req.body?.workflow_source ||
      (req.body?.source === 'poller' ? 'poller' : req.body?.source === 'dayplan' ? 'dayplan' : 'before_sell');
    let trades = req.body?.trades_to_place || req.body?.trades || [];
    // Ensure Gateway gets secType/exchange from workflow allowlist
    trades = (trades || []).map((t) => {
      const meta = findAllowlistEntry(t.key || t.symbol, budgetOpts.allowlist);
      const base = meta
        ? {
            ...t,
            key: meta.key,
            symbol: meta.symbol,
            exchange: meta.exchange,
            currency: meta.currency,
            secType: meta.secType,
            market: meta.market,
          }
        : { ...t };
      return {
        ...base,
        owner_user_id: owner,
        cancel_source:
          t.cancel_source ||
          (String(t.side || '').toUpperCase().includes('SELL') ? cancelSource : undefined),
      };
    });
    const residual = req.body?.residual || [];
    const runId = req.body?.run_id ?? null;
    const dryRun = req.body?.dry_run !== false && !getIbkrTradingConfig().tradingEnabled;

    // Mandatory plan validation before any reservation / Gateway submission
    let positions = req.body?.positions || [];
    let cashUsd = req.body?.cash_usd != null ? Number(req.body.cash_usd) : null;
    if (budgetOpts.requireLiveCash || cashUsd == null) {
      try {
        const { fetchAccountSnapshot } = await import('../services/ibkr-gateway-client.js');
        const snap = await fetchAccountSnapshot({ allowlist: budgetOpts.allowlist });
        cashUsd = snap.cash_usd;
        positions = enrichPositions(snap.positions || [], budgetOpts.allowlist);
      } catch (e) {
        if (budgetOpts.requireLiveCash) {
          return res.status(503).json({ ok: false, error: `Live cash required for place: ${e.message}` });
        }
      }
    }
    const preview = ledger.validateAndPreview(
      owner,
      { trades_to_place: trades, residual },
      {
        cashUsd,
        positions,
        allowlist: budgetOpts.allowlist,
        allowlistKeys: budgetOpts.allowlistKeys,
        policy: budgetOpts.policy,
        blockDuplicateBuys: budgetOpts.blockDuplicateBuys,
        minRationaleChars: budgetOpts.minRationaleChars,
        budgetUsd: budgetOpts.dailyBudgetUsd,
        maxTradesPerDay: budgetOpts.maxTradesPerDay,
      }
    );
    if (!preview.ok && trades.length > 0) {
      return res.status(400).json({
        ok: false,
        error: preview.error || 'Plan validation failed',
        validation: preview,
      });
    }

    if (residual.length) ledger.saveResidual(owner, residual);
    const result = await ledger.recordPlaceAttempt(owner, trades, {
      runId,
      dryRun,
      budgetUsd: budgetOpts.dailyBudgetUsd,
      maxTradesPerDay: budgetOpts.maxTradesPerDay,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/reconcile-orders', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const budgetOpts = resolveWorkflowBudgetOpts(req);
    const { fetchAccountSnapshot } = await import('../services/ibkr-gateway-client.js');
    const { reconcileReservationsWithBroker, buildOrderLearnings } = await import(
      '../services/ibkr-order-events.js'
    );
    const snap = await fetchAccountSnapshot({ allowlist: budgetOpts.allowlist });
    const positions = enrichPositions(snap.positions || [], budgetOpts.allowlist);
    const reconcile = await reconcileReservationsWithBroker(owner, {
      openOrders: snap.open_orders || [],
      positions,
      graceSec: req.body?.grace_sec != null ? Number(req.body.grace_sec) : undefined,
    });
    res.json({
      ok: true,
      reconcile,
      day_status: ledger.getDayStatus(owner, {
        cashUsd: snap.cash_usd,
        budgetUsd: budgetOpts.dailyBudgetUsd,
        maxTradesPerDay: budgetOpts.maxTradesPerDay,
      }),
      order_learnings: buildOrderLearnings(owner),
    });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

router.get('/order-events', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const { getOrderHistory, ensureIbkrOrderEventTables } = await import('../services/ibkr-order-events.js');
    ensureIbkrOrderEventTables();
    const result = await getOrderHistory({
      ownerUserId: owner,
      days: req.query.days != null ? Number(req.query.days) : 30,
      limit: req.query.limit != null ? Number(req.query.limit) : 100,
      symbolKey: req.query.symbol_key || req.query.key || null,
      responseType: req.query.response_type || req.query.responseType || 'actual',
      purpose: req.query.purpose || undefined,
      force: parseForceFlag(req.query),
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/order-events', async (req, res) => {
  try {
    const body = req.body || {};
    const owner = entitledOwnerId(req);
    const { getOrderHistory, ensureIbkrOrderEventTables } = await import('../services/ibkr-order-events.js');
    ensureIbkrOrderEventTables();
    const result = await getOrderHistory({
      ownerUserId: owner,
      days: body.days != null ? Number(body.days) : 7,
      limit: body.limit != null ? Number(body.limit) : 40,
      symbolKey: body.symbol_key || body.key || null,
      responseType: body.response_type || body.responseType || 'actual',
      purpose: body.purpose || undefined,
      force: parseForceFlag(body),
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/order-learnings', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const { getOrderHistory, ensureIbkrOrderEventTables } = await import('../services/ibkr-order-events.js');
    ensureIbkrOrderEventTables();
    // Alias: default summarized-friendly context (heuristic + optional LLM)
    const result = await getOrderHistory({
      ownerUserId: owner,
      days: req.query.days != null ? Number(req.query.days) : 30,
      limit: req.query.limit != null ? Number(req.query.limit) : 40,
      symbolKey: req.query.symbol_key || req.query.key || null,
      responseType: req.query.response_type || req.query.responseType || 'actual',
      purpose: req.query.purpose || 'IBKR Maker order learnings',
      force: parseForceFlag(req.query),
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/order-learnings', async (req, res) => {
  try {
    const body = req.body || {};
    const owner = entitledOwnerId(req);
    const { getOrderHistory, ensureIbkrOrderEventTables } = await import('../services/ibkr-order-events.js');
    ensureIbkrOrderEventTables();
    const result = await getOrderHistory({
      ownerUserId: owner,
      days: body.days != null ? Number(body.days) : 7,
      limit: body.limit != null ? Number(body.limit) : 40,
      symbolKey: body.symbol_key || body.key || null,
      responseType: body.response_type || body.responseType || 'summarized',
      purpose: body.purpose || 'IBKR Maker order learnings',
      force: parseForceFlag(body),
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** Portfolio analytics summary (entitled — session owner only). */
router.get('/analytics/summary', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const { getPortfolioAnalytics, ensureIbkrAnalyticsTables } = await import(
      '../services/ibkr-analytics.js'
    );
    ensureIbkrAnalyticsTables();
    const includeLive = String(req.query.include_live || '1') !== '0';
    const result = await getPortfolioAnalytics(owner, {
      days: req.query.days != null ? Number(req.query.days) : 30,
      includeLive,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/analytics/summary', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const body = req.body || {};
    const { getPortfolioAnalytics, ensureIbkrAnalyticsTables } = await import(
      '../services/ibkr-analytics.js'
    );
    ensureIbkrAnalyticsTables();
    const result = await getPortfolioAnalytics(owner, {
      days: body.days != null ? Number(body.days) : 30,
      includeLive: body.include_live !== false && body.includeLive !== false,
      liveSnapshot: body.snapshot || null,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/analytics/fills', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const { listFills, ensureIbkrAnalyticsTables } = await import('../services/ibkr-analytics.js');
    ensureIbkrAnalyticsTables();
    res.json({
      ok: true,
      fills: listFills(owner, {
        days: req.query.days != null ? Number(req.query.days) : 30,
        limit: req.query.limit != null ? Number(req.query.limit) : 100,
        symbolKey: req.query.symbol_key || null,
      }),
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/analytics/positions', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const { listPositionSnapshots, ensureIbkrAnalyticsTables } = await import(
      '../services/ibkr-analytics.js'
    );
    ensureIbkrAnalyticsTables();
    res.json({
      ok: true,
      positions: listPositionSnapshots(owner, {
        latestOnly: String(req.query.latest_only || '1') !== '0',
        limit: req.query.limit != null ? Number(req.query.limit) : 50,
      }),
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/analytics/pnl', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const { listRealizedPnl, listPositionSnapshots, ensureIbkrAnalyticsTables } = await import(
      '../services/ibkr-analytics.js'
    );
    ensureIbkrAnalyticsTables();
    const realized = listRealizedPnl(owner, {
      days: req.query.days != null ? Number(req.query.days) : 30,
      limit: req.query.limit != null ? Number(req.query.limit) : 100,
    });
    const snaps = listPositionSnapshots(owner, { latestOnly: true });
    const unrealized = snaps.reduce((s, p) => s + (Number(p.unrealized_pnl_usd) || 0), 0);
    res.json({
      ok: true,
      realized_usd: Number(realized.reduce((s, r) => s + (Number(r.realized_pnl_usd) || 0), 0).toFixed(4)),
      unrealized_usd: Number(unrealized.toFixed(4)),
      realized_rows: realized,
      position_snapshot: snaps,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/analytics/cash-events', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const { listCashEvents, ensureIbkrAnalyticsTables } = await import('../services/ibkr-analytics.js');
    ensureIbkrAnalyticsTables();
    res.json({
      ok: true,
      events: listCashEvents(owner, {
        days: req.query.days != null ? Number(req.query.days) : 30,
        limit: req.query.limit != null ? Number(req.query.limit) : 100,
        pendingOnly: String(req.query.pending_only || '0') === '1',
      }),
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/gateway-ping', async (_req, res) => {
  try {
    const { pingIbGateway } = await import('../services/ibkr-gateway-client.js');
    const result = await pingIbGateway();
    res.json(result);
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

/* ---- Monthly trading: equity marks / guardrail / day plans / journal ---- */

router.post('/equity-mark', (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const body = req.body || {};
    ensureIbkrMonthlyTables();
    const result = recordEquityMark(owner, {
      equity: body.equity ?? body.equity_usd,
      cash: body.cash ?? body.cash_usd,
      date: body.date ?? body.mark_date,
      detail: body.detail ?? null,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/monthly-guardrail', (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    ensureIbkrMonthlyTables();
    res.json(
      getMonthlyGuardrail(owner, {
        drawdownStopPct:
          req.query.drawdown_stop_pct != null ? Number(req.query.drawdown_stop_pct) : null,
        asOfDate: req.query.as_of || req.query.date || null,
      })
    );
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/monthly-guardrail', (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const body = req.body || {};
    ensureIbkrMonthlyTables();
    res.json(
      getMonthlyGuardrail(owner, {
        drawdownStopPct: body.drawdown_stop_pct ?? body.drawdownStopPct ?? null,
        asOfDate: body.as_of || body.date || null,
      })
    );
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/day-plan', (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    ensureIbkrMonthlyTables();
    const plan = savePlan(owner, req.body || {});
    res.json({ ok: true, plan, statuses: PLAN_STATUSES });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/day-plan', (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    ensureIbkrMonthlyTables();
    const open =
      req.query.open === '1' ||
      req.query.open === 'true' ||
      String(req.query.list || '').toLowerCase() === 'open';
    if (open) {
      const plans = listOpenPlans(owner, {
        limit: req.query.limit != null ? Number(req.query.limit) : 14,
      });
      return res.json({ ok: true, plans, statuses: PLAN_STATUSES });
    }
    const plan = getPlan(owner, {
      plan_date: req.query.plan_date || req.query.date || null,
    });
    res.json({ ok: true, plan });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** Patch status / merge execution report (W2 laptop execution). */
router.post('/day-plan/execution', (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    ensureIbkrMonthlyTables();
    const body = req.body || {};
    const plan = markPlanExecution(owner, body);
    res.json({ ok: true, plan });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.patch('/day-plan/status', (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    ensureIbkrMonthlyTables();
    const body = req.body || {};
    const plan = updateStatus(owner, {
      plan_date: body.plan_date || body.date,
      status: body.status,
      approvals: body.approvals,
    });
    res.json({ ok: true, plan });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/trading-journal', (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const body = req.body || {};
    res.json(
      summarizeJournal(owner, {
        days: body.days != null ? Number(body.days) : 30,
      })
    );
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

export default router;
