import express from 'express';
import { createHash } from 'crypto';
import { createAdapter } from './adapters.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
const port = Number(process.env.PORT || 8090);
const backend = String(process.env.BACKEND_INTERNAL_URL || 'http://backend:3001/api/internal/messaging').replace(/\/$/, '');
const token = String(process.env.MESSAGING_SERVICE_TOKEN || '');
const active = new Map();

function authorized(req, res, next) {
  if (!token || req.headers.authorization !== `Bearer ${token}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}
async function backendCall(path, init = {}) {
  const response = await fetch(`${backend}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Backend ${response.status}`);
  return data;
}
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function reconcile() {
  if (!token) return;
  const { subscriptions = [] } = await backendCall('/subscriptions');
  const desired = new Map(subscriptions.map((item) => [item.id, item]));
  for (const [id, current] of active) {
    if (!desired.has(id) || current.fingerprint !== fingerprint(desired.get(id))) {
      await current.close().catch(() => {}); active.delete(id);
    }
  }
  for (const subscription of subscriptions) {
    if (active.has(subscription.id)) continue;
    try {
      const adapter = await createAdapter({ protocol: subscription.protocol, endpoint: subscription.endpoint, config: subscription.connectionConfig, credentials: subscription.credentials });
      const close = await adapter.subscribe(subscription, async (envelope) => backendCall('/deliver', { method: 'POST', body: JSON.stringify({ subscriptionId: subscription.id, envelope }) }));
      active.set(subscription.id, { close, fingerprint: fingerprint(subscription) });
    } catch (error) { console.error('[messaging-listener] subscribe failed', subscription.id, error.message); }
  }
}

app.get('/health', (_req, res) => res.json({ ok: true, activeSubscriptions: active.size }));
app.post('/v1/test', authorized, async (req, res) => { try { const adapter = await createAdapter(req.body.connection); await adapter.test(); res.json({ ok: true }); } catch (error) { res.status(502).json({ ok: false, error: error.message }); } });
app.post('/v1/publish', authorized, async (req, res) => { try { const adapter = await createAdapter(req.body.connection); res.json({ ok: true, ...(await adapter.publish(req.body)) }); } catch (error) { res.status(502).json({ ok: false, error: error.message }); } });

app.listen(port, () => { console.log(`[messaging-listener] listening on ${port}`); reconcile().catch((e) => console.error('[messaging-listener] initial reconcile', e.message)); setInterval(() => reconcile().catch((e) => console.error('[messaging-listener] reconcile', e.message)), Number(process.env.MESSAGING_RECONCILE_MS || 15000)).unref(); });
