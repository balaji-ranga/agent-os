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
import { resolveIbkrCashUsd } from '../services/ibkr-cash-resolve.js';

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

/**
 * Laptop bridge → VPS (no session cookie).
 * Auth: same secret as Monthly Trading W3 event hook (x-workflow-hook-secret).
 * Records order events immediately so IBKR Summary fills in without waiting on W3 scripts.
 */
router.post('/local-bridge-webhook', async (req, res) => {
  try {
    const { verifyHookSecret, triggerWorkflowFromHook } = await import(
      '../services/agent-workflow-webhooks.js'
    );
    const secret =
      req.headers['x-workflow-hook-secret'] ||
      req.headers['x-webhook-secret'] ||
      req.query.secret;
    const w3Id = 'monthly-trading-w3-events';
    const check = verifyHookSecret(w3Id, secret);
    if (!check.ok) {
      return res.status(check.error === 'Workflow not found' ? 404 : 403).json({
        ok: false,
        error: check.error || 'invalid secret',
      });
    }
    const owner = check.ownerUserId;
    const { clientIpFromRequest } = await import('../services/ip-match.js');
    const { assertFeatureIpAllowed, IP_FEATURES } = await import('../services/owner-ip-whitelist.js');
    const clientIp = clientIpFromRequest(req);
    const ipCheck = assertFeatureIpAllowed(owner, IP_FEATURES.IBKR_BRIDGE, clientIp);
    if (!ipCheck.ok) {
      console.warn(
        '[ibkr-trading] local-bridge-webhook IP denied owner=%s ip=%s reason=%s',
        owner,
        clientIp || '?',
        ipCheck.reason
      );
      return res.status(403).json({ ok: false, error: ipCheck.reason || 'Client IP not allowed' });
    }
    const body = req.body || {};
    const eventType = String(body.event || body.event_type || body.type || '')
      .trim()
      .toLowerCase();

    let orderResult = null;
    const isOrder =
      /fill|reject|cancel|order_status|stop_out|stop-out|placed|submit/.test(eventType) ||
      body?.payload?.result != null ||
      body?.payload?.results != null ||
      body?.payload?.trade != null;
    if (isOrder) {
      const { ingestBridgeOrderEvents, ensureIbkrOrderEventTables } = await import(
        '../services/ibkr-order-events.js'
      );
      ensureIbkrOrderEventTables();
      orderResult = ingestBridgeOrderEvents(owner, body);
      console.info(
        '[ibkr-trading] local-bridge-webhook order owner=%s event=%s recorded=%s',
        owner,
        orderResult.event_type,
        orderResult.recorded
      );
    }

    let equity = null;
    let snapshotIngest = null;
    if (eventType === 'equity_mark' || eventType === 'eod_snapshot' || eventType === 'account_snapshot') {
      try {
        ensureIbkrMonthlyTables();
        const payload = body.payload && typeof body.payload === 'object' ? body.payload : body;
        const equityUsd = Number(payload.equity_usd ?? payload.equity ?? payload.NetLiquidation);
        const cashUsd = Number(payload.cash_usd ?? payload.cash);
        if (Number.isFinite(equityUsd) && equityUsd > 0) {
          equity = recordEquityMark(owner, {
            equity: equityUsd,
            cash: Number.isFinite(cashUsd) ? cashUsd : null,
            date: payload.captured_at || body.ts || null,
            detail: { source: 'local_bridge_webhook', event: eventType },
          });
        }
        // Persist full book (positions + open_orders) so IBKR Summary / W1 Maker see laptop truth.
        if (eventType === 'account_snapshot' || eventType === 'eod_snapshot' || Array.isArray(payload.positions)) {
          const { ingestAccountSnapshotFromBridge, ensureIbkrAnalyticsTables } = await import(
            '../services/ibkr-analytics.js'
          );
          ensureIbkrAnalyticsTables();
          snapshotIngest = ingestAccountSnapshotFromBridge(owner, payload, {
            source: 'local-ibkr-bridge',
          });
          console.info(
            '[ibkr-trading] local-bridge-webhook snapshot ingest owner=%s event=%s positions=%s open_orders=%s cash=%s',
            owner,
            eventType,
            snapshotIngest?.position_count ?? (payload.positions || []).length,
            Array.isArray(payload.open_orders) ? payload.open_orders.length : null,
            snapshotIngest?.cash_usd ?? cashUsd
          );
        }
      } catch (e) {
        console.warn('[ibkr-trading] local-bridge-webhook equity/snapshot: %s', e.message || e);
      }
    }

    let w3 = null;
    const fanout = body.fanout_w3 === true || req.query.fanout_w3 === '1' || eventType === 'eod_snapshot';
    if (fanout) {
      try {
        const run = await triggerWorkflowFromHook(w3Id, body, {
          actor: { id: 'local-bridge', name: 'Local IBKR bridge', type: 'system' },
        });
        w3 = { ok: true, run_id: run.id, run_number: run.run_number, status: run.status };
      } catch (e) {
        w3 = { ok: false, error: e.message || String(e) };
        console.warn('[ibkr-trading] local-bridge-webhook W3 fanout: %s', e.message || e);
      }
    }

    res.status(202).json({
      ok: true,
      owner_user_id: owner,
      event: eventType || null,
      order_events: orderResult,
      equity,
      account_snapshot: snapshotIngest,
      w3,
    });
  } catch (e) {
    console.warn('[ibkr-trading] local-bridge-webhook failed: %s', e.message || e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

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
    // query cash_usd is workflow-style fallback only (snapshot wins when present)
    const workflowCash = req.query.cash_usd != null ? Number(req.query.cash_usd) : undefined;
    res.json(
      ledger.getDayStatus(owner, {
        workflowCash: Number.isFinite(workflowCash) ? workflowCash : undefined,
      })
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Ingest laptop-bridge account snapshot (cash/positions/open orders).
 * Body = gateway snapshot or equity/eod envelope payload. Owner from session/internal, never body spoof.
 */
router.post('/account-snapshot/ingest', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const budgetOpts = resolveWorkflowBudgetOpts(req);
    const { ingestAccountSnapshotFromBridge, ensureIbkrAnalyticsTables } = await import(
      '../services/ibkr-analytics.js'
    );
    ensureIbkrAnalyticsTables();
    const body = req.body || {};
    const raw = body.snapshot && typeof body.snapshot === 'object' ? { ...body, ...body.snapshot } : body;
    const ingested = ingestAccountSnapshotFromBridge(owner, raw, {
      source: body.source || raw.source || 'local-ibkr-bridge',
    });
    const positions = enrichPositions(raw.positions || ingested.positions || [], budgetOpts.allowlist);
    syncPositionMeta(owner, positions, budgetOpts.allowlist);

    // Also refresh monthly equity mark when equity present (guardrail learnings).
    let equity_mark = null;
    try {
      const equity = body.equity_usd ?? body.equity ?? raw.equity_usd ?? raw.equity;
      const cash = body.cash_usd ?? body.cash ?? raw.cash_usd ?? raw.cash;
      if (equity != null && Number(equity) >= 0) {
        ensureIbkrMonthlyTables();
        equity_mark = recordEquityMark(owner, {
          equity,
          cash,
          date: body.date || body.mark_date || null,
          detail: { source: ingested.source, captured_at: ingested.captured_at },
        });
      }
    } catch (e) {
      equity_mark = { ok: false, error: e.message || String(e) };
    }

    console.info(
      '[ibkr-trading] account-snapshot ingest owner=%s positions=%s cash=%s source=%s',
      owner,
      ingested.position_count,
      ingested.cash_usd,
      ingested.source
    );
    res.json({ ok: true, ...ingested, equity_mark });
  } catch (e) {
    console.warn('[ibkr-trading] account-snapshot ingest failed: %s', e.message || e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * Last successful laptop IBKR session book (no live Gateway on VPS required).
 * W1 / Maker should prefer this over POST /account-snapshot live Gateway.
 */
router.get('/account-snapshot/latest', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const budgetOpts = resolveWorkflowBudgetOpts(req);
    const { getLatestAccountSnapshot, ensureIbkrAnalyticsTables } = await import(
      '../services/ibkr-analytics.js'
    );
    ensureIbkrAnalyticsTables();
    const snap = getLatestAccountSnapshot(owner);
    const positions = enrichPositions(snap.positions || [], budgetOpts.allowlist);
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
    const day = ledger.getDayStatus(owner, {
      snapshot: snap,
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
      ok: snap.ok !== false,
      bodyText: null,
    };
    body.bodyText = JSON.stringify(body);
    res.status(snap.ok === false && snap.error === 'no_cached_snapshot' ? 404 : 200).json(body);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/account-snapshot', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const budgetOpts = resolveWorkflowBudgetOpts(req);
    const bodyIn = req.body || {};
    const preferCached =
      bodyIn.prefer_cached === true ||
      bodyIn.prefer_cached === 1 ||
      bodyIn.prefer_cached === '1' ||
      bodyIn.use_cache === true ||
      String(bodyIn.source || '').toLowerCase() === 'cache';
    const forceLive =
      bodyIn.force_live === true || bodyIn.force_live === 1 || bodyIn.force_live === '1';

    const {
      reconcileReservationsWithBroker,
      buildOrderLearnings,
      ensureIbkrOrderEventTables,
    } = await import('../services/ibkr-order-events.js');
    ensureIbkrOrderEventTables();

    const finishFromSnap = async (snap, snapSource) => {
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
          source: snapSource || 'account_snapshot',
        });
      } catch (e) {
        analytics_persist = { ok: false, error: e.message };
      }

      const day = ledger.getDayStatus(owner, {
        snapshot: snap,
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
        snapshot_source: snapSource,
        ok: true,
        bodyText: null,
      };
      body.bodyText = JSON.stringify(body);
      return body;
    };

    if (preferCached && !forceLive) {
      const { getLatestAccountSnapshot, ensureIbkrAnalyticsTables } = await import(
        '../services/ibkr-analytics.js'
      );
      ensureIbkrAnalyticsTables();
      const cached = getLatestAccountSnapshot(owner);
      if (cached.ok) {
        return res.json(await finishFromSnap(cached, 'bridge_cache'));
      }
      if (!forceLive) {
        return res.status(404).json({
          ok: false,
          error: cached.error || 'no_cached_snapshot',
          message: cached.message,
          snapshot_source: 'none',
        });
      }
    }

    try {
      const { fetchAccountSnapshot } = await import('../services/ibkr-gateway-client.js');
      const snap = await fetchAccountSnapshot({ allowlist: budgetOpts.allowlist });
      // Prefer to also store last live read as cache when gateway is co-located.
      try {
        const { ingestAccountSnapshotFromBridge, ensureIbkrAnalyticsTables } = await import(
          '../services/ibkr-analytics.js'
        );
        ensureIbkrAnalyticsTables();
        ingestAccountSnapshotFromBridge(owner, snap, { source: 'vps_live_gateway' });
      } catch (e) {
        console.warn('[ibkr-trading] live snapshot cache write failed: %s', e.message || e);
      }
      return res.json(await finishFromSnap(snap, 'live_gateway'));
    } catch (liveErr) {
      // Fallback to last laptop push when live Gateway unreachable (typical VPS).
      try {
        const { getLatestAccountSnapshot, ensureIbkrAnalyticsTables } = await import(
          '../services/ibkr-analytics.js'
        );
        ensureIbkrAnalyticsTables();
        const cached = getLatestAccountSnapshot(owner);
        if (cached.ok) {
          console.info(
            '[ibkr-trading] account-snapshot live failed; serving bridge_cache owner=%s captured_at=%s',
            owner,
            cached.captured_at
          );
          const out = await finishFromSnap(cached, 'bridge_cache_fallback');
          out.live_error = liveErr.message || String(liveErr);
          out.bodyText = JSON.stringify(out);
          return res.json(out);
        }
      } catch {
        /* fall through */
      }
      res.status(503).json({ ok: false, error: liveErr.message });
    }
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

router.post('/preflight', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const cfg = getIbkrTradingConfig();
    const budgetOpts = resolveWorkflowBudgetOpts(req);
    const body = req.body || {};
    const cashRes = resolveIbkrCashUsd(owner, {
      snapshot: body.snapshot || null,
      workflowCash: body,
      requireCash: budgetOpts.requireLiveCash && cfg.tradingEnabled,
      rejectStale: budgetOpts.requireLiveCash && cfg.tradingEnabled,
    });
    if (!cashRes.ok && budgetOpts.requireLiveCash && cfg.tradingEnabled) {
      return res.status(400).json({
        ok: false,
        error: cashRes.error || 'cash required from IBKR snapshot',
        cash: cashRes,
      });
    }

    const result = ledger.preflight(owner, {
      workflowCash: body,
      snapshot: body.snapshot || null,
      budgetUsd: budgetOpts.dailyBudgetUsd,
      maxTradesPerDay: budgetOpts.maxTradesPerDay,
      requireCash: budgetOpts.requireLiveCash && cfg.tradingEnabled,
    });
    res.json({
      ...result,
      cash: cashRes,
      daily_budget_usd: budgetOpts.dailyBudgetUsd,
      max_trades_per_day: budgetOpts.maxTradesPerDay,
      allowlist_keys: budgetOpts.allowlistKeys,
      allowlist: budgetOpts.allowlist,
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
    const body = req.body || {};
    let snap = body.snapshot || null;
    let positions = body.positions || snap?.positions || [];
    let pendingSellSymbols = body.pending_sell_symbols || snap?.pending_sell_symbols || [];

    if (!snap || !positions.length) {
      try {
        const { getLatestAccountSnapshot, ensureIbkrAnalyticsTables } = await import(
          '../services/ibkr-analytics.js'
        );
        ensureIbkrAnalyticsTables();
        const cached = getLatestAccountSnapshot(owner);
        if (cached?.ok !== false) {
          snap = snap || cached;
          if (!positions.length) positions = enrichPositions(cached.positions || [], budgetOpts.allowlist);
          if (!pendingSellSymbols.length) pendingSellSymbols = cached.pending_sell_symbols || [];
        }
      } catch {
        /* optional */
      }
    }
    if (positions.length) syncPositionMeta(owner, enrichPositions(positions, budgetOpts.allowlist), budgetOpts.allowlist);

    const result = ledger.validateAndPreview(owner, plan, {
      workflowCash: body,
      snapshot: snap,
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
    res.status(result.ok ? 200 : 400).json(result);
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
    const body = req.body || {};
    const trades = body.trades_to_place || body.trades || [];
    const residual = body.residual || [];
    const runId = body.run_id ?? null;
    const plan = { trades_to_place: trades, residual };
    const preview = ledger.validateAndPreview(owner, plan, {
      workflowCash: body,
      positions: body.positions || [],
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

    // Mandatory plan validation: cash from IBKR snapshot → workflow body fallback only
    const body = req.body || {};
    let positions = body.positions || [];
    let snap = body.snapshot || null;
    if (!positions.length || !snap) {
      try {
        const { getLatestAccountSnapshot, ensureIbkrAnalyticsTables } = await import(
          '../services/ibkr-analytics.js'
        );
        ensureIbkrAnalyticsTables();
        const cached = getLatestAccountSnapshot(owner);
        if (cached?.ok !== false) {
          snap = snap || cached;
          if (!positions.length) {
            positions = enrichPositions(cached.positions || [], budgetOpts.allowlist);
          }
        }
      } catch (e) {
        if (budgetOpts.requireLiveCash) {
          return res.status(503).json({
            ok: false,
            error: `Account snapshot required for place: ${e.message}`,
          });
        }
      }
    }
    const cashRes = resolveIbkrCashUsd(owner, {
      snapshot: snap,
      workflowCash: body,
      requireCash: budgetOpts.requireLiveCash,
      rejectStale: budgetOpts.requireLiveCash,
    });
    if (!cashRes.ok && budgetOpts.requireLiveCash) {
      return res.status(400).json({ ok: false, error: cashRes.error, cash: cashRes });
    }
    const preview = ledger.validateAndPreview(
      owner,
      { trades_to_place: trades, residual },
      {
        workflowCash: body,
        snapshot: snap,
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
        snapshot: snap,
        budgetUsd: budgetOpts.dailyBudgetUsd,
        maxTradesPerDay: budgetOpts.maxTradesPerDay,
      }),
      order_learnings: buildOrderLearnings(owner),
    });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

router.post('/bridge-order-events', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const { ingestBridgeOrderEvents, ensureIbkrOrderEventTables } = await import(
      '../services/ibkr-order-events.js'
    );
    ensureIbkrOrderEventTables();
    const body = req.body || {};
    const result = ingestBridgeOrderEvents(owner, body);
    console.info(
      '[ibkr-trading] bridge-order-events owner=%s event=%s recorded=%s',
      owner,
      result.event_type,
      result.recorded
    );
    res.json(result);
  } catch (e) {
    console.warn('[ibkr-trading] bridge-order-events failed: %s', e.message || e);
    res.status(400).json({ ok: false, error: e.message });
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

/**
 * Map open plan(s) or Maker JSON → bridge order payloads (no Gateway).
 * POST body: open-plans shape, plan row, or { actions: [...] }.
 */
router.post('/map-day-plan', async (req, res) => {
  try {
    entitledOwnerId(req);
    const { mapDayPlanToBridgeOrders } = await import('../services/trading-plan-bridge-map.js');
    const mapping = mapDayPlanToBridgeOrders(req.body || {}, {
      respectCeoApproval: req.body?.respect_ceo_approval !== false,
    });
    res.status(mapping.ok ? 200 : 400).json(mapping);
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

/**
 * IBKR Summary dashboard (portfolio + day-wise planned vs executed).
 * Owner from session only. include_live=1 tries Gateway snapshot (usually laptop-only).
 */
router.get('/summary', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const days = req.query.days != null ? Number(req.query.days) : 30;
    const includeLive =
      req.query.include_live === '1' ||
      req.query.include_live === 'true' ||
      req.query.includeLive === '1';
    const { getSummaryDashboard } = await import('../services/ibkr-summary-dashboard.js');
    const data = await getSummaryDashboard(owner, { days, includeLive });
    res.json(data);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** Day drilldown: full plan, mapping, order events, fills for one plan_date. */
router.get('/summary/day', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const planDate = req.query.plan_date || req.query.date || '';
    const { getDayDrilldown } = await import('../services/ibkr-summary-dashboard.js');
    const data = getDayDrilldown(owner, planDate);
    if (data?.ok === false && data.error === 'plan_not_found') {
      return res.status(404).json(data);
    }
    res.json(data);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * Preview or clear owner-scoped IBKR transactional data (plans, fills, order events, …).
 * Does NOT clear workflow Variables (budget, allowlist, strategy knobs).
 * GET = preview counts. POST body { confirm: "CLEAR_IBKR_TRANSACTIONAL" } = delete.
 */
router.get('/summary/clear-transactional', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const { previewTransactionalIbkrData } = await import('../services/ibkr-transactional-clear.js');
    res.json(previewTransactionalIbkrData(owner));
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/summary/clear-transactional', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const body = req.body || {};
    const { clearTransactionalIbkrData, IBKR_CLEAR_TX_CONFIRM } = await import(
      '../services/ibkr-transactional-clear.js'
    );
    if (body.preview === true || body.dry_run === true) {
      const { previewTransactionalIbkrData } = await import('../services/ibkr-transactional-clear.js');
      return res.json(previewTransactionalIbkrData(owner));
    }
    const result = clearTransactionalIbkrData(owner, {
      confirm: body.confirm || body.confirmation || '',
    });
    console.info(
      '[ibkr-trading] clear-transactional owner=%s deleted=%s',
      owner,
      result.total_deleted
    );
    res.json({ ...result, confirm_phrase: IBKR_CLEAR_TX_CONFIRM });
  } catch (e) {
    console.warn('[ibkr-trading] clear-transactional failed: %s', e.message || e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

export default router;
