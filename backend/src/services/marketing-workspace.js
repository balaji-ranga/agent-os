import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import {
  createTable,
  ensureTableColumns,
  findTableByName,
  insertRow,
  listRows,
  updateRow,
} from './master-data.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import { getInternalToken } from '../middleware/internal-auth.js';

const TABLES = Object.freeze({
  campaigns: {
    name: 'marketing_campaigns',
    description: 'Marketing campaign plans linked to company objectives and CRM audiences.',
    key: 'campaign_id',
    columns: ['campaign_id', 'name', 'objective_id', 'status', 'start_date', 'end_date', 'channels_json', 'audience_crm_filter', 'crm_reference', 'budget_total', 'budget_daily', 'currency', 'goal', 'owner_agent', 'notes', 'created_at', 'updated_at'],
  },
  assets: {
    name: 'marketing_assets',
    description: 'Reusable channel assets and templates. Secrets and provider credentials are never stored here.',
    key: 'asset_id',
    columns: ['asset_id', 'campaign_id', 'name', 'channel', 'asset_type', 'subject', 'content', 'variables_json', 'version', 'approval_status', 'effective_from', 'effective_to', 'created_at', 'updated_at'],
  },
  channels: {
    name: 'marketing_channels',
    description: 'Non-secret marketing channel configuration and connector references.',
    key: 'channel',
    columns: ['channel', 'enabled', 'execution_mode', 'connector_type', 'connector_id', 'account_reference', 'sender_reference', 'config_json', 'readiness_status', 'last_verified_at', 'updated_at'],
  },
  metrics: {
    name: 'marketing_metrics',
    description: 'Campaign performance observations imported from channel providers and action receipts.',
    key: 'metric_id',
    columns: ['metric_id', 'campaign_id', 'channel', 'metric_name', 'value', 'unit', 'period_start', 'period_end', 'source', 'receipt_id', 'captured_at'],
  },
  engagements: {
    name: 'marketing_engagement_events',
    description: 'Retention-managed engagement evidence with hashed audience references and follow-up status.',
    key: 'event_id',
    columns: ['event_id', 'campaign_id', 'asset_id', 'channel', 'event_type', 'audience_hash', 'provider_reference', 'value', 'metadata_json', 'source', 'observed_at', 'followup_status', 'followup_note', 'followup_at'],
  },
  watches: {
    name: 'marketing_channel_watches',
    description: 'Read-only provider/browser checks that correlate live channel objects with stored campaign assets.',
    key: 'watch_id',
    columns: ['watch_id', 'campaign_id', 'asset_id', 'channel', 'target_reference', 'recipe_name', 'cadence_minutes', 'enabled', 'next_check_at', 'last_checked_at', 'last_snapshot_json', 'last_insight', 'updated_at'],
  },
  strategies: {
    name: 'marketing_channel_strategies',
    description: 'Configurable channel evidence, scoring, attribution and follow-up strategy.',
    key: 'channel',
    columns: ['channel', 'tracked_signals_json', 'score_rules_json', 'attribution_window_days', 'followup_rules_json', 'crm_stage', 'consent_required', 'updated_at'],
  },
  leads: {
    name: 'marketing_lead_profiles',
    description: 'Cross-campaign interest profiles linked to CRM by reference, without storing raw channel credentials.',
    key: 'lead_id',
    columns: ['lead_id', 'crm_person_reference', 'crm_lead_reference', 'identity_hash', 'display_label', 'opportunity_key', 'opportunity_summary', 'campaign_ids_json', 'channels_json', 'opportunity_interests_json', 'interests_json', 'engagement_event_ids_json', 'score', 'status', 'consent_json', 'eligible_for_followup', 'last_engagement_at', 'recommended_followup', 'owner_agent', 'created_at', 'updated_at'],
  },
});

const DEFAULT_CHANNEL_STRATEGIES = Object.freeze({
  email: { signals: ['delivered', 'open_signal', 'link_click', 'reply', 'unsubscribe', 'bounce'], scores: { delivered: 1, open_signal: 2, link_click: 5, reply: 10, unsubscribe: -100, bounce: -20 }, window: 30, followup: { qualified_score: 8, preferred_action: 'personal_email', suppress_on: ['unsubscribe', 'bounce'] } },
  whatsapp: { signals: ['delivered', 'read', 'link_click', 'reply', 'opt_out'], scores: { delivered: 1, read: 2, link_click: 5, reply: 10, opt_out: -100 }, window: 30, followup: { qualified_score: 8, preferred_action: 'whatsapp_reply', suppress_on: ['opt_out'] } },
  facebook: { signals: ['published', 'reaction', 'comment', 'share', 'link_click', 'message', 'lead_form'], scores: { reaction: 2, comment: 5, share: 6, link_click: 5, message: 10, lead_form: 15 }, window: 30, followup: { qualified_score: 10, preferred_action: 'crm_followup', suppress_on: [] } },
  google_ads: { signals: ['impression', 'click', 'conversion', 'lead_form', 'spend'], scores: { impression: 0, click: 3, conversion: 12, lead_form: 15 }, window: 30, followup: { qualified_score: 10, preferred_action: 'crm_followup', suppress_on: [] } },
  linkedin: { signals: ['published', 'reaction', 'comment', 'share', 'link_click', 'message', 'lead_form'], scores: { reaction: 2, comment: 5, share: 6, link_click: 5, message: 10, lead_form: 15 }, window: 45, followup: { qualified_score: 10, preferred_action: 'crm_followup', suppress_on: [] } },
  instagram: { signals: ['published', 'reaction', 'comment', 'share', 'link_click', 'message', 'lead_form'], scores: { reaction: 2, comment: 5, share: 6, link_click: 5, message: 10, lead_form: 15 }, window: 30, followup: { qualified_score: 10, preferred_action: 'crm_followup', suppress_on: [] } },
  telemarketing: { signals: ['attempted', 'connected', 'interested', 'callback_requested', 'qualified', 'do_not_call'], scores: { attempted: 0, connected: 2, interested: 8, callback_requested: 10, qualified: 15, do_not_call: -100 }, window: 60, followup: { qualified_score: 8, preferred_action: 'scheduled_callback', suppress_on: ['do_not_call'] } },
});

const SECRET_KEY = /(secret|password|passwd|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)/i;

function fail(message, status = 400, code = 'MARKETING_VALIDATION_ERROR') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function text(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function jsonText(value, max = 8000) {
  if (value == null || value === '') return '';
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { fail('Configuration must be valid JSON'); }
  }
  const out = JSON.stringify(parsed);
  if (out.length > max) fail(`JSON value exceeds ${max} characters`);
  return out;
}

function assertNoSecrets(value, path = 'config') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) fail(`Do not store credentials in Marketing (${path}.${key}); use Connectors instead`, 400, 'MARKETING_SECRET_REJECTED');
    if (child && typeof child === 'object') assertNoSecrets(child, `${path}.${key}`);
  }
}

function now() { return new Date().toISOString(); }

function ensureTable(ownerUserId, spec) {
  let table = findTableByName(ownerUserId, spec.name);
  if (!table) table = createTable(ownerUserId, spec);
  else table = ensureTableColumns(ownerUserId, table.id, spec.columns).table;
  return table;
}

export function ensureMarketingWorkspace(ownerUserId) {
  const tables = {};
  for (const [kind, spec] of Object.entries(TABLES)) tables[kind] = ensureTable(ownerUserId, spec);
  const configured = new Set(allRows(ownerUserId, tables.strategies).map((row) => row.channel));
  for (const [channel, strategy] of Object.entries(DEFAULT_CHANNEL_STRATEGIES)) {
    if (configured.has(channel)) continue;
    insertRow(ownerUserId, tables.strategies.id, {
      channel, tracked_signals_json: JSON.stringify(strategy.signals), score_rules_json: JSON.stringify(strategy.scores), attribution_window_days: String(strategy.window),
      followup_rules_json: JSON.stringify(strategy.followup), crm_stage: 'NEW', consent_required: 'true', updated_at: now(),
    });
  }
  return tables;
}

function allRows(ownerUserId, table) {
  const rows = [];
  let offset = 0;
  do {
    const page = listRows(ownerUserId, table.id, { limit: 50, offset });
    rows.push(...page.rows);
    offset += page.rows.length;
    if (!page.rows.length || rows.length >= page.total) break;
  } while (true);
  return rows.map((row) => ({ row_id: row.id, ...row.data, created_at: row.data.created_at || row.created_at }));
}

function analytics(records) {
  const totals = {};
  const byChannel = {};
  for (const metric of records.metrics) {
    const value = Number(metric.value);
    if (!Number.isFinite(value)) continue;
    totals[metric.metric_name] = (totals[metric.metric_name] || 0) + value;
    const channel = metric.channel || 'unassigned';
    byChannel[channel] ||= {};
    byChannel[channel][metric.metric_name] = (byChannel[channel][metric.metric_name] || 0) + value;
  }
  return {
    campaign_count: records.campaigns.length,
    active_campaign_count: records.campaigns.filter((x) => x.status === 'active').length,
    asset_count: records.assets.length,
    enabled_channel_count: records.channels.filter((x) => x.enabled === 'true').length,
    metric_count: records.metrics.length,
    engagement_count: records.engagements.length,
    pending_followup_count: records.engagements.filter((x) => x.followup_status === 'pending').length,
    enabled_watch_count: records.watches.filter((x) => x.enabled === 'true').length,
    qualified_lead_count: records.leads.filter((x) => ['qualified', 'crm_synced'].includes(x.status)).length,
    followup_lead_count: records.leads.filter((x) => x.eligible_for_followup === 'true' && x.status !== 'closed').length,
    totals,
    by_channel: byChannel,
  };
}

export function getMarketingWorkspace(ownerUserId) {
  const tables = ensureMarketingWorkspace(ownerUserId);
  const records = Object.fromEntries(Object.entries(tables).map(([kind, table]) => [kind, allRows(ownerUserId, table)]));
  return {
    storage: { type: 'knowledge_tables', tables: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.name])) },
    records,
    analytics: analytics(records),
  };
}

/**
 * Validate the internal campaign state before the agent invokes any external
 * channel capability. This is deliberately side-effect free: Action Control
 * remains authoritative for sends, publishing, calls and advertising spend.
 */
export function prepareMarketingCampaignRun(ownerUserId, input = {}) {
  const campaignId = text(input.campaign_id, 100);
  if (!campaignId) fail('campaign_id is required');
  const workspace = getMarketingWorkspace(ownerUserId);
  const campaign = workspace.records.campaigns.find((row) => row.campaign_id === campaignId);
  if (!campaign) fail('Campaign not found', 404);
  const requestedChannels = parseJsonArray(campaign.channels_json);
  const blockers = [];
  if (!campaign.objective_id && !campaign.goal) blockers.push('Add an Objective ID or measurable outcome goal.');
  if (!requestedChannels.length) blockers.push('Select at least one campaign channel.');
  if (!['active', 'draft'].includes(campaign.status)) blockers.push(`Campaign status '${campaign.status}' cannot be prepared for execution.`);

  const totalBudget = Number(campaign.budget_total || 0);
  const dailyBudget = Number(campaign.budget_daily || 0);
  if (totalBudget < 0 || dailyBudget < 0) blockers.push('Campaign budgets cannot be negative.');
  if (totalBudget > 0 && dailyBudget > totalBudget) blockers.push('Daily budget cannot exceed total campaign budget.');
  if (requestedChannels.includes('google_ads') && totalBudget <= 0) blockers.push('Google Ads requires a positive total campaign budget.');

  const actions = requestedChannels.map((channel) => {
    const setup = workspace.records.channels.find((row) => row.channel === channel);
    const assets = workspace.records.assets.filter(
      (row) => row.channel === channel && (!row.campaign_id || row.campaign_id === campaignId)
    );
    const approvedAssets = assets.filter((row) => row.approval_status === 'approved');
    if (!setup) blockers.push(`${channel}: channel setup is missing.`);
    else {
      if (setup.enabled !== 'true') blockers.push(`${channel}: channel is disabled.`);
      if (setup.readiness_status !== 'ready') blockers.push(`${channel}: readiness is '${setup.readiness_status || 'not_configured'}'.`);
    }
    if (!approvedAssets.length) blockers.push(`${channel}: no approved campaign or reusable asset is available.`);
    return {
      channel,
      execution_mode: setup?.execution_mode || 'draft_only',
      connector_type: setup?.connector_type || '',
      connector_id: setup?.connector_id || '',
      account_reference: setup?.account_reference || '',
      sender_reference: setup?.sender_reference || '',
      approved_assets: approvedAssets.map((asset) => ({
        asset_id: asset.asset_id,
        name: asset.name,
        asset_type: asset.asset_type,
        subject: asset.subject,
        version: asset.version,
      })),
    };
  });

  return {
    campaign,
    ready: blockers.length === 0,
    blockers: unique(blockers),
    actions,
    execution_contract: {
      external_effects_require_action_control: true,
      internal_configuration_only: true,
      evidence_required: ['provider/action receipt', 'recorded marketing metric or engagement evidence'],
    },
  };
}

/**
 * Agent-oriented equivalent of the Marketing UI forms. One owner-scoped call
 * can configure a campaign and its supporting assets/channels/watches/
 * strategies from a CEO intent or Objective. It never performs an external
 * send, publish, phone call or advertising action.
 */
export function configureMarketingCampaign(ownerUserId, input = {}) {
  const campaignInput = input.campaign && typeof input.campaign === 'object'
    ? { ...input.campaign }
    : { ...input };
  delete campaignInput.campaign;
  delete campaignInput.assets;
  delete campaignInput.channels;
  delete campaignInput.watches;
  delete campaignInput.strategies;
  delete campaignInput.activate;
  const selectedChannels = campaignInput.channels_json ?? input.campaign?.channels ?? input.channel_mix;
  if (selectedChannels != null) campaignInput.channels = selectedChannels;
  if (!campaignInput.objective_id && input.objective_id) campaignInput.objective_id = input.objective_id;
  if (!campaignInput.goal && input.goal) campaignInput.goal = input.goal;
  if (!campaignInput.owner_agent) campaignInput.owner_agent = text(input.owner_agent, 120) || 'marketing-specialist';
  campaignInput.status = input.activate === true ? 'draft' : (campaignInput.status || 'draft');

  const campaign = upsertMarketingRecord(ownerUserId, 'campaigns', campaignInput).record;
  const campaignId = campaign.campaign_id;
  const saveMany = (kind, values, defaults = {}) => (Array.isArray(values) ? values.slice(0, 100) : [])
    .map((value) => upsertMarketingRecord(ownerUserId, kind, { ...defaults, ...(value || {}) }).record);
  const assets = saveMany('assets', input.assets, { campaign_id: campaignId });
  const channels = saveMany('channels', input.channels);
  const watches = saveMany('watches', input.watches, { campaign_id: campaignId });
  const strategies = saveMany('strategies', input.strategies);

  let readiness = prepareMarketingCampaignRun(ownerUserId, { campaign_id: campaignId });
  let finalCampaign = campaign;
  if (input.activate === true) {
    if (!readiness.ready) {
      const error = new Error(`Campaign saved as draft; activation blocked: ${readiness.blockers.join(' ')}`);
      error.status = 409;
      error.code = 'MARKETING_CAMPAIGN_NOT_READY';
      error.campaign_id = campaignId;
      error.readiness = readiness;
      throw error;
    }
    finalCampaign = upsertMarketingRecord(ownerUserId, 'campaigns', { ...campaign, status: 'active' }).record;
    readiness = prepareMarketingCampaignRun(ownerUserId, { campaign_id: campaignId });
  }
  return { campaign: finalCampaign, assets, channels, watches, strategies, readiness };
}

function stableMetricId(data) {
  const raw = [data.campaign_id, data.channel, data.metric_name, data.period_start, data.period_end, data.source, data.receipt_id].map((v) => text(v, 200)).join('|');
  return `metric-${createHash('sha256').update(raw || randomUUID()).digest('hex').slice(0, 20)}`;
}

function normalize(kind, input = {}) {
  const created = now();
  if (kind === 'campaigns') {
    if (!text(input.name, 160)) fail('Campaign name is required');
    return {
      campaign_id: text(input.campaign_id, 100) || `campaign-${randomUUID()}`,
      name: text(input.name, 160), objective_id: text(input.objective_id, 120), status: text(input.status, 40) || 'draft',
      start_date: text(input.start_date, 40), end_date: text(input.end_date, 40), channels_json: jsonText(input.channels_json ?? input.channels ?? []),
      audience_crm_filter: text(input.audience_crm_filter, 2000), crm_reference: text(input.crm_reference, 500), budget_total: text(input.budget_total, 60),
      budget_daily: text(input.budget_daily, 60), currency: text(input.currency, 12) || 'USD', goal: text(input.goal, 2000), owner_agent: text(input.owner_agent, 120),
      notes: text(input.notes, 4000), created_at: text(input.created_at, 40) || created, updated_at: created,
    };
  }
  if (kind === 'assets') {
    if (!text(input.name, 160) || !text(input.channel, 60)) fail('Asset name and channel are required');
    return {
      asset_id: text(input.asset_id, 100) || `asset-${randomUUID()}`, campaign_id: text(input.campaign_id, 100), name: text(input.name, 160), channel: text(input.channel, 60),
      asset_type: text(input.asset_type, 60) || 'template', subject: text(input.subject, 500), content: text(input.content, 20000), variables_json: jsonText(input.variables_json ?? input.variables ?? {}),
      version: text(input.version, 30) || '1', approval_status: text(input.approval_status, 40) || 'draft', effective_from: text(input.effective_from, 40), effective_to: text(input.effective_to, 40),
      created_at: text(input.created_at, 40) || created, updated_at: created,
    };
  }
  if (kind === 'channels') {
    if (!text(input.channel, 60)) fail('Channel is required');
    let config = input.config_json ?? input.config ?? {};
    if (typeof config === 'string') { try { config = JSON.parse(config || '{}'); } catch { fail('Configuration must be valid JSON'); } }
    assertNoSecrets(config);
    return {
      channel: text(input.channel, 60).toLowerCase(), enabled: String(input.enabled === true || String(input.enabled).toLowerCase() === 'true'), execution_mode: text(input.execution_mode, 50) || 'draft_only',
      connector_type: text(input.connector_type, 100), connector_id: text(input.connector_id, 200), account_reference: text(input.account_reference, 300), sender_reference: text(input.sender_reference, 300),
      config_json: jsonText(config), readiness_status: text(input.readiness_status, 50) || 'not_configured', last_verified_at: text(input.last_verified_at, 40), updated_at: created,
    };
  }
  if (kind === 'metrics') {
    if (!text(input.metric_name, 100)) fail('Metric name is required');
    if (!Number.isFinite(Number(input.value))) fail('Metric value must be numeric');
    const row = {
      metric_id: text(input.metric_id, 100), campaign_id: text(input.campaign_id, 100), channel: text(input.channel, 60), metric_name: text(input.metric_name, 100),
      value: String(Number(input.value)), unit: text(input.unit, 40), period_start: text(input.period_start, 40), period_end: text(input.period_end, 40), source: text(input.source, 100) || 'manual',
      receipt_id: text(input.receipt_id, 160), captured_at: text(input.captured_at, 40) || created,
    };
    row.metric_id = row.metric_id || stableMetricId(row);
    return row;
  }
  if (kind === 'engagements') {
    if (!text(input.event_type, 80) || !text(input.channel, 60)) fail('Engagement channel and event type are required');
    return {
      event_id: text(input.event_id, 140) || `engagement-${randomUUID()}`, campaign_id: text(input.campaign_id, 100), asset_id: text(input.asset_id, 100), channel: text(input.channel, 60).toLowerCase(),
      event_type: text(input.event_type, 80), audience_hash: text(input.audience_hash, 128), provider_reference: text(input.provider_reference, 300), value: text(input.value, 80),
      metadata_json: jsonText(input.metadata_json ?? input.metadata ?? {}), source: text(input.source, 80) || 'manual', observed_at: text(input.observed_at, 40) || created,
      followup_status: text(input.followup_status, 40) || 'pending', followup_note: text(input.followup_note, 2000), followup_at: text(input.followup_at, 40),
    };
  }
  if (kind === 'watches') {
    if (!text(input.channel, 60) || !text(input.target_reference, 1000)) fail('Watch channel and target reference are required');
    const cadence = Math.min(Math.max(Number(input.cadence_minutes) || 60, 15), 10080);
    return {
      watch_id: text(input.watch_id, 120) || `watch-${randomUUID()}`, campaign_id: text(input.campaign_id, 100), asset_id: text(input.asset_id, 100), channel: text(input.channel, 60).toLowerCase(),
      target_reference: text(input.target_reference, 1000), recipe_name: text(input.recipe_name, 240), cadence_minutes: String(cadence),
      enabled: String(input.enabled === true || String(input.enabled).toLowerCase() === 'true'), next_check_at: text(input.next_check_at, 40) || created,
      last_checked_at: text(input.last_checked_at, 40), last_snapshot_json: jsonText(input.last_snapshot_json ?? input.last_snapshot ?? {}), last_insight: text(input.last_insight, 4000), updated_at: created,
    };
  }
  if (kind === 'strategies') {
    if (!text(input.channel, 60)) fail('Strategy channel is required');
    return {
      channel: text(input.channel, 60).toLowerCase(), tracked_signals_json: jsonText(input.tracked_signals_json ?? input.tracked_signals ?? []),
      score_rules_json: jsonText(input.score_rules_json ?? input.score_rules ?? {}), attribution_window_days: String(Math.min(Math.max(Number(input.attribution_window_days) || 30, 1), 365)),
      followup_rules_json: jsonText(input.followup_rules_json ?? input.followup_rules ?? {}), crm_stage: text(input.crm_stage, 40) || 'NEW',
      consent_required: String(input.consent_required !== false && String(input.consent_required).toLowerCase() !== 'false'), updated_at: created,
    };
  }
  if (kind === 'leads') {
    if (!text(input.identity_hash, 128) && !text(input.crm_person_reference, 200) && !text(input.crm_lead_reference, 200)) fail('A privacy-safe identity hash or CRM reference is required');
    return {
      lead_id: text(input.lead_id, 120) || `marketing-lead-${randomUUID()}`, crm_person_reference: text(input.crm_person_reference, 200), crm_lead_reference: text(input.crm_lead_reference, 200),
      identity_hash: text(input.identity_hash, 128), display_label: text(input.display_label, 200), opportunity_key: text(input.opportunity_key, 200) || 'general', opportunity_summary: text(input.opportunity_summary, 1000), campaign_ids_json: jsonText(input.campaign_ids_json ?? input.campaign_ids ?? []),
      channels_json: jsonText(input.channels_json ?? input.channels ?? []), opportunity_interests_json: jsonText(input.opportunity_interests_json ?? input.opportunity_interests ?? []), interests_json: jsonText(input.interests_json ?? input.interests ?? []), engagement_event_ids_json: jsonText(input.engagement_event_ids_json ?? input.engagement_event_ids ?? []),
      score: String(Number(input.score) || 0), status: text(input.status, 40) || 'identified', consent_json: jsonText(input.consent_json ?? input.consent ?? {}),
      eligible_for_followup: String(input.eligible_for_followup === true || String(input.eligible_for_followup).toLowerCase() === 'true'), last_engagement_at: text(input.last_engagement_at, 40),
      recommended_followup: text(input.recommended_followup, 2000), owner_agent: text(input.owner_agent, 120), created_at: text(input.created_at, 40) || created, updated_at: created,
    };
  }
  fail('Unsupported marketing record type');
}

export function upsertMarketingRecord(ownerUserId, kind, input = {}) {
  const spec = TABLES[kind];
  if (!spec) fail('Unsupported marketing record type');
  const tables = ensureMarketingWorkspace(ownerUserId);
  const data = normalize(kind, input);
  const existing = allRows(ownerUserId, tables[kind]).find((row) => String(row[spec.key]) === String(data[spec.key]));
  const result = existing
    ? updateRow(ownerUserId, tables[kind].id, existing.row_id, data)
    : insertRow(ownerUserId, tables[kind].id, data);
  return { kind, created: !existing, record: { row_id: result.row.id, ...result.row.data } };
}

export const MARKETING_RECORD_TYPES = Object.freeze(Object.keys(TABLES));

function trackingSecret() {
  const secret = getInternalToken();
  if (!secret) fail('Marketing tracking is unavailable until the platform internal secret is configured', 503, 'MARKETING_TRACKING_NOT_CONFIGURED');
  return secret;
}

function signTrackingPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', trackingSecret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyTrackingToken(token) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) fail('Invalid tracking token', 400, 'MARKETING_TRACKING_INVALID');
  const expected = createHmac('sha256', trackingSecret()).update(body).digest('base64url');
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) fail('Invalid tracking token', 400, 'MARKETING_TRACKING_INVALID');
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { fail('Invalid tracking token', 400, 'MARKETING_TRACKING_INVALID'); }
  if (!payload?.owner || !payload?.jti || Number(payload.exp) < Date.now()) fail('Expired tracking token', 400, 'MARKETING_TRACKING_EXPIRED');
  return payload;
}

export function createMarketingOpenPixel(ownerUserId, input = {}) {
  const campaignId = text(input.campaign_id, 100);
  const assetId = text(input.asset_id, 100);
  if (!campaignId || !assetId) fail('campaign_id and asset_id are required');
  const workspace = getMarketingWorkspace(ownerUserId);
  if (!workspace.records.campaigns.some((row) => row.campaign_id === campaignId)) fail('Campaign not found', 404);
  if (!workspace.records.assets.some((row) => row.asset_id === assetId)) fail('Asset not found', 404);
  const audience = text(input.audience_reference, 1000);
  const audienceHash = audience ? createHash('sha256').update(`${ownerUserId}:${audience}`).digest('hex') : '';
  const days = Math.min(Math.max(Number(input.expires_days) || 90, 1), 365);
  const token = signTrackingPayload({ owner: String(ownerUserId), campaign_id: campaignId, asset_id: assetId, audience_hash: audienceHash, jti: randomUUID(), exp: Date.now() + days * 86400000 });
  const pixelUrl = `${getPublicBaseUrl()}/api/public/marketing/open.gif?t=${encodeURIComponent(token)}`;
  return { pixel_url: pixelUrl, html: `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" />`, expires_at: new Date(Date.now() + days * 86400000).toISOString(), reliability_note: 'Image retrieval indicates an open signal; mail proxies or blocked images can create false positives or negatives.' };
}

export function consumeMarketingOpenPixel(token, { userAgent = '' } = {}) {
  const payload = verifyTrackingToken(token);
  return upsertMarketingRecord(payload.owner, 'engagements', {
    event_id: `email-open-${payload.jti}`, campaign_id: payload.campaign_id, asset_id: payload.asset_id, channel: 'email', event_type: 'open_signal', audience_hash: payload.audience_hash,
    metadata: { user_agent_hash: userAgent ? createHash('sha256').update(String(userAgent)).digest('hex') : '', reliability: 'pixel_signal' }, source: 'tracking_pixel', followup_status: 'pending',
  });
}

export function listDueMarketingWatches(ownerUserId, { at = now() } = {}) {
  const workspace = getMarketingWorkspace(ownerUserId);
  const cutoff = Date.parse(at);
  return workspace.records.watches.filter((row) => row.enabled === 'true' && (!row.next_check_at || Date.parse(row.next_check_at) <= cutoff));
}

export function recordMarketingWatchResult(ownerUserId, input = {}) {
  const watchId = text(input.watch_id, 120);
  if (!watchId) fail('watch_id is required');
  const workspace = getMarketingWorkspace(ownerUserId);
  const watch = workspace.records.watches.find((row) => row.watch_id === watchId);
  if (!watch) fail('Marketing watch not found', 404);
  const checkedAt = text(input.observed_at, 40) || now();
  const next = new Date(Date.parse(checkedAt) + Number(watch.cadence_minutes || 60) * 60000).toISOString();
  const updated = upsertMarketingRecord(ownerUserId, 'watches', { ...watch, last_checked_at: checkedAt, next_check_at: next, last_snapshot_json: input.snapshot || {}, last_insight: input.insight || '', updated_at: checkedAt });
  const events = Array.isArray(input.events) ? input.events.slice(0, 100).map((event) => upsertMarketingRecord(ownerUserId, 'engagements', {
    ...event, event_id: event.event_id || `watch-${watchId}-${createHash('sha256').update(JSON.stringify(event)).digest('hex').slice(0, 20)}`, campaign_id: watch.campaign_id, asset_id: watch.asset_id,
    channel: watch.channel, provider_reference: watch.target_reference, source: 'browser_watch', observed_at: event.observed_at || checkedAt,
  }).record) : [];
  return { watch: updated.record, events };
}

export function updateMarketingFollowup(ownerUserId, input = {}) {
  const eventId = text(input.event_id, 140);
  if (!eventId) fail('event_id is required');
  const workspace = getMarketingWorkspace(ownerUserId);
  const event = workspace.records.engagements.find((row) => row.event_id === eventId);
  if (!event) fail('Engagement event not found', 404);
  return upsertMarketingRecord(ownerUserId, 'engagements', { ...event, followup_status: text(input.followup_status, 40) || 'completed', followup_note: text(input.followup_note, 2000), followup_at: now() });
}

function unique(values) { return [...new Set(values.map((v) => text(v, 300)).filter(Boolean))]; }

export function prepareMarketingLead(ownerUserId, input = {}) {
  const workspace = getMarketingWorkspace(ownerUserId);
  const identityReference = text(input.identity_reference, 1000);
  const identityHash = text(input.identity_hash, 128) || (identityReference ? createHash('sha256').update(`${ownerUserId}:${identityReference}`).digest('hex') : '');
  const crmPerson = text(input.crm_person_reference, 200);
  if (!identityHash && !crmPerson) fail('identity_reference or crm_person_reference is required');
  const opportunityKey = text(input.opportunity_key, 200) || text(input.campaign_ids?.[0], 100) || 'general';
  const samePerson = workspace.records.leads.filter((row) => (identityHash && row.identity_hash === identityHash) || (crmPerson && row.crm_person_reference === crmPerson));
  const existing = samePerson.find((row) => (row.opportunity_key || 'general') === opportunityKey);
  const eventIds = unique([...(parseJsonArray(existing?.engagement_event_ids_json)), ...(Array.isArray(input.engagement_event_ids) ? input.engagement_event_ids : [])]);
  const events = workspace.records.engagements.filter((event) => eventIds.includes(event.event_id) || (identityHash && event.audience_hash === identityHash));
  const strategyByChannel = new Map(workspace.records.strategies.map((row) => [row.channel, row]));
  let score = 0; let suppressed = false;
  for (const event of events) {
    const strategy = strategyByChannel.get(event.channel);
    const rules = parseJsonObject(strategy?.score_rules_json);
    score += Number(rules[event.event_type] || 0);
    const followup = parseJsonObject(strategy?.followup_rules_json);
    if ((followup.suppress_on || []).includes(event.event_type)) suppressed = true;
  }
  const consent = { ...parseJsonObject(existing?.consent_json), ...parseJsonObject(input.consent) };
  if (Object.values(consent).some((value) => ['opted_out', 'unsubscribed', 'do_not_call', 'denied'].includes(String(value).toLowerCase()))) suppressed = true;
  const channels = unique([...(parseJsonArray(existing?.channels_json)), ...events.map((event) => event.channel), ...(Array.isArray(input.channels) ? input.channels : [])]);
  const campaigns = unique([...(parseJsonArray(existing?.campaign_ids_json)), ...events.map((event) => event.campaign_id), ...(Array.isArray(input.campaign_ids) ? input.campaign_ids : [])]);
  const opportunityInterests = unique([...(parseJsonArray(existing?.opportunity_interests_json)), ...(Array.isArray(input.interests) ? input.interests : [])]);
  const historicalInterests = unique(samePerson.flatMap((row) => parseJsonArray(row.interests_json || row.opportunity_interests_json)));
  const interests = unique([...historicalInterests, ...opportunityInterests]);
  const threshold = Math.min(...channels.map((channel) => Number(parseJsonObject(strategyByChannel.get(channel)?.followup_rules_json).qualified_score || 10)), 10);
  const eligible = !suppressed && score >= threshold;
  const saved = upsertMarketingRecord(ownerUserId, 'leads', {
    ...(existing || {}), lead_id: existing?.lead_id, crm_person_reference: crmPerson || existing?.crm_person_reference, crm_lead_reference: text(input.crm_lead_reference, 200) || existing?.crm_lead_reference,
    identity_hash: identityHash || existing?.identity_hash, display_label: input.display_label || existing?.display_label, opportunity_key: opportunityKey, opportunity_summary: input.opportunity_summary || existing?.opportunity_summary,
    campaign_ids: campaigns, channels, opportunity_interests: opportunityInterests, interests,
    engagement_event_ids: unique([...eventIds, ...events.map((event) => event.event_id)]), score, status: existing?.crm_lead_reference ? 'crm_synced' : eligible ? 'qualified' : suppressed ? 'suppressed' : 'nurture',
    consent, eligible_for_followup: eligible, last_engagement_at: events.map((event) => event.observed_at).sort().at(-1) || existing?.last_engagement_at,
    recommended_followup: suppressed ? 'Do not contact; respect the recorded suppression.' : input.recommended_followup || (eligible ? `Follow up using ${channels.at(-1) || 'the consented channel'} and reference interests: ${interests.join(', ') || 'recent campaign engagement'}.` : 'Continue consented nurture until qualification threshold is met.'),
    owner_agent: input.owner_agent || existing?.owner_agent || 'marketing-specialist', created_at: existing?.created_at,
  });
  return {
    ...saved,
    correlation: {
      person_match: samePerson.length ? 'existing_person' : 'new_person',
      opportunity_match: existing ? 'existing_opportunity' : samePerson.length ? 'new_opportunity_for_existing_person' : 'new_opportunity',
      prior_opportunities: samePerson.filter((row) => row.lead_id !== existing?.lead_id).map((row) => ({ lead_id: row.lead_id, opportunity_key: row.opportunity_key, opportunity_summary: row.opportunity_summary, interests: parseJsonArray(row.opportunity_interests_json || row.interests_json), status: row.status, crm_lead_reference: row.crm_lead_reference })),
      historical_interests: historicalInterests,
    },
  };
}

function parseJsonArray(value) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function parseJsonObject(value) { if (value && typeof value === 'object') return value; try { const parsed = JSON.parse(value || '{}'); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; } }
