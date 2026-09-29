import { Router } from 'express';
import { createHash } from 'crypto';
import { resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { resolveToolOwnerUserId } from '../services/tool-owner-scope.js';
import { configureMarketingCampaign, createMarketingOpenPixel, getMarketingWorkspace, handoffMarketingLeadToCrm, listDueMarketingWatches, prepareMarketingCampaignRun, prepareMarketingLead, reconcileMarketingToolOutcomes, recordMarketingOutcome, recordMarketingWatchResult, updateMarketingFollowup, upsertMarketingCampaignSchedule, upsertMarketingRecord } from '../services/marketing-workspace.js';
import { announceOnAgentChannel, resolveAgentChannelTarget } from '../services/agent-channel-announce.js';
import { getDb } from '../db/schema.js';
import { parseTenantOpenClawAgentId, tenantOpenClawAgentId } from '../services/openclaw-tenant.js';

const router = Router();
const owner = (req) => resolveToolOwnerUserId(req, req.body || {}, resolveAuthenticatedCeoUserId);
const run = async (res, fn) => { try { res.json({ ok: true, ...(await fn()) }); } catch (error) { res.status(error.status || 500).json({ ok: false, error: error.message, code: error.code }); } };

function fail(message, status = 400, code = 'MARKETING_CHANNEL_SEND_INVALID') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function normalizedPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : '';
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function resolveCallerAgent(req, ownerUserId) {
  const raw = String(req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || '').trim();
  const base = parseTenantOpenClawAgentId(raw)?.baseOpenClawId || raw;
  if (!base) fail('Calling agent context is required', 403, 'MARKETING_AGENT_REQUIRED');
  const agent = getDb().prepare(`
    SELECT a.id, a.name
    FROM agents a
    JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
    WHERE a.id = ? OR a.openclaw_agent_id = ?
    LIMIT 1
  `).get(ownerUserId, base, base);
  if (!agent) fail('Calling agent is not granted to this company', 403, 'MARKETING_AGENT_NOT_GRANTED');
  return agent;
}

export function resolveMarketingTransportAgentId({ ownerUserId, explicitTransportAgentId, setup, callerAgentId } = {}) {
  const explicit = String(explicitTransportAgentId || '').trim();
  if (explicit) return explicit;

  // Marketing channel configuration may point at an owner-scoped OpenClaw
  // account such as `t-company--coo`. This lets a specialist own campaign
  // decisions while a separately bound company agent supplies the transport.
  const accountReference = String(setup?.account_reference || '').trim().toLowerCase();
  const parsed = parseTenantOpenClawAgentId(accountReference);
  if (parsed && tenantOpenClawAgentId(ownerUserId, parsed.baseOpenClawId) === accountReference) {
    return parsed.baseOpenClawId;
  }

  return String(callerAgentId || '').trim();
}

export function resolveMarketingCampaignRecipient({ workspace, campaign, channel, requestedTo, boundTarget } = {}) {
  const requested = String(requestedTo || '').trim();
  const bound = String(boundTarget || '').trim();
  if (!requested) return bound ? { ok: true, to: bound, source: 'bound_company_target', member: null } : { ok: false, reason: 'recipient_required' };

  const sameAsBound = channel === 'whatsapp'
    ? normalizedPhone(requested) && normalizedPhone(requested) === normalizedPhone(bound)
    : requested === bound;
  if (sameAsBound) return { ok: true, to: bound, source: 'bound_company_target', member: null };

  const listIds = new Set(jsonArray(campaign?.audience_list_ids_json).map((value) => String(value || '').trim()).filter(Boolean));
  const wanted = channel === 'whatsapp' ? normalizedPhone(requested) : requested;
  const member = (workspace?.records?.distributionMembers || []).find((row) => {
    if (!listIds.has(String(row.list_id || '')) || String(row.channel || '').toLowerCase() !== channel) return false;
    const destination = channel === 'whatsapp' ? normalizedPhone(row.destination) : String(row.destination || '').trim();
    return destination && destination === wanted;
  });
  if (!member) return { ok: false, reason: 'not_in_campaign_audience' };
  if (String(member.consent_status || '').toLowerCase() !== 'granted') return { ok: false, reason: 'campaign_audience_consent_missing', member };
  return { ok: true, to: String(member.destination || requested).trim(), source: 'consent_granted_campaign_audience', member };
}

function normalizeMedia(input) {
  const media = input && typeof input === 'object' ? input : null;
  if (!media) return [];
  const content = String(media.content_base64 || media.content || '').replace(/\s/g, '');
  if (!content) return [];
  const bytes = Buffer.byteLength(content, 'base64');
  if (!bytes || bytes > 1_200_000) fail('Campaign media must be between 1 byte and 1.2 MB');
  const mimeType = String(media.mime_type || media.mimeType || 'application/octet-stream').slice(0, 120);
  const kind = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('audio/') ? 'audio' : '';
  if (!kind) fail('Campaign media must be an image, video, or audio file');
  return [{
    kind,
    bytes,
    filename: String(media.filename || `campaign-${kind}`).slice(0, 180),
    mimeType,
    bufferBase64: content,
    mediaKey: String(media.media_key || media.mediaKey || 'campaign-creative').slice(0, 180),
  }];
}

router.post('/marketing-workspace-read', (req, res) => run(res, async () => { const ownerUserId = owner(req); reconcileMarketingToolOutcomes(ownerUserId); return { workspace: getMarketingWorkspace(ownerUserId) }; }));
router.post('/marketing-campaign-upsert', (req, res) => run(res, async () => upsertMarketingRecord(owner(req), 'campaigns', req.body || {})));
router.post('/marketing-audience-list-upsert', (req, res) => run(res, async () => upsertMarketingRecord(owner(req), 'distributionLists', req.body || {})));
router.post('/marketing-audience-member-upsert', (req, res) => run(res, async () => upsertMarketingRecord(owner(req), 'distributionMembers', req.body || {})));
router.post('/marketing-campaign-configure', (req, res) => run(res, async () => configureMarketingCampaign(owner(req), req.body || {})));
router.post('/marketing-campaign-run-prepare', (req, res) => run(res, async () => ({ readiness: prepareMarketingCampaignRun(owner(req), req.body || {}) })));
router.post('/marketing-campaign-schedule-upsert', (req, res) => run(res, async () => {
  const ownerUserId = owner(req);
  const caller = resolveCallerAgent(req, ownerUserId);
  return upsertMarketingCampaignSchedule(ownerUserId, req.body || {}, caller.id);
}));
router.post('/marketing-asset-upsert', (req, res) => run(res, async () => upsertMarketingRecord(owner(req), 'assets', req.body || {})));
router.post('/marketing-channel-config-upsert', (req, res) => run(res, async () => upsertMarketingRecord(owner(req), 'channels', req.body || {})));
router.post('/marketing-strategy-upsert', (req, res) => run(res, async () => upsertMarketingRecord(owner(req), 'strategies', req.body || {})));
router.post('/marketing-metric-record', (req, res) => run(res, async () => upsertMarketingRecord(owner(req), 'metrics', req.body || {})));
router.post('/marketing-campaign-outcome-record', (req, res) => run(res, async () => recordMarketingOutcome(owner(req), req.body || {})));
router.post('/marketing-tracking-pixel-create', (req, res) => run(res, async () => createMarketingOpenPixel(owner(req), req.body || {})));
router.post('/marketing-channel-send', (req, res) => run(res, async () => {
  const ownerUserId = owner(req);
  const body = req.body || {};
  const channel = String(body.channel || '').trim().toLowerCase();
  if (!['whatsapp', 'slack'].includes(channel)) fail('channel must be whatsapp or slack');
  const campaignId = String(body.campaign_id || '').trim();
  const assetId = String(body.asset_id || '').trim();
  if (!campaignId || !assetId) fail('campaign_id and asset_id are required');

  const caller = resolveCallerAgent(req, ownerUserId);
  const workspace = getMarketingWorkspace(ownerUserId);
  const campaign = workspace.records.campaigns.find((row) => row.campaign_id === campaignId);
  if (!campaign || campaign.status !== 'active') fail('Campaign must exist and be active', 409, 'MARKETING_CAMPAIGN_NOT_ACTIVE');
  const asset = workspace.records.assets.find((row) => row.asset_id === assetId && row.channel === channel && row.campaign_id === campaignId);
  if (!asset || asset.approval_status !== 'approved') fail('An approved campaign asset for this channel is required', 409, 'MARKETING_ASSET_NOT_APPROVED');
  const setup = workspace.records.channels.find((row) => row.channel === channel);
  if (!setup || setup.enabled !== 'true' || setup.readiness_status !== 'ready') fail('Marketing channel is not enabled and ready', 409, 'MARKETING_CHANNEL_NOT_READY');

  const transportAgentId = resolveMarketingTransportAgentId({
    ownerUserId,
    explicitTransportAgentId: body.transport_agent_id,
    setup,
    callerAgentId: caller.id,
  });
  const transport = getDb().prepare(`
    SELECT a.id
    FROM agents a
    JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
    WHERE a.id = ?
  `).get(ownerUserId, transportAgentId);
  if (!transport) fail('Transport agent is not granted to this company', 403, 'MARKETING_TRANSPORT_NOT_GRANTED');

  const resolved = resolveAgentChannelTarget(ownerUserId, transportAgentId, channel);
  if (!resolved.ok) fail(`Company channel is unavailable: ${resolved.reason}`, 409, 'MARKETING_CHANNEL_UNAVAILABLE');
  const requestedTo = String(body.to || body.recipient || '').trim();
  const recipient = resolveMarketingCampaignRecipient({ workspace, campaign, channel, requestedTo, boundTarget: resolved.to });
  if (!recipient.ok) fail(
    recipient.reason === 'campaign_audience_consent_missing'
      ? 'Requested campaign recipient does not have granted consent'
      : 'Requested recipient is not an authorized member of this campaign audience',
    403,
    recipient.reason === 'campaign_audience_consent_missing' ? 'MARKETING_RECIPIENT_CONSENT_REQUIRED' : 'MARKETING_RECIPIENT_MISMATCH',
  );

  const text = String(body.text || asset.content || '').trim();
  if (!text) fail('Campaign message text is required');
  const idempotencyKey = String(body.idempotency_key || `marketing:${campaignId}:${assetId}`).slice(0, 200);
  const sent = await announceOnAgentChannel({
    ownerUserId,
    agentId: transportAgentId,
    actorAgentId: caller.id,
    channel,
    text,
    idempotencyKey,
    mediaFiles: normalizeMedia(body.media),
    authorizedTo: recipient.to,
  });
  if (!sent.ok || sent.skipped) fail(sent.error || `Channel send failed: ${sent.reason || 'unknown'}`, 502, 'MARKETING_CHANNEL_SEND_FAILED');

  const audienceHash = createHash('sha256').update(`${ownerUserId}:${recipient.to}`).digest('hex');
  const sendMetadata = {
    method: sent.method,
    media_sent: sent.media_sent || 0,
    actor_agent_id: caller.id,
    transport_agent_id: transportAgentId,
    recipient_source: recipient.source,
    audience_member_id: recipient.member?.member_id || null,
  };
  const evidence = upsertMarketingRecord(ownerUserId, 'engagements', {
    event_id: `marketing-send-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`,
    campaign_id: campaignId,
    asset_id: assetId,
    channel,
    event_type: 'send_accepted',
    audience_hash: audienceHash,
    value: 1,
    metadata: sendMetadata,
    source: 'marketing_channel_send',
    followup_status: 'pending',
  });
  const outcome = recordMarketingOutcome(ownerUserId, {
    campaign_id: campaignId,
    asset_id: assetId,
    channel,
    outcome_type: 'send_accepted',
    audience_hash: audienceHash,
    audience_reference: recipient.to,
    recipient_label: body.recipient_label || recipient.member?.display_label,
    provider_reference: evidence.record.event_id,
    observed_at: evidence.record.observed_at,
    metadata: sendMetadata,
    source: 'marketing_channel_send',
  });
  return { sent, engagement: evidence.record, outcome: outcome.record };
}));
router.post('/marketing-engagement-record', (req, res) => run(res, async () => {
  const ownerUserId = owner(req);
  const input = req.body || {};
  const engagement = upsertMarketingRecord(ownerUserId, 'engagements', input);
  const outcome = input.campaign_id ? recordMarketingOutcome(ownerUserId, {
    ...input,
    outcome_id: input.outcome_id || input.event_id,
    outcome_type: input.outcome_type || input.event_type,
    provider_reference: input.provider_reference || engagement.record.event_id,
    observed_at: input.observed_at || engagement.record.observed_at,
  }) : null;
  return { ...engagement, outcome: outcome?.record || null };
}));
router.post('/marketing-followup-update', (req, res) => run(res, async () => updateMarketingFollowup(owner(req), req.body || {})));
router.post('/marketing-watch-upsert', (req, res) => run(res, async () => upsertMarketingRecord(owner(req), 'watches', req.body || {})));
router.post('/marketing-watches-due', (req, res) => run(res, async () => ({ watches: listDueMarketingWatches(owner(req), req.body || {}) })));
router.post('/marketing-watch-result-record', (req, res) => run(res, async () => recordMarketingWatchResult(owner(req), req.body || {})));
router.post('/marketing-lead-prepare', (req, res) => run(res, async () => prepareMarketingLead(owner(req), req.body || {})));
router.post('/marketing-crm-handoff', (req, res) => run(res, async () => handoffMarketingLeadToCrm(owner(req), req.body || {})));

export default router;
