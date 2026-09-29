/**
 * Public email-inbound webhook → event-triggered workflow.
 * Providers (SendGrid Inbound Parse, Mailgun, etc.) POST here; Agent OS starts the workflow.
 * Auth: same workflow webhook secret (header/query) or EMAIL_INBOUND_WEBHOOK_SECRET.
 */
import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import {
  extractMailboxEmail,
  normalizeEmailInboundPayload,
  resolveEventHookOwner,
  triggerWorkflowFromHook,
  verifyHookSecret,
} from '../services/agent-workflow-webhooks.js';
import { correlateMarketingInbound } from '../services/marketing-workspace.js';

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

    let ownerUserId = '';
    const hookCheck = verifyHookSecret(definitionId, provided);
    if (hookCheck.ok) {
      ownerUserId = hookCheck.ownerUserId;
    } else if (platformSecret && secretsMatch(provided, platformSecret)) {
      const context = resolveEventHookOwner(definitionId);
      if (context.ok) ownerUserId = context.ownerUserId;
      else {
        const status = context.error === 'Workflow not found' ? 404 : 403;
        return res.status(status).json({ error: context.error });
      }
    }

    if (!ownerUserId) {
      const status = hookCheck.error === 'Workflow not found' ? 404 : 403;
      return res.status(status).json({
        error: hookCheck.error || 'Invalid email inbound secret',
      });
    }

    const payload = normalizeEmailInboundPayload(req.body ?? {}, req.headers);
    const run = await triggerWorkflowFromHook(definitionId, payload, {
      actor: { id: 'email-inbound', name: 'Email inbound', type: 'system' },
    });
    let marketingAttribution = { matched: false, reason: 'sender_or_content_missing' };
    const sender = extractMailboxEmail(payload.from);
    const content = String(payload.text || payload.subject || payload.html.replace(/<[^>]+>/g, ' ') || '').trim();
    if (sender && content) {
      try {
        const correlation = correlateMarketingInbound(ownerUserId, {
          channel: 'email',
          sender_id: sender,
          content,
          message_id: payload.message_id,
          observed_at: payload.received_at,
        });
        marketingAttribution = {
          matched: correlation.matched === true,
          reason: correlation.reason || null,
          campaign_id: correlation.campaign?.campaign_id || null,
          outcome_type: correlation.classification?.outcome_type || null,
          intent: correlation.classification?.intent || null,
          lead_id: correlation.lead?.lead_id || null,
          idempotent: correlation.idempotent === true,
        };
      } catch (marketingError) {
        console.error('[email-inbound] marketing attribution failed:', marketingError?.message || marketingError);
        marketingAttribution = { matched: false, reason: 'marketing_attribution_error' };
      }
    }
    res.status(202).json({
      ok: true,
      event_type: 'email.received',
      run_id: run.id,
      run_number: run.run_number,
      status: run.status,
      marketing_attribution: marketingAttribution,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
