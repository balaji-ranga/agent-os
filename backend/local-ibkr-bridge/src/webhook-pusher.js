/**
 * Queue + retry POST to VPS workflow webhook.
 * Header: x-workflow-hook-secret. Body: { event, ts, source, payload }.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { logInfo, logWarn, logError } from './log.js';

/**
 * @param {object} cfg from loadConfig()
 */
export function createWebhookPusher(cfg) {
  /** @type {Array<{ id: string, envelope: object, attempts: number, nextAt: number }>} */
  let queue = [];
  let timer = null;
  let stopped = false;

  function loadPersisted() {
    try {
      if (!existsSync(cfg.webhookRetryFile)) return;
      const raw = readFileSync(cfg.webhookRetryFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.queue)) {
        queue = parsed.queue.filter((q) => q?.envelope?.event);
        logInfo('loaded webhook retry queue', { count: queue.length });
      }
    } catch (e) {
      logWarn('failed to load webhook retry file', { error: e.message || String(e) });
    }
  }

  function persist() {
    try {
      mkdirSync(dirname(cfg.webhookRetryFile), { recursive: true });
      writeFileSync(
        cfg.webhookRetryFile,
        JSON.stringify({ updated_at: new Date().toISOString(), queue }, null, 2),
        'utf8'
      );
    } catch (e) {
      logWarn('failed to persist webhook retry file', { error: e.message || String(e) });
    }
  }

  function backoffMs(attempts) {
    const base = cfg.webhookBaseBackoffMs || 1000;
    const exp = Math.min(attempts, 10);
    return Math.min(base * 2 ** exp, 15 * 60 * 1000);
  }

  const api = {
    /**
     * @param {object} envelope
     * Overridable in tests (assign `pusher.deliverOnce = ...`).
     */
    async deliverOnce(envelope) {
      if (!cfg.webhookUrl) {
        logInfo('webhook skip (WEBHOOK_URL empty)', { event: envelope.event });
        return { ok: true, skipped: true };
      }
      const headers = {
        'content-type': 'application/json',
        accept: 'application/json',
      };
      if (cfg.webhookSecret) {
        headers['x-workflow-hook-secret'] = cfg.webhookSecret;
      }
      const res = await fetch(cfg.webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`webhook HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return { ok: true };
    },
  };

  function enqueue(envelope, { attempts = 0 } = {}) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    queue.push({
      id,
      envelope,
      attempts,
      nextAt: Date.now(),
    });
    persist();
    schedule();
    return id;
  }

  /**
   * Push immediately; on failure enqueue with backoff.
   * @param {object} envelope
   */
  async function push(envelope) {
    try {
      const result = await api.deliverOnce(envelope);
      logInfo('webhook delivered', { event: envelope.event, skipped: !!result.skipped });
      return result;
    } catch (e) {
      logWarn('webhook deliver failed; queued', {
        event: envelope.event,
        error: e.message || String(e),
      });
      enqueue(envelope, { attempts: 1 });
      return { ok: false, queued: true, error: e.message || String(e) };
    }
  }

  async function drain() {
    if (stopped) return;
    const now = Date.now();
    const due = queue.filter((q) => q.nextAt <= now);
    for (const item of due) {
      try {
        await api.deliverOnce(item.envelope);
        queue = queue.filter((q) => q.id !== item.id);
        logInfo('webhook retry succeeded', { event: item.envelope.event, id: item.id });
        persist();
      } catch (e) {
        item.attempts += 1;
        if (item.attempts >= cfg.webhookMaxAttempts) {
          queue = queue.filter((q) => q.id !== item.id);
          logError('webhook dropped after max attempts', {
            event: item.envelope.event,
            attempts: item.attempts,
            error: e.message || String(e),
          });
        } else {
          item.nextAt = Date.now() + backoffMs(item.attempts);
          logWarn('webhook retry scheduled', {
            event: item.envelope.event,
            attempts: item.attempts,
            next_in_ms: item.nextAt - Date.now(),
          });
        }
        persist();
      }
    }
    schedule();
  }

  function schedule() {
    if (stopped || timer) return;
    if (!queue.length) return;
    const next = Math.min(...queue.map((q) => q.nextAt));
    const delay = Math.max(50, next - Date.now());
    timer = setTimeout(async () => {
      timer = null;
      try {
        await drain();
      } catch (e) {
        logError('webhook drain error', { error: e.message || String(e) });
        schedule();
      }
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function start() {
    loadPersisted();
    schedule();
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    persist();
  }

  /** Test helper: expose queue + deliverOnce without network when overridden. */
  return {
    start,
    stop,
    push,
    enqueue,
    get deliverOnce() {
      return api.deliverOnce.bind(api);
    },
    set deliverOnce(fn) {
      api.deliverOnce = fn;
    },
    getQueue: () => [...queue],
    /** @internal for unit tests */
    _setQueue: (q) => {
      queue = q;
    },
    _drain: drain,
    _backoffMs: backoffMs,
  };
}
