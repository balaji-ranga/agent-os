/**
 * Public email-inbound webhook → event-triggered workflow.
 * Providers (SendGrid Inbound Parse, Mailgun, etc.) POST here; Agent OS starts the workflow.
 * Auth: same workflow webhook secret (header/query) or EMAIL_INBOUND_WEBHOOK_SECRET.
 */
import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import {
  normalizeEmailInboundPayload,
  triggerWorkflowFromHook,
  verifyHookSecret,
} from '../services/agent-workflow-webhooks.js';

const router = Router();

function secretsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function resolveInboundSecret(req) {
  return (
    req.headers['x-workflow-hook-secret'] ||
    req.headers['x-webhook-secret'] ||
    req.headers['x-email-inbound-secret'] ||
    req.query.secret ||
    ''
  );
}

router.post('/:definitionId', async (req, res) => {
  try {
    const definitionId = req.params.definitionId;
    const provided = resolveInboundSecret(req);
    const platformSecret = String(process.env.EMAIL_INBOUND_WEBHOOK_SECRET || '').trim();

    let ownerOk = false;
    const hookCheck = verifyHookSecret(definitionId, provided);
    if (hookCheck.ok) {
      ownerOk = true;
    } else if (platformSecret && secretsMatch(provided, platformSecret)) {
      ownerOk = true;
    }

    if (!ownerOk) {
      const status = hookCheck.error === 'Workflow not found' ? 404 : 403;
      return res.status(status).json({
        error: hookCheck.error || 'Invalid email inbound secret',
      });
    }

    const payload = normalizeEmailInboundPayload(req.body ?? {}, req.headers);
    const run = await triggerWorkflowFromHook(definitionId, payload, {
      actor: { id: 'email-inbound', name: 'Email inbound', type: 'system' },
    });
    res.status(202).json({
      ok: true,
      event_type: 'email.received',
      run_id: run.id,
      run_number: run.run_number,
      status: run.status,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
