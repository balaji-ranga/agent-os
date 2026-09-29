import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
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
import { getDb } from '../db/schema.js';
import { createScheduledGoal, getScheduledGoal, updateScheduledGoal } from './scheduled-goals.js';

const TABLES = Object.freeze({
  campaigns: {
    name: 'marketing_campaigns',
    description: 'Marketing campaign plans linked to company objectives and CRM audiences.',
    key: 'campaign_id',
    columns: ['campaign_id', 'name', 'objective_id', 'status', 'start_date', 'end_date', 'channels_json', 'audience_list_ids_json', 'audience_crm_filter', 'audience_crm_person_refs_json', 'crm_reference', 'budget_total', 'budget_daily', 'currency', 'goal', 'strategy_brief', 'content_topics_json', 'content_cadence', 'content_per_run', 'stop_conditions_json', 'scheduled_goal_id', 'owner_agent', 'notes', 'created_at', 'updated_at'],
  },
  distributionLists: {
    name: 'marketing_distribution_lists',
    description: 'Reusable manual or imported marketing distribution lists, independent of CRM.',
    key: 'list_id',
    columns: ['list_id', 'name', 'description', 'status', 'default_channel', 'created_at', 'updated_at'],
  },
  distributionMembers: {
    name: 'marketing_distribution_list_members',
    description: 'Retention-managed campaign recipients with encrypted destinations and explicit consent evidence.',
    key: 'member_id',
    columns: ['member_id', 'list_id', 'display_label', 'channel', 'destination_encrypted', 'destination_hash', 'destination_masked', 'provider', 'provider_reference', 'crm_person_reference', 'consent_status', 'consent_source', 'consent_at', 'tags_json', 'created_at', 'updated_at'],
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
  outcomes: {
    name: 'marketing_campaign_outcomes',
    description: 'Retention-managed, cross-channel campaign outcome ledger with channel-specific evidence and privacy-safe audience attribution.',
    key: 'outcome_id',
    columns: ['outcome_id', 'campaign_id', 'asset_id', 'channel', 'outcome_type', 'audience_hash', 'recipient_label', 'destination_masked', 'provider_reference', 'value', 'unit', 'status', 'observed_at', 'metadata_json', 'source', 'created_at', 'updated_at'],
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
    columns: ['lead_id', 'crm_person_reference', 'crm_lead_reference', 'crm_opportunity_reference', 'identity_hash', 'display_label', 'opportunity_key', 'opportunity_summary', 'campaign_ids_json', 'channels_json', 'opportunity_interests_json', 'interests_json', 'engagement_event_ids_json', 'score', 'status', 'lifecycle_stage', 'consent_json', 'eligible_for_followup', 'last_engagement_at', 'followup_status', 'followup_channel', 'followup_due_at', 'recommended_followup', 'next_action', 'owner_agent', 'created_at', 'updated_at'],
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

function parseTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  return Date.parse(normalized);
}

const CONTACT_ENCRYPTION_PREFIX = 'enc:g1:';

function contactEncryptionKey(ownerUserId) {
  const kek = text(process.env.USER_API_KEYS_KEK, 10000);
  if (!kek) fail('Contact encryption is unavailable until USER_API_KEYS_KEK is configured', 503, 'MARKETING_CONTACT_ENCRYPTION_UNAVAILABLE');
  return createHash('sha256').update(`${kek}:${ownerUserId}:marketing-distribution`).digest();
}

function encryptContact(ownerUserId, value) {
  const plain = text(value, 1000);
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', contactEncryptionKey(ownerUserId), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return CONTACT_ENCRYPTION_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function decryptContact(ownerUserId, value) {
  const stored = String(value || '');
  if (!stored) return '';
  if (!stored.startsWith(CONTACT_ENCRYPTION_PREFIX)) return stored;
  const buffer = Buffer.from(stored.slice(CONTACT_ENCRYPTION_PREFIX.length), 'base64');
  if (buffer.length < 29) fail('Stored campaign contact is invalid', 500, 'MARKETING_CONTACT_DECRYPT_FAILED');
  const decipher = createDecipheriv('aes-256-gcm', contactEncryptionKey(ownerUserId), buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
}

function normalizedDestination(channel, value) {
  const raw = text(value, 1000);
  if (channel === 'email') return raw.toLowerCase();
  if (['whatsapp', 'telemarketing'].includes(channel)) return raw.replace(/\D/g, '');
  return raw;
}

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

function campaignReports(records) {
  const reportByCampaign = new Map();
  const ensureReport = (campaignId) => {
    if (!campaignId) return null;
    if (!reportByCampaign.has(campaignId)) {
      const campaign = records.campaigns.find((row) => row.campaign_id === campaignId);
      const audienceListIds = parseJsonArray(campaign?.audience_list_ids_json);
      const manualAudienceCount = new Set(records.distributionMembers.filter((row) => audienceListIds.includes(row.list_id)).map((row) => row.destination_hash || row.member_id)).size;
      reportByCampaign.set(campaignId, {
        campaign_id: campaignId,
        campaign_name: campaign?.name || campaignId,
        configured_audience_count: parseJsonArray(campaign?.audience_crm_person_refs_json).length + manualAudienceCount,
        audience_list_count: audienceListIds.length,
        emails_sent: 0,
        unique_open_signals: 0,
        open_signal_count: 0,
        open_rate_percent: null,
        recipients: [],
        channel_outcomes: {},
      });
    }
    return reportByCampaign.get(campaignId);
  };
  const recipientByCampaign = new Map();
  const recipientKey = (campaignId, audienceHash, fallback = '') => `${campaignId}|${audienceHash || fallback}`;
  const leadLabels = new Map(records.leads.filter((row) => row.identity_hash).map((row) => [row.identity_hash, row.display_label || row.crm_person_reference || '']));
  for (const campaign of records.campaigns) ensureReport(campaign.campaign_id);

  for (const outcome of records.outcomes) {
    const report = ensureReport(outcome.campaign_id);
    if (!report) continue;
    report.channel_outcomes[outcome.channel] ||= {};
    report.channel_outcomes[outcome.channel][outcome.outcome_type] = (report.channel_outcomes[outcome.channel][outcome.outcome_type] || 0) + (Number(outcome.value) || 1);
    if (outcome.channel !== 'email') continue;
    if (['send_accepted', 'sent'].includes(outcome.outcome_type)) report.emails_sent += Number(outcome.value) || 1;
    const key = recipientKey(outcome.campaign_id, outcome.audience_hash, outcome.outcome_id);
    const existing = recipientByCampaign.get(key) || {
      outcome_id: outcome.outcome_id,
      audience_hash: outcome.audience_hash,
      recipient_label: outcome.recipient_label || leadLabels.get(outcome.audience_hash) || `Recipient ${String(outcome.audience_hash || '').slice(0, 8)}`,
      destination_masked: outcome.destination_masked || '',
      delivery_status: 'unknown',
      provider_reference: outcome.provider_reference || '',
      sent_at: '', open_count: 0, first_opened_at: '', last_opened_at: '', outcomes: [],
    };
    existing.recipient_label = outcome.recipient_label || existing.recipient_label;
    existing.destination_masked = outcome.destination_masked || existing.destination_masked;
    existing.outcomes.push({ type: outcome.outcome_type, at: outcome.observed_at, status: outcome.status });
    if (['send_accepted', 'sent', 'delivered'].includes(outcome.outcome_type)) {
      existing.delivery_status = outcome.outcome_type;
      existing.sent_at = outcome.observed_at || existing.sent_at;
      existing.provider_reference = outcome.provider_reference || existing.provider_reference;
    }
    if (outcome.outcome_type === 'open_signal') {
      existing.open_count += 1;
      existing.first_opened_at = !existing.first_opened_at || outcome.observed_at < existing.first_opened_at ? outcome.observed_at : existing.first_opened_at;
      existing.last_opened_at = !existing.last_opened_at || outcome.observed_at > existing.last_opened_at ? outcome.observed_at : existing.last_opened_at;
    }
    recipientByCampaign.set(key, existing);
  }

  for (const event of records.engagements) {
    if (event.channel !== 'email' || event.event_type !== 'open_signal') continue;
    const report = ensureReport(event.campaign_id);
    if (!report) continue;
    const alreadyLedgered = records.outcomes.some((outcome) => outcome.source === event.source && outcome.provider_reference === event.event_id);
    if (alreadyLedgered) continue;
    report.open_signal_count += 1;
    const key = recipientKey(event.campaign_id, event.audience_hash, event.event_id);
    const existing = recipientByCampaign.get(key) || {
      outcome_id: '',
      audience_hash: event.audience_hash,
      recipient_label: leadLabels.get(event.audience_hash) || `Recipient ${String(event.audience_hash || '').slice(0, 8)}`,
      destination_masked: '',
      delivery_status: 'receipt_unavailable',
      provider_reference: '',
      sent_at: '',
      open_count: 0,
      first_opened_at: '',
      last_opened_at: '',
      outcomes: [],
    };
    existing.open_count += 1;
    existing.first_opened_at = !existing.first_opened_at || event.observed_at < existing.first_opened_at ? event.observed_at : existing.first_opened_at;
    existing.last_opened_at = !existing.last_opened_at || event.observed_at > existing.last_opened_at ? event.observed_at : existing.last_opened_at;
    recipientByCampaign.set(key, existing);
  }

  for (const report of reportByCampaign.values()) {
    report.recipients = [...recipientByCampaign.entries()]
      .filter(([key]) => key.startsWith(`${report.campaign_id}|`))
      .map(([, recipient]) => recipient)
      .sort((a, b) => String(b.sent_at || b.last_opened_at).localeCompare(String(a.sent_at || a.last_opened_at)));
    report.unique_open_signals = report.recipients.filter((row) => row.open_count > 0).length;
    report.open_signal_count = report.recipients.reduce((sum, row) => sum + row.open_count, 0);
    report.open_rate_percent = report.emails_sent > 0
      ? Number(((report.unique_open_signals / report.emails_sent) * 100).toFixed(1))
      : null;
  }
  return [...reportByCampaign.values()];
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
    outcome_count: records.outcomes.length,
    pending_followup_count: records.engagements.filter((x) => x.followup_status === 'pending').length,
    enabled_watch_count: records.watches.filter((x) => x.enabled === 'true').length,
    qualified_lead_count: records.leads.filter((x) => ['qualified', 'crm_synced'].includes(x.status)).length,
    followup_lead_count: records.leads.filter((x) => x.eligible_for_followup === 'true' && x.status !== 'closed').length,
    totals,
    by_channel: byChannel,
    campaign_reports: campaignReports(records),
  };
}

export function getMarketingWorkspace(ownerUserId) {
  const tables = ensureMarketingWorkspace(ownerUserId);
  const records = Object.fromEntries(Object.entries(tables).map(([kind, table]) => [kind, allRows(ownerUserId, table)]));
  records.distributionMembers = records.distributionMembers.map(({ destination_encrypted, ...row }) => {
    const destination = decryptContact(ownerUserId, destination_encrypted);
    const normalized = normalizedDestination(row.channel, destination);
    const expectedHash = normalized
      ? createHash('sha256').update(`${ownerUserId}:${normalized}`).digest('hex')
      : '';
    const expectedMask = destination ? maskDestination(destination) : '';
    // Rows created before encrypted campaign audiences gained identity hashes
    // cannot be correlated with inbound receipts. Repair only derived values;
    // the encrypted destination remains unchanged and raw contact data is not
    // added to the stored row.
    if (row.row_id && expectedHash && (row.destination_hash !== expectedHash || !row.destination_masked)) {
      updateRow(ownerUserId, tables.distributionMembers.id, row.row_id, {
        destination_hash: expectedHash,
        destination_masked: row.destination_masked || expectedMask,
      });
      row.destination_hash = expectedHash;
      row.destination_masked = row.destination_masked || expectedMask;
    }
    return { ...row, destination };
  });
  records.outcomes = records.outcomes.map((row) => {
    if (!row.row_id || !row.campaign_id || !row.channel) return row;
    const campaign = records.campaigns.find((candidate) => candidate.campaign_id === row.campaign_id);
    if (!campaign) return row;
    const audienceListIds = new Set(parseJsonArray(campaign.audience_list_ids_json));
    if (!audienceListIds.size) return row;
    const eligibleMembers = records.distributionMembers.filter((member) =>
      audienceListIds.has(member.list_id) && member.channel === row.channel && member.destination_hash
    );
    const candidates = eligibleMembers.filter((member) => {
      const normalized = normalizedDestination(member.channel, member.destination);
      const legacyValues = unique([
        member.destination,
        ['whatsapp', 'telemarketing'].includes(member.channel) && normalized ? `+${normalized}` : '',
      ]).filter(Boolean);
      const legacyHashes = legacyValues.map((value) =>
        createHash('sha256').update(`${ownerUserId}:${value}`).digest('hex')
      );
      if (row.audience_hash && legacyHashes.includes(row.audience_hash)) return true;
      return !row.audience_hash && row.destination_masked
        && maskDestination(member.destination) === row.destination_masked;
    });
    if (candidates.length !== 1 || row.audience_hash === candidates[0].destination_hash) return row;
    updateRow(ownerUserId, tables.outcomes.id, row.row_id, {
      audience_hash: candidates[0].destination_hash,
    });
    return { ...row, audience_hash: candidates[0].destination_hash };
  });
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
  const selectedListIds = parseJsonArray(campaign.audience_list_ids_json);
  const selectedLists = workspace.records.distributionLists.filter((row) => selectedListIds.includes(row.list_id) && row.status !== 'inactive');
  const selectedMembers = workspace.records.distributionMembers.filter((row) => selectedListIds.includes(row.list_id));
  const blockers = [];
  if (!campaign.objective_id && !campaign.goal) blockers.push('Add an Objective ID or measurable outcome goal.');
  if (!requestedChannels.length) blockers.push('Select at least one campaign channel.');
  if (!['active', 'draft'].includes(campaign.status)) blockers.push(`Campaign status '${campaign.status}' cannot be prepared for execution.`);
  for (const listId of selectedListIds) if (!selectedLists.some((row) => row.list_id === listId)) blockers.push(`Audience list '${listId}' is missing or inactive.`);

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
    const audienceMembers = selectedMembers.filter((row) => row.channel === channel);
    if (['email', 'whatsapp', 'telemarketing'].includes(channel)) {
      const hasAlternativeAudience = parseJsonArray(campaign.audience_crm_person_refs_json).length > 0 || !!campaign.audience_crm_filter || !!campaign.crm_reference;
      if (!audienceMembers.length && !hasAlternativeAudience) blockers.push(`${channel}: select a distribution list or CRM audience.`);
      for (const member of audienceMembers) {
        if (!member.destination) blockers.push(`${channel}: ${member.display_label || member.member_id} has no destination.`);
        if (member.consent_status !== 'granted') blockers.push(`${channel}: ${member.display_label || member.destination_masked || member.member_id} does not have granted consent.`);
      }
    }
    return {
      channel,
      execution_mode: setup?.execution_mode || 'draft_only',
      connector_type: setup?.connector_type || '',
      connector_id: setup?.connector_id || '',
      account_reference: setup?.account_reference || '',
      sender_reference: setup?.sender_reference || '',
      audience: {
        distribution_lists: selectedLists.filter((row) => row.default_channel === channel || audienceMembers.some((member) => member.list_id === row.list_id)).map((row) => ({ list_id: row.list_id, name: row.name })),
        ready_member_count: audienceMembers.filter((row) => row.destination && row.consent_status === 'granted').length,
        blocked_member_count: audienceMembers.filter((row) => !row.destination || row.consent_status !== 'granted').length,
        crm_reference_count: parseJsonArray(campaign.audience_crm_person_refs_json).length,
        has_crm_filter_or_segment: !!campaign.audience_crm_filter || !!campaign.crm_reference,
      },
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

function normalize(kind, input = {}, ownerUserId = '') {
  const created = now();
  if (kind === 'campaigns') {
    if (!text(input.name, 160)) fail('Campaign name is required');
    return {
      campaign_id: text(input.campaign_id, 100) || `campaign-${randomUUID()}`,
      name: text(input.name, 160), objective_id: text(input.objective_id, 120), status: text(input.status, 40) || 'draft',
      start_date: text(input.start_date, 40), end_date: text(input.end_date, 40), channels_json: jsonText(input.channels_json ?? input.channels ?? []),
      audience_list_ids_json: jsonText([...new Set((input.audience_list_ids ?? parseJsonArray(input.audience_list_ids_json)).map((value) => text(value, 120)).filter(Boolean))].slice(0, 200)),
      audience_crm_filter: text(input.audience_crm_filter, 2000),
      audience_crm_person_refs_json: jsonText(
        [...new Set((input.audience_crm_person_refs ?? parseJsonArray(input.audience_crm_person_refs_json)).map((value) => text(value, 200)).filter(Boolean))].slice(0, 500)
      ),
      crm_reference: text(input.crm_reference, 500), budget_total: text(input.budget_total, 60),
      budget_daily: text(input.budget_daily, 60), currency: text(input.currency, 12) || 'USD', goal: text(input.goal, 2000),
      strategy_brief: text(input.strategy_brief, 5000), content_topics_json: jsonText(input.content_topics_json ?? input.content_topics ?? []),
      content_cadence: text(input.content_cadence, 40), content_per_run: String(Math.min(Math.max(Number(input.content_per_run) || 1, 1), 20)),
      stop_conditions_json: jsonText(input.stop_conditions_json ?? input.stop_conditions ?? []), scheduled_goal_id: text(input.scheduled_goal_id, 120), owner_agent: text(input.owner_agent, 120),
      notes: text(input.notes, 4000), created_at: text(input.created_at, 40) || created, updated_at: created,
    };
  }
  if (kind === 'distributionLists') {
    if (!text(input.name, 160)) fail('Distribution list name is required');
    const status = text(input.status, 40) || 'active';
    if (!['active', 'inactive'].includes(status)) fail('Distribution list status must be active or inactive');
    return {
      list_id: text(input.list_id, 120) || `audience-list-${randomUUID()}`,
      name: text(input.name, 160), description: text(input.description, 2000), status,
      default_channel: text(input.default_channel, 60).toLowerCase() || 'email', created_at: text(input.created_at, 40) || created, updated_at: created,
    };
  }
  if (kind === 'distributionMembers') {
    const channel = text(input.channel, 60).toLowerCase();
    const destination = normalizedDestination(channel, input.destination);
    if (!text(input.list_id, 120) || !channel || !destination) fail('Distribution list, channel and destination are required');
    if (!['email', 'whatsapp', 'facebook', 'google_ads', 'linkedin', 'instagram', 'telemarketing'].includes(channel)) fail('Unsupported distribution channel');
    if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) fail('A valid email address is required');
    if (['whatsapp', 'telemarketing'].includes(channel) && (destination.length < 8 || destination.length > 15)) fail('A valid international phone number is required');
    const consentStatus = text(input.consent_status, 40) || 'unknown';
    if (!['unknown', 'granted', 'denied'].includes(consentStatus)) fail('Consent status must be unknown, granted, or denied');
    return {
      member_id: text(input.member_id, 120) || `audience-member-${randomUUID()}`, list_id: text(input.list_id, 120), display_label: text(input.display_label, 200), channel,
      destination_encrypted: encryptContact(ownerUserId, destination), destination_hash: createHash('sha256').update(`${ownerUserId}:${destination}`).digest('hex'), destination_masked: maskDestination(destination),
      provider: text(input.provider, 80) || 'manual', provider_reference: text(input.provider_reference, 500), crm_person_reference: text(input.crm_person_reference, 200),
      consent_status: consentStatus, consent_source: text(input.consent_source, 300), consent_at: text(input.consent_at, 40), tags_json: jsonText(input.tags_json ?? input.tags ?? []),
      created_at: text(input.created_at, 40) || created, updated_at: created,
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
  if (kind === 'outcomes') {
    if (!text(input.campaign_id, 100) || !text(input.channel, 60) || !text(input.outcome_type ?? input.event_type, 80)) fail('Outcome campaign, channel and outcome type are required');
    return {
      outcome_id: text(input.outcome_id ?? input.event_id, 140) || `outcome-${randomUUID()}`,
      campaign_id: text(input.campaign_id, 100), asset_id: text(input.asset_id, 100), channel: text(input.channel, 60).toLowerCase(),
      outcome_type: text(input.outcome_type ?? input.event_type, 80).toLowerCase(), audience_hash: text(input.audience_hash, 128), recipient_label: text(input.recipient_label ?? input.audience_label, 200), destination_masked: text(input.destination_masked, 320),
      provider_reference: text(input.provider_reference, 300), value: text(input.value, 80) || '1', unit: text(input.unit, 40) || 'count', status: text(input.status, 60) || 'observed', observed_at: text(input.observed_at, 40) || created,
      metadata_json: jsonText(input.metadata_json ?? input.metadata ?? {}), source: text(input.source, 100) || 'marketing_workspace',
      created_at: text(input.created_at, 40) || created, updated_at: created,
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
      lead_id: text(input.lead_id, 120) || `marketing-lead-${randomUUID()}`, crm_person_reference: text(input.crm_person_reference, 200), crm_lead_reference: text(input.crm_lead_reference, 200), crm_opportunity_reference: text(input.crm_opportunity_reference, 200),
      identity_hash: text(input.identity_hash, 128), display_label: text(input.display_label, 200), opportunity_key: text(input.opportunity_key, 200) || 'general', opportunity_summary: text(input.opportunity_summary, 1000), campaign_ids_json: jsonText(input.campaign_ids_json ?? input.campaign_ids ?? []),
      channels_json: jsonText(input.channels_json ?? input.channels ?? []), opportunity_interests_json: jsonText(input.opportunity_interests_json ?? input.opportunity_interests ?? []), interests_json: jsonText(input.interests_json ?? input.interests ?? []), engagement_event_ids_json: jsonText(input.engagement_event_ids_json ?? input.engagement_event_ids ?? []),
      score: String(Number(input.score) || 0), status: text(input.status, 40) || 'identified', lifecycle_stage: text(input.lifecycle_stage, 60) || 'new', consent_json: jsonText(input.consent_json ?? input.consent ?? {}),
      eligible_for_followup: String(input.eligible_for_followup === true || String(input.eligible_for_followup).toLowerCase() === 'true'), last_engagement_at: text(input.last_engagement_at, 40),
      followup_status: text(input.followup_status, 60) || 'not_ready', followup_channel: text(input.followup_channel, 60), followup_due_at: text(input.followup_due_at, 40),
      recommended_followup: text(input.recommended_followup, 2000), next_action: text(input.next_action, 2000), owner_agent: text(input.owner_agent, 120), created_at: text(input.created_at, 40) || created, updated_at: created,
    };
  }
  fail('Unsupported marketing record type');
}

export function upsertMarketingRecord(ownerUserId, kind, input = {}) {
  const spec = TABLES[kind];
  if (!spec) fail('Unsupported marketing record type');
  const tables = ensureMarketingWorkspace(ownerUserId);
  const data = normalize(kind, input, ownerUserId);
  if (kind === 'distributionMembers' && !allRows(ownerUserId, tables.distributionLists).some((row) => row.list_id === data.list_id)) fail('Distribution list not found', 404);
  const existing = allRows(ownerUserId, tables[kind]).find((row) => String(row[spec.key]) === String(data[spec.key]));
  const result = existing
    ? updateRow(ownerUserId, tables[kind].id, existing.row_id, data)
    : insertRow(ownerUserId, tables[kind].id, data);
  let record = { row_id: result.row.id, ...result.row.data };
  if (kind === 'distributionMembers') {
    const { destination_encrypted, ...safeRecord } = record;
    record = { ...safeRecord, destination: decryptContact(ownerUserId, destination_encrypted) };
  }
  return { kind, created: !existing, record };
}

export const MARKETING_RECORD_TYPES = Object.freeze(Object.keys(TABLES));

export async function upsertMarketingCampaignSchedule(ownerUserId, input = {}, actorAgentId = '') {
  const campaignId = text(input.campaign_id, 100);
  const agentId = text(actorAgentId, 120);
  if (!campaignId || !agentId) fail('campaign_id and calling agent are required');
  const workspace = getMarketingWorkspace(ownerUserId);
  const campaign = workspace.records.campaigns.find((row) => row.campaign_id === campaignId);
  if (!campaign) fail('Campaign not found', 404);
  const cadence = text(input.cadence ?? campaign.content_cadence, 40) || 'weekdays';
  if (!['hourly', 'daily', 'weekdays', 'weekly'].includes(cadence)) fail('cadence must be hourly, daily, weekdays, or weekly');
  const contentPerRun = Math.min(Math.max(Number(input.content_per_run ?? campaign.content_per_run) || 1, 1), 20);
  const requestedTopics = input.content_topics ?? input.content_topics_json;
  const topics = Array.isArray(requestedTopics)
    ? requestedTopics.map((value) => text(value, 300)).filter(Boolean)
    : parseJsonArray(input.content_topics_json ?? campaign.content_topics_json);
  const requestedStopConditions = input.stop_conditions ?? input.stop_conditions_json;
  const stopConditions = Array.isArray(requestedStopConditions)
    ? requestedStopConditions.map((value) => text(value, 500)).filter(Boolean)
    : parseJsonArray(input.stop_conditions_json ?? campaign.stop_conditions_json);
  const strategyBrief = text(input.strategy_brief ?? campaign.strategy_brief, 5000);
  if (!strategyBrief && !campaign.goal) fail('Save a campaign strategy brief or outcome goal before scheduling');
  const channels = parseJsonArray(campaign.channels_json);
  const prompt = [
    `Operate marketing campaign ${campaign.campaign_id} (${campaign.name}).`,
    `Outcome goal: ${campaign.goal || 'Use the saved campaign objective.'}`,
    `Strategy: ${strategyBrief || campaign.goal}`,
    `Channels: ${channels.join(', ') || 'Use the saved campaign channels.'}`,
    `Topics: ${topics.join(', ') || 'Derive the next topic from the saved strategy and recent evidence.'}`,
    `Generate at most ${contentPerRun} new content item${contentPerRun === 1 ? '' : 's'} in this run.`,
    `Stop conditions: ${stopConditions.join('; ') || 'campaign end date, objective achieved, budget exhausted, policy block, or campaign no longer active'}.`,
    'First call marketing_workspace_read and marketing_campaign_run_prepare. If the campaign is blocked, stopped, completed, outside its window, or has met a stop condition, do not publish; report the reason and mark this campaign schedule completed with marketing_campaign_schedule_upsert when the stop is terminal.',
    'Review prior campaign assets and outcome evidence. Generate only the next non-duplicate asset using current Knowledge/RAG and the saved brand strategy. Use the configured provider adapter or saved browser recipe for the channel. External actions remain governed by Action Control.',
    'Record the provider receipt with marketing_campaign_outcome_record, configure/update the read-only watch when applicable, and summarize what should change on the next run.',
  ].join('\n');
  const requestedStatus = text(input.status, 40).toLowerCase();
  if (requestedStatus && !['active', 'paused', 'completed'].includes(requestedStatus)) fail('status must be active, paused, or completed');
  let schedule = campaign.scheduled_goal_id ? getScheduledGoal(ownerUserId, campaign.scheduled_goal_id) : null;
  if (schedule && schedule.agent_id !== agentId) fail('Campaign schedule belongs to a different agent', 409, 'MARKETING_SCHEDULE_AGENT_MISMATCH');
  const endsAt = input.ends_at !== undefined ? input.ends_at : (text(campaign.end_date, 40) || schedule?.ends_at || 'perpetual');
  if (schedule) {
    schedule = updateScheduledGoal(ownerUserId, schedule.id, {
      title: `Marketing · ${campaign.name}`,
      prompt,
      cadence,
      weekday: input.weekday,
      time_local: text(input.time_local, 10) || schedule.time_local,
      timezone: text(input.timezone, 80) || schedule.timezone,
      ends_at: endsAt,
      status: requestedStatus || schedule.status,
    });
  } else {
    schedule = await createScheduledGoal(ownerUserId, {
      title: `Marketing · ${campaign.name}`,
      prompt,
      agent_id: agentId,
      cadence,
      weekday: input.weekday,
      time_local: text(input.time_local, 10) || '09:00',
      timezone: text(input.timezone, 80),
      ends_at: endsAt,
      source: 'marketing',
      skip_plan_review: true,
    });
    if (requestedStatus && requestedStatus !== schedule.status) schedule = updateScheduledGoal(ownerUserId, schedule.id, { status: requestedStatus });
  }
  const savedCampaign = upsertMarketingRecord(ownerUserId, 'campaigns', {
    ...campaign,
    scheduled_goal_id: schedule.id,
    content_cadence: cadence,
    content_per_run: String(contentPerRun),
    strategy_brief: strategyBrief,
    content_topics_json: JSON.stringify(topics),
    stop_conditions_json: JSON.stringify(stopConditions),
  }).record;
  return { campaign: savedCampaign, schedule, managed_in: '/scheduled-goals' };
}

function audienceHash(ownerUserId, audienceReference) {
  return createHash('sha256').update(`${ownerUserId}:${text(audienceReference, 1000)}`).digest('hex');
}

function maskDestination(value) {
  const raw = text(value, 320);
  const email = raw.match(/^([^@]+)@(.+)$/);
  if (email) return `${email[1].slice(0, 1)}***@${email[2]}`;
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 4) return `***${digits.slice(-4)}`;
  return raw ? '***' : '';
}

function inferredRecipientLabel(value) {
  const local = text(value, 320).split('@')[0].replace(/[._+-]+/g, ' ').trim();
  return local ? local.replace(/\b\w/g, (char) => char.toUpperCase()).slice(0, 200) : 'Campaign recipient';
}

function stableOutcomeId(campaignId, assetId, channel, outcomeType, hash, providerReference = '') {
  return `outcome-${createHash('sha256').update(`${campaignId}|${assetId}|${channel}|${outcomeType}|${hash}|${providerReference}`).digest('hex').slice(0, 28)}`;
}

export function recordMarketingOutcome(ownerUserId, input = {}) {
  const campaignId = text(input.campaign_id, 100);
  const assetId = text(input.asset_id, 100);
  const channel = text(input.channel, 60).toLowerCase();
  const outcomeType = text(input.outcome_type ?? input.event_type, 80).toLowerCase();
  const reference = text(input.audience_reference ?? input.recipient ?? input.to, 1000);
  const hash = text(input.audience_hash, 128) || (reference ? audienceHash(ownerUserId, reference) : '');
  if (!campaignId || !channel || !outcomeType) fail('campaign_id, channel and outcome_type are required');
  const providerReference = text(input.provider_reference, 300);
  const outcomeId = text(input.outcome_id ?? input.event_id, 140) || stableOutcomeId(campaignId, assetId, channel, outcomeType, hash, providerReference);
  const workspace = getMarketingWorkspace(ownerUserId);
  if (!workspace.records.campaigns.some((row) => row.campaign_id === campaignId)) fail('Campaign not found', 404);
  if (assetId && !workspace.records.assets.some((row) => row.asset_id === assetId && (!row.campaign_id || row.campaign_id === campaignId))) fail('Campaign asset not found', 404);
  const existing = workspace.records.outcomes.find((row) => row.outcome_id === outcomeId) || {};
  return upsertMarketingRecord(ownerUserId, 'outcomes', {
    ...existing,
    outcome_id: outcomeId,
    campaign_id: campaignId,
    asset_id: assetId,
    channel,
    outcome_type: outcomeType,
    audience_hash: hash,
    recipient_label: text(input.recipient_label, 200) || existing.recipient_label || inferredRecipientLabel(reference),
    destination_masked: text(input.destination_masked, 320) || existing.destination_masked || maskDestination(reference),
    provider_reference: providerReference || existing.provider_reference,
    value: text(input.value, 80) || existing.value || '1', unit: text(input.unit, 40) || existing.unit || 'count',
    status: text(input.status, 60) || existing.status || 'observed', observed_at: text(input.observed_at, 40) || existing.observed_at || now(),
    metadata: input.metadata ?? parseJsonObject(existing.metadata_json),
    source: text(input.source, 100) || existing.source || 'marketing_outcome',
    created_at: existing.created_at,
  });
}

/**
 * Reconcile successful legacy email_send receipts with existing recipient-specific
 * open signals. This makes pre-ledger campaigns reportable without retaining raw
 * destinations in the outcome ledger. Inferred matches are restricted to the
 * campaign/asset lifetime and must precede the matching open signal; this prevents
 * unrelated historical sends to the same address from being attributed later.
 */
export function reconcileMarketingToolOutcomes(ownerUserId) {
  const owner = text(ownerUserId, 200);
  if (!owner) return { reconciled: 0, skipped: 0 };
  const workspace = getMarketingWorkspace(owner);
  const existingKeys = new Set(workspace.records.outcomes.map((row) => `${row.campaign_id}|${row.asset_id}|${row.channel}|${row.outcome_type}|${row.provider_reference}`));
  const openByHash = new Map();
  const campaignById = new Map(workspace.records.campaigns.map((row) => [row.campaign_id, row]));
  const assetById = new Map(workspace.records.assets.map((row) => [row.asset_id, row]));
  const trackingPreparedByTarget = new Map();
  for (const outcome of workspace.records.outcomes) {
    if (outcome.channel !== 'email' || outcome.outcome_type !== 'tracking_prepared' || !outcome.audience_hash || !outcome.campaign_id) continue;
    const key = `${outcome.audience_hash}|${outcome.campaign_id}|${outcome.asset_id || ''}`;
    const observed = parseTimestamp(outcome.observed_at || outcome.created_at);
    if (Number.isFinite(observed)) trackingPreparedByTarget.set(key, Math.max(trackingPreparedByTarget.get(key) || 0, observed));
  }
  for (const event of workspace.records.engagements) {
    if (event.channel !== 'email' || event.event_type !== 'open_signal' || !event.audience_hash || !event.campaign_id) continue;
    const key = event.audience_hash;
    const target = `${event.campaign_id}|${event.asset_id || ''}`;
    if (!openByHash.has(key)) openByHash.set(key, new Map());
    const observed = parseTimestamp(event.observed_at || event.created_at);
    const prior = openByHash.get(key).get(target);
    openByHash.get(key).set(target, {
      first_opened_at: Number.isFinite(observed) ? Math.min(prior?.first_opened_at ?? observed, observed) : prior?.first_opened_at,
    });
  }
  let logs = [];
  try {
    logs = getDb().prepare(`
      SELECT id,request_payload,response_payload,created_at
      FROM content_tool_logs
      WHERE owner_user_id=? AND tool_name='email_send' AND status='ok'
      ORDER BY id DESC LIMIT 1000
    `).all(owner);
  } catch { return { reconciled: 0, skipped: 0 }; }
  let reconciled = 0;
  let skipped = 0;
  for (const log of logs) {
    let request; let response;
    try { request = JSON.parse(log.request_payload || '{}'); response = JSON.parse(log.response_payload || '{}'); } catch { skipped += 1; continue; }
    if (response.sent !== true) continue;
    const recipients = [...new Set([response.to ?? request.to, response.cc ?? request.cc, response.bcc ?? request.bcc].flatMap((value) => Array.isArray(value) ? value : String(value || '').split(/[,;]/)).map((value) => text(value, 320)).filter(Boolean))];
    for (const recipient of recipients) {
      const hash = audienceHash(owner, recipient);
      const logTime = parseTimestamp(log.created_at);
      let targets = [];
      if (request.campaign_id && request.asset_id) {
        targets = [`${text(request.campaign_id, 100)}|${text(request.asset_id, 100)}`];
      } else if (Number.isFinite(logTime)) {
        targets = [...(openByHash.get(hash) || new Map()).entries()]
          .filter(([target, evidence]) => {
            const [campaignId, assetId] = target.split('|');
            const campaign = campaignById.get(campaignId);
            const asset = assetId ? assetById.get(assetId) : null;
            if (!campaign || (assetId && (!asset || (asset.campaign_id && asset.campaign_id !== campaignId)))) return false;
            const createdBoundary = Math.max(
              parseTimestamp(campaign.created_at) || 0,
              parseTimestamp(asset?.created_at) || 0,
              trackingPreparedByTarget.get(`${hash}|${campaignId}|${assetId}`) || 0,
            );
            return logTime >= createdBoundary && (!Number.isFinite(evidence.first_opened_at) || logTime <= evidence.first_opened_at);
          })
          .map(([target]) => target);
      }
      if (targets.length !== 1) { skipped += 1; continue; }
      const [campaignId, assetId] = targets[0].split('|');
      if (!campaignId) { skipped += 1; continue; }
      const providerReference = response.messageId || `content-tool-log-${log.id}`;
      const evidenceKey = `${campaignId}|${assetId}|email|send_accepted|${providerReference}`;
      if (existingKeys.has(evidenceKey)) continue;
      const result = recordMarketingOutcome(owner, {
        campaign_id: campaignId,
        asset_id: assetId,
        channel: 'email',
        outcome_type: 'send_accepted',
        audience_reference: recipient,
        recipient_label: request.recipient_label,
        provider_reference: providerReference,
        observed_at: log.created_at,
        metadata: { reconciled_from: 'content_tool_logs' },
        source: 'email_send_reconciliation',
      });
      if (result.created) { reconciled += 1; existingKeys.add(evidenceKey); }
    }
  }
  return { reconciled, skipped };
}

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
  const hashedAudience = audience ? audienceHash(ownerUserId, audience) : '';
  if (!hashedAudience) fail('audience_reference is required');
  recordMarketingOutcome(ownerUserId, {
    campaign_id: campaignId,
    asset_id: assetId,
    channel: 'email',
    audience_hash: hashedAudience,
    audience_reference: audience,
    recipient_label: input.recipient_label || input.audience_label,
    outcome_type: 'tracking_prepared',
    status: 'configured',
    source: 'tracking_pixel_setup',
  });
  const days = Math.min(Math.max(Number(input.expires_days) || 90, 1), 365);
  const token = signTrackingPayload({ owner: String(ownerUserId), campaign_id: campaignId, asset_id: assetId, audience_hash: hashedAudience, jti: randomUUID(), exp: Date.now() + days * 86400000 });
  const pixelUrl = `${getPublicBaseUrl()}/api/public/marketing/open.gif?t=${encodeURIComponent(token)}`;
  return { pixel_url: pixelUrl, html: `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" />`, expires_at: new Date(Date.now() + days * 86400000).toISOString(), reliability_note: 'Image retrieval indicates an open signal; mail proxies or blocked images can create false positives or negatives.' };
}

export function consumeMarketingOpenPixel(token, { userAgent = '' } = {}) {
  const payload = verifyTrackingToken(token);
  const engagement = upsertMarketingRecord(payload.owner, 'engagements', {
    event_id: `email-open-${payload.jti}`, campaign_id: payload.campaign_id, asset_id: payload.asset_id, channel: 'email', event_type: 'open_signal', audience_hash: payload.audience_hash,
    metadata: { user_agent_hash: userAgent ? createHash('sha256').update(String(userAgent)).digest('hex') : '', reliability: 'pixel_signal' }, source: 'tracking_pixel', followup_status: 'pending',
  });
  const workspace = getMarketingWorkspace(payload.owner);
  const prepared = workspace.records.outcomes.find((row) => row.campaign_id === payload.campaign_id && row.asset_id === payload.asset_id && row.audience_hash === payload.audience_hash && row.outcome_type === 'tracking_prepared');
  recordMarketingOutcome(payload.owner, {
    campaign_id: payload.campaign_id, asset_id: payload.asset_id, channel: 'email', outcome_type: 'open_signal', audience_hash: payload.audience_hash,
    recipient_label: prepared?.recipient_label, destination_masked: prepared?.destination_masked, provider_reference: engagement.record.event_id,
    observed_at: engagement.record.observed_at, metadata: { reliability: 'pixel_signal' }, source: 'tracking_pixel',
  });
  return engagement;
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
  const outcomes = events.filter((event) => event.campaign_id).map((event) => recordMarketingOutcome(ownerUserId, {
    outcome_id: event.event_id,
    campaign_id: event.campaign_id,
    asset_id: event.asset_id,
    channel: event.channel,
    outcome_type: event.event_type,
    audience_hash: event.audience_hash,
    provider_reference: event.provider_reference || event.event_id,
    value: event.value || 1,
    observed_at: event.observed_at,
    metadata_json: event.metadata_json,
    source: event.source,
  }).record);
  return { watch: updated.record, events, outcomes };
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
  const requestedLeadId = text(input.lead_id, 120);
  const requestedLead = requestedLeadId ? workspace.records.leads.find((row) => row.lead_id === requestedLeadId) : null;
  if (requestedLeadId && !requestedLead) fail('Marketing lead/opportunity record not found', 404);
  const identityReference = text(input.identity_reference, 1000);
  const identityHash = text(input.identity_hash, 128) || (identityReference ? createHash('sha256').update(`${ownerUserId}:${identityReference}`).digest('hex') : '') || requestedLead?.identity_hash;
  const crmPerson = text(input.crm_person_reference, 200) || requestedLead?.crm_person_reference;
  if (!identityHash && !crmPerson) fail('identity_reference or crm_person_reference is required');
  const opportunityKey = text(input.opportunity_key, 200) || requestedLead?.opportunity_key || text(input.campaign_ids?.[0], 100) || 'general';
  const samePerson = workspace.records.leads.filter((row) => (identityHash && row.identity_hash === identityHash) || (crmPerson && row.crm_person_reference === crmPerson));
  const existing = requestedLead || samePerson.find((row) => (row.opportunity_key || 'general') === opportunityKey);
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
  const consent = { ...Object.assign({}, ...samePerson.map((row) => parseJsonObject(row.consent_json))), ...parseJsonObject(existing?.consent_json), ...parseJsonObject(input.consent) };
  if (Object.values(consent).some((value) => ['opted_out', 'unsubscribed', 'do_not_call', 'denied'].includes(String(value).toLowerCase()))) suppressed = true;
  const channels = unique([...(parseJsonArray(existing?.channels_json)), ...events.map((event) => event.channel), ...(Array.isArray(input.channels) ? input.channels : [])]);
  const campaigns = unique([...(parseJsonArray(existing?.campaign_ids_json)), ...events.map((event) => event.campaign_id), ...(Array.isArray(input.campaign_ids) ? input.campaign_ids : [])]);
  const opportunityInterests = unique([...(parseJsonArray(existing?.opportunity_interests_json)), ...(Array.isArray(input.interests) ? input.interests : [])]);
  const historicalInterests = unique(samePerson.flatMap((row) => parseJsonArray(row.interests_json || row.opportunity_interests_json)));
  const interests = unique([...historicalInterests, ...opportunityInterests]);
  const threshold = Math.min(...channels.map((channel) => Number(parseJsonObject(strategyByChannel.get(channel)?.followup_rules_json).qualified_score || 10)), 10);
  const consentRequired = channels.some((channel) => String(strategyByChannel.get(channel)?.consent_required).toLowerCase() !== 'false');
  const consentGranted = Object.values(consent).some((value) => ['granted', 'consented', 'opted_in', 'true'].includes(String(value).toLowerCase()));
  const eligible = !suppressed && (!consentRequired || consentGranted) && score >= threshold;
  const followupStatus = suppressed ? 'suppressed' : text(input.followup_status, 60) || existing?.followup_status || (eligible ? 'pending' : 'not_ready');
  const saved = upsertMarketingRecord(ownerUserId, 'leads', {
    ...(existing || {}), lead_id: existing?.lead_id, crm_person_reference: crmPerson || existing?.crm_person_reference, crm_lead_reference: text(input.crm_lead_reference, 200) || existing?.crm_lead_reference, crm_opportunity_reference: text(input.crm_opportunity_reference, 200) || existing?.crm_opportunity_reference,
    identity_hash: identityHash || existing?.identity_hash, display_label: input.display_label || existing?.display_label, opportunity_key: opportunityKey, opportunity_summary: input.opportunity_summary || existing?.opportunity_summary,
    campaign_ids: campaigns, channels, opportunity_interests: opportunityInterests, interests,
    engagement_event_ids: unique([...eventIds, ...events.map((event) => event.event_id)]), score, status: suppressed ? 'suppressed' : existing?.crm_lead_reference ? 'crm_synced' : eligible ? 'qualified' : 'nurture',
    consent, eligible_for_followup: eligible, last_engagement_at: events.map((event) => event.observed_at).sort().at(-1) || existing?.last_engagement_at,
    lifecycle_stage: text(input.lifecycle_stage, 60) || existing?.lifecycle_stage || (eligible ? 'marketing_qualified' : 'new'), followup_status: followupStatus,
    followup_channel: text(input.followup_channel, 60) || existing?.followup_channel || channels.at(-1), followup_due_at: text(input.followup_due_at, 40) || existing?.followup_due_at,
    recommended_followup: suppressed ? 'Do not contact; respect the recorded suppression.' : input.recommended_followup || (eligible ? `Follow up using ${channels.at(-1) || 'the consented channel'} and reference interests: ${interests.join(', ') || 'recent campaign engagement'}.` : 'Continue consented nurture until qualification threshold is met.'),
    next_action: suppressed ? 'No contact permitted.' : text(input.next_action, 2000) || existing?.next_action,
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

function inboundReplyIntent(content) {
  const normalized = text(content, 4000).toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
  const optOut = /^(?:stop|unsubscribe|cancel|end|quit|opt[ -]?out|remove me|do not contact(?: me)?|don't contact(?: me)?)(?:[.!\s]|$)/i.test(normalized);
  const positive = !optOut && /(?:^|\b)(?:interested|yes|tell me more|more information|book a call|contact me|sign me up|learn more)(?:\b|$)/i.test(normalized);
  return { outcomeType: optOut ? 'opt_out' : 'reply', intent: optOut ? 'opt_out' : positive ? 'positive_interest' : 'campaign_reply' };
}

function campaignResponseKeywords(asset) {
  const variables = parseJsonObject(asset?.variables_json);
  const configured = [variables.response_keywords, variables.reply_keywords, variables.responseKeywords, variables.replyKeywords]
    .flatMap((value) => Array.isArray(value) ? value : value ? [value] : [])
    .map((value) => text(value, 80).toLowerCase())
    .filter(Boolean);
  const copy = text(asset?.content, 20000);
  const inferred = [...copy.matchAll(/\breply(?:\s+with)?\s+["'“”]?([a-z0-9][a-z0-9_-]{1,31})["'“”]?/gi)]
    .map((match) => String(match[1] || '').toLowerCase());
  return unique([...configured, ...inferred]);
}

/**
 * Attribute an inbound channel message to the most recent eligible campaign
 * send for the same consented audience member. The raw message is deliberately
 * not retained; only a content hash, size and coarse intent are persisted.
 */
export function correlateMarketingInbound(ownerUserId, input = {}) {
  const channel = text(input.channel, 60).toLowerCase();
  const rawSender = text(input.sender_id ?? input.from ?? input.audience_reference, 1000);
  const channelSender = ['whatsapp', 'telemarketing'].includes(channel)
    ? rawSender.split('@')[0].split(':')[0]
    : rawSender;
  const sender = normalizedDestination(channel, channelSender);
  const content = text(input.content ?? input.message, 4000);
  const observedAt = text(input.observed_at ?? input.received_at, 40) || now();
  const providerReference = text(input.message_id ?? input.provider_reference ?? input.run_id, 300)
    || `inbound-${createHash('sha256').update(`${channel}|${sender}|${content}|${observedAt.slice(0, 16)}`).digest('hex').slice(0, 28)}`;
  if (!channel || !sender || !content) return { matched: false, reason: 'channel_sender_and_content_required' };

  const workspace = getMarketingWorkspace(ownerUserId);
  const senderHash = audienceHash(ownerUserId, sender);
  const member = workspace.records.distributionMembers.find((row) =>
    row.channel === channel && row.destination_hash === senderHash
  );
  if (!member) return { matched: false, reason: 'sender_not_in_distribution_lists' };

  const strategy = workspace.records.strategies.find((row) => row.channel === channel);
  const attributionDays = Math.min(Math.max(Number(strategy?.attribution_window_days) || 30, 1), 365);
  const receivedMs = parseTimestamp(observedAt);
  const cutoff = (Number.isFinite(receivedMs) ? receivedMs : Date.now()) - attributionDays * 86400000;
  const candidates = workspace.records.campaigns.flatMap((campaign) => {
    if (campaign.status !== 'active' || !parseJsonArray(campaign.audience_list_ids_json).includes(member.list_id)) return [];
    if (campaign.start_date && Number.isFinite(parseTimestamp(campaign.start_date)) && parseTimestamp(campaign.start_date) > (Number.isFinite(receivedMs) ? receivedMs : Date.now())) return [];
    if (campaign.end_date && Number.isFinite(parseTimestamp(campaign.end_date)) && parseTimestamp(campaign.end_date) < (Number.isFinite(receivedMs) ? receivedMs : Date.now())) return [];
    const sends = workspace.records.outcomes
      .filter((row) => row.campaign_id === campaign.campaign_id && row.channel === channel && ['send_accepted', 'sent', 'delivered'].includes(row.outcome_type) && row.audience_hash === senderHash)
      .map((row) => ({ row, at: parseTimestamp(row.observed_at || row.created_at) }))
      .filter(({ at }) => Number.isFinite(at) && at >= cutoff && (!Number.isFinite(receivedMs) || at <= receivedMs))
      .sort((a, b) => b.at - a.at);
    return sends.length ? [{ campaign, send: sends[0].row, at: sends[0].at }] : [];
  }).sort((a, b) => b.at - a.at);
  if (!candidates.length) return { matched: false, reason: 'no_recent_campaign_send' };

  const { campaign, send } = candidates[0];
  const { outcomeType, intent } = inboundReplyIntent(content);
  const companyActor = input.company_actor && typeof input.company_actor === 'object' ? input.company_actor : null;
  const sentAsset = workspace.records.assets.find((row) => row.asset_id === send.asset_id);
  const responseKeywords = campaignResponseKeywords(sentAsset);
  const normalizedContent = content.toLowerCase();
  const matchedResponseContract = responseKeywords.some((keyword) => normalizedContent.includes(keyword));
  if (companyActor && outcomeType !== 'opt_out' && !matchedResponseContract) {
    return {
      matched: false,
      reason: 'company_user_normal_chat',
      identity: { kind: 'company_user', user_id: text(companyActor.user_id, 160), role: text(companyActor.role, 60) },
    };
  }
  const stableId = createHash('sha256').update(`${ownerUserId}|${channel}|${providerReference}`).digest('hex').slice(0, 28);
  const eventId = `marketing-inbound-${stableId}`;
  const metadata = {
    intent,
    content_hash: createHash('sha256').update(content).digest('hex'),
    content_length: content.length,
    attributed_send_outcome_id: send.outcome_id,
    attribution_candidate_count: candidates.length,
    response_contract_matched: matchedResponseContract,
    account_id: text(input.account_id, 200),
    transport_agent_id: text(input.transport_agent_id, 160),
  };
  const engagement = upsertMarketingRecord(ownerUserId, 'engagements', {
    event_id: eventId,
    campaign_id: campaign.campaign_id,
    asset_id: send.asset_id,
    channel,
    event_type: outcomeType,
    audience_hash: senderHash,
    provider_reference: providerReference,
    value: 1,
    metadata,
    source: 'channel_inbound_hook',
    observed_at: observedAt,
    followup_status: outcomeType === 'opt_out' ? 'suppressed' : 'pending',
  });
  const outcome = recordMarketingOutcome(ownerUserId, {
    outcome_id: eventId,
    campaign_id: campaign.campaign_id,
    asset_id: send.asset_id,
    channel,
    outcome_type: outcomeType,
    audience_hash: senderHash,
    recipient_label: member.display_label,
    destination_masked: member.destination_masked,
    provider_reference: providerReference,
    observed_at: observedAt,
    metadata,
    source: 'channel_inbound_hook',
  });

  if (outcomeType === 'opt_out' && member.consent_status !== 'denied') {
    upsertMarketingRecord(ownerUserId, 'distributionMembers', {
      ...member,
      destination: member.destination,
      consent_status: 'denied',
      consent_source: 'Inbound channel opt-out',
      consent_at: observedAt,
    });
  }


  if (companyActor) {
    return {
      matched: true,
      idempotent: !engagement.created,
      normal_chat: true,
      campaign: { campaign_id: campaign.campaign_id, name: campaign.name, owner_agent: campaign.owner_agent || 'marketing-specialist' },
      audience: { member_id: member.member_id, display_label: member.display_label, destination_masked: member.destination_masked },
      identity: { kind: 'company_user', user_id: text(companyActor.user_id, 160), role: text(companyActor.role, 60), name: text(companyActor.name, 200) },
      attribution: { send_outcome_id: send.outcome_id, candidate_count: candidates.length, window_days: attributionDays, response_contract_matched: matchedResponseContract },
      classification: { outcome_type: outcomeType, intent },
      engagement: engagement.record,
      outcome: outcome.record,
      lead: null,
    };
  }

  const topics = parseJsonArray(campaign.content_topics_json);
  const interests = unique([
    ...topics,
    intent === 'positive_interest' ? 'positive campaign interest' : 'campaign response',
  ]);
  const dueAt = new Date((Number.isFinite(receivedMs) ? receivedMs : Date.now()) + 24 * 60 * 60 * 1000).toISOString();
  const lead = prepareMarketingLead(ownerUserId, {
    identity_reference: sender,
    crm_person_reference: member.crm_person_reference,
    display_label: member.display_label || member.destination_masked,
    opportunity_key: campaign.campaign_id,
    opportunity_summary: campaign.goal || campaign.name,
    campaign_ids: [campaign.campaign_id],
    channels: [channel],
    interests,
    engagement_event_ids: [eventId],
    lifecycle_stage: outcomeType === 'opt_out' ? 'suppressed' : 'marketing_qualified',
    consent: { [channel]: outcomeType === 'opt_out' ? 'opted_out' : 'granted' },
    followup_status: outcomeType === 'opt_out' ? 'suppressed' : 'pending',
    followup_channel: channel,
    followup_due_at: outcomeType === 'opt_out' ? '' : dueAt,
    next_action: outcomeType === 'opt_out'
      ? 'No contact permitted.'
      : `Marketing Specialist should prepare a targeted follow-up for ${campaign.name} using the recorded interests and prior campaign evidence.`,
    owner_agent: campaign.owner_agent || 'marketing-specialist',
  });

  return {
    matched: true,
    idempotent: !engagement.created,
    campaign: { campaign_id: campaign.campaign_id, name: campaign.name, owner_agent: campaign.owner_agent || 'marketing-specialist' },
    audience: { member_id: member.member_id, display_label: member.display_label, destination_masked: member.destination_masked },
    identity: { kind: 'marketing_contact' },
    attribution: { send_outcome_id: send.outcome_id, candidate_count: candidates.length, window_days: attributionDays, response_contract_matched: matchedResponseContract },
    classification: { outcome_type: outcomeType, intent },
    engagement: engagement.record,
    outcome: outcome.record,
    lead: lead.record,
  };
}

function parseJsonArray(value) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function parseJsonObject(value) { if (value && typeof value === 'object') return value; try { const parsed = JSON.parse(value || '{}'); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; } }
