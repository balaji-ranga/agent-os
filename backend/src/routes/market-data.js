/**
 * Market-data content-tool routes (FMP-backed). Entitled owner required; never body-spoof owner.
 */
import { Router } from 'express';
import { allowInternalOrAuth } from '../middleware/internal-auth.js';
import { resolveEntitledOwnerUserId } from '../services/tool-owner-scope.js';
import { parseForceFlag } from '../services/tool-summary-cache.js';
import * as marketData from '../services/market-data.js';
import { toolApiRateLimitMiddleware } from '../services/tool-api-rate-limits.js';

const router = Router();

function entitledOwnerId(req) {
  const owner = resolveEntitledOwnerUserId(req, { fallbackToBala: true });
  if (!owner) throw new Error('owner_user_id could not be resolved');
  return owner;
}

function sendResult(res, result) {
  if (!result || result.ok === false) {
    const status = result?.status || (result?.error?.includes('not configured') ? 503 : 400);
    return res.status(status).json(result || { ok: false, error: 'unknown error' });
  }
  return res.json(result);
}

router.use(allowInternalOrAuth);
router.use(toolApiRateLimitMiddleware);

router.post('/regime', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const body = req.body || {};
    const force = parseForceFlag(body);
    console.log('[market-data] regime owner=%s force=%s', owner, force);
    const result = await marketData.getRegime({
      indexSymbol: body.indexSymbol || body.index_symbol || body.symbol || 'SPY',
      force,
    });
    sendResult(res, result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/screener', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const body = req.body || {};
    const force = parseForceFlag(body);
    console.log('[market-data] screener owner=%s force=%s', owner, force);
    const {
      force: _f,
      refresh: _r,
      owner_user_id: _o,
      minMarketCap,
      min_market_cap,
      limit,
      exchange,
      country,
      volumeMoreThan,
      volume_more_than,
      priceMoreThan,
      price_more_than,
      isActivelyTrading,
      is_actively_trading,
      ...extra
    } = body;
    const result = await marketData.runScreener({
      minMarketCap: minMarketCap ?? min_market_cap ?? 5e10,
      limit: limit ?? 100,
      force,
      exchange: exchange || null,
      country: country ?? 'US',
      volumeMoreThan: volumeMoreThan ?? volume_more_than ?? null,
      priceMoreThan: priceMoreThan ?? price_more_than ?? null,
      isActivelyTrading: isActivelyTrading ?? is_actively_trading ?? true,
      ...extra,
    });
    sendResult(res, result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/history', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const body = req.body || {};
    const force = parseForceFlag(body);
    const symbol = body.symbol || body.ticker;
    console.log('[market-data] history owner=%s symbol=%s force=%s', owner, symbol || '', force);
    const result = await marketData.getHistory({
      symbol,
      days: body.days ?? 260,
      force,
    });
    sendResult(res, result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/fundamentals', async (req, res) => {
  try {
    const owner = entitledOwnerId(req);
    const body = req.body || {};
    const force = parseForceFlag(body);
    const symbol = body.symbol || body.ticker;
    console.log('[market-data] fundamentals owner=%s symbol=%s force=%s', owner, symbol || '', force);
    const result = await marketData.getFundamentals({ symbol, force });
    sendResult(res, result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

export default router;
