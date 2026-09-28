import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'flolah-marketing-'));
process.env.AGENT_OS_DATA_DIR = join(root, 'data');
process.env.USERPROFILE = join(root, 'home');
process.env.HOME = join(root, 'home');
process.env.OPENCLAW_CONFIG_PATH = join(root, 'home', '.openclaw', 'openclaw.json');
process.env.OPENSEARCH_ENABLED = '0';
process.env.AGENT_OS_INTERNAL_TOKEN = 'test-marketing-internal-token-not-a-production-secret';
process.env.USER_API_KEYS_KEK = 'test-marketing-contact-encryption-key';
process.env.AGENT_OS_BASE_URL = 'https://marketing.example.invalid';

let handle;
try {
  const { initDb } = await import('../src/db/schema.js');
  const svc = await import('../src/services/marketing-workspace.js');
  const { purgeOwnerRetention } = await import('../src/services/data-retention.js');
  const { getHireableRoleTemplate } = await import('../src/services/hireable-role-templates.js');
  const { seedMarketingWorkspaceToolsIfMissing } = await import('../src/db/seed-marketing-workspace-tools.js');
  handle = initDb();
  seedMarketingWorkspaceToolsIfMissing();

  handle.prepare(`INSERT INTO agents(id,name,role,template_base_id) VALUES (?,?,?,?)`).run('marketing-specialist-test', 'Marketing Specialist Test', 'Marketing', 'marketing-specialist');
  const grantSync = seedMarketingWorkspaceToolsIfMissing();
  assert.equal(grantSync.grants_added, grantSync.tools, 'existing hired Marketing Specialists inherit newly introduced Marketing tools');
  assert.equal(handle.prepare(`SELECT COUNT(*) AS count FROM agent_tool_grants WHERE agent_id = ? AND tool_name LIKE 'marketing_%'`).get('marketing-specialist-test').count, grantSync.tools);

  const ownerA = 'marketing-owner-a';
  const ownerB = 'marketing-owner-b';
  handle.prepare(`INSERT INTO platform_users(id,email,password_hash,name,role,enabled,data_retention_days) VALUES (?,?,?,?,'ceo',1,30)`).run(ownerA, 'marketing-a@example.invalid', 'test-only', 'Marketing A');
  handle.prepare(`INSERT INTO platform_users(id,email,password_hash,name,role,enabled,data_retention_days) VALUES (?,?,?,?,'ceo',1,30)`).run(ownerB, 'marketing-b@example.invalid', 'test-only', 'Marketing B');
  handle.prepare(`INSERT INTO user_agents(user_id,agent_id,enabled) VALUES (?,?,1)`).run(ownerB, 'marketing-specialist-test');
  const campaign = svc.upsertMarketingRecord(ownerA, 'campaigns', {
    campaign_id: 'campaign-growth-q4', name: 'Q4 qualified demand', status: 'active', channels: ['email', 'linkedin'], budget_total: 5000,
  });
  assert.equal(campaign.created, true);
  const updated = svc.upsertMarketingRecord(ownerA, 'campaigns', {
    campaign_id: 'campaign-growth-q4', name: 'Q4 qualified demand', status: 'paused', channels: ['email'], budget_total: 4500,
  });
  assert.equal(updated.created, false, 'stable campaign id updates without duplicating');
  svc.upsertMarketingRecord(ownerA, 'assets', { asset_id: 'asset-email-1', name: 'Welcome email', channel: 'email', content: 'Hello {{first_name}}' });
  svc.upsertMarketingRecord(ownerA, 'channels', { channel: 'email', enabled: true, connector_id: 'gmail-primary', config: { locale: 'en-SG' }, readiness_status: 'ready' });
  const firstMetric = svc.upsertMarketingRecord(ownerA, 'metrics', { campaign_id: 'campaign-growth-q4', channel: 'email', metric_name: 'clicks', value: 12, period_start: '2026-09-01', period_end: '2026-09-30', source: 'provider', receipt_id: 'receipt-1' });
  const secondMetric = svc.upsertMarketingRecord(ownerA, 'metrics', { campaign_id: 'campaign-growth-q4', channel: 'email', metric_name: 'clicks', value: 15, period_start: '2026-09-01', period_end: '2026-09-30', source: 'provider', receipt_id: 'receipt-1' });
  assert.equal(firstMetric.record.metric_id, secondMetric.record.metric_id, 'stable metric evidence is idempotent');

  const a = svc.getMarketingWorkspace(ownerA);
  const b = svc.getMarketingWorkspace(ownerB);
  assert.equal(a.records.campaigns.length, 1);
  assert.equal(a.records.campaigns[0].status, 'paused');
  assert.equal(a.records.metrics.length, 1);
  assert.equal(a.analytics.totals.clicks, 15);
  assert.equal(b.records.campaigns.length, 0, 'cross-owner campaign data is not visible');
  assert.throws(() => svc.upsertMarketingRecord(ownerA, 'channels', { channel: 'facebook', config: { access_token: 'never-store-this' } }), /use Connectors instead/, 'secret-like configuration is rejected');

  const pixel = svc.createMarketingOpenPixel(ownerA, { campaign_id: 'campaign-growth-q4', asset_id: 'asset-email-1', audience_reference: 'crm-person-1' });
  assert.match(pixel.html, /open\.gif\?t=/);
  assert.doesNotMatch(pixel.html, /crm-person-1/, 'raw audience identity is not exposed in pixel');
  const token = new URL(pixel.pixel_url).searchParams.get('t');
  const opened = svc.consumeMarketingOpenPixel(token, { userAgent: 'test-mail-client' });
  assert.equal(opened.record.event_type, 'open_signal');
  assert.equal(svc.consumeMarketingOpenPixel(token).created, false, 'pixel replay is idempotent');
  const identityHash = opened.record.audience_hash;
  svc.recordMarketingOutcome(ownerA, { campaign_id: 'campaign-growth-q4', asset_id: 'asset-email-1', channel: 'email', outcome_type: 'send_accepted', audience_hash: identityHash, recipient_label: 'CRM person one', destination_masked: 'c***@example.invalid', provider_reference: 'message-1', observed_at: '2026-09-28T10:00:00.000Z', source: 'email_send' });
  const emailReport = svc.getMarketingWorkspace(ownerA).analytics.campaign_reports.find((row) => row.campaign_id === 'campaign-growth-q4');
  assert.equal(emailReport.emails_sent, 1);
  assert.equal(emailReport.unique_open_signals, 1);
  assert.equal(emailReport.open_rate_percent, 100);
  assert.equal(emailReport.recipients[0].recipient_label, 'CRM person one');
  const firstRead = svc.recordMarketingOutcome(ownerA, { campaign_id: 'campaign-growth-q4', asset_id: 'asset-email-1', channel: 'whatsapp', outcome_type: 'read', audience_hash: identityHash, recipient_label: 'CRM person one', provider_reference: 'wa-read-1' });
  const repeatedRead = svc.recordMarketingOutcome(ownerA, { campaign_id: 'campaign-growth-q4', asset_id: 'asset-email-1', channel: 'whatsapp', outcome_type: 'read', audience_hash: identityHash, recipient_label: 'CRM person one', provider_reference: 'wa-read-1' });
  assert.equal(firstRead.record.outcome_id, repeatedRead.record.outcome_id, 'provider outcome replay is idempotent');
  svc.recordMarketingOutcome(ownerA, { campaign_id: 'campaign-growth-q4', asset_id: 'asset-email-1', channel: 'facebook', outcome_type: 'comment', provider_reference: 'fb-comment-outcome-1' });
  const crossChannelReport = svc.getMarketingWorkspace(ownerA).analytics.campaign_reports.find((row) => row.campaign_id === 'campaign-growth-q4');
  assert.equal(crossChannelReport.channel_outcomes.whatsapp.read, 1);
  assert.equal(crossChannelReport.channel_outcomes.facebook.comment, 1);
  assert.equal(svc.getMarketingWorkspace(ownerB).records.outcomes.length, 0, 'cross-owner campaign outcomes are not visible');

  const audienceList = svc.upsertMarketingRecord(ownerB, 'distributionLists', { list_id: 'manual-prospects', name: 'Manual prospects', default_channel: 'email' });
  assert.equal(audienceList.created, true);
  const audienceMember = svc.upsertMarketingRecord(ownerB, 'distributionMembers', { member_id: 'manual-prospect-1', list_id: 'manual-prospects', display_label: 'Manual prospect', channel: 'email', destination: 'prospect@example.invalid', consent_status: 'granted', consent_source: 'Owner-provided test contact' });
  assert.equal(audienceMember.record.destination_encrypted, undefined, 'encrypted destination is not returned by the upsert contract');
  const manualAudienceWorkspace = svc.getMarketingWorkspace(ownerB);
  assert.equal(manualAudienceWorkspace.records.distributionMembers[0].destination, 'prospect@example.invalid', 'authorized workspace resolves encrypted contact destination');
  const storedMember = handle.prepare(`SELECT row_json FROM master_data_rows WHERE owner_user_id=? AND table_id=(SELECT id FROM master_data_tables WHERE owner_user_id=? AND name='marketing_distribution_list_members') LIMIT 1`).get(ownerB, ownerB);
  assert.doesNotMatch(storedMember.row_json, /prospect@example\.invalid/, 'manual contact destination is encrypted at rest');
  assert.equal(svc.getMarketingWorkspace(ownerA).records.distributionMembers.length, 0, 'manual audience lists are owner isolated');

  svc.upsertMarketingRecord(ownerB, 'campaigns', { campaign_id: 'legacy-email-campaign', name: 'Legacy email campaign', status: 'active', channels: ['email'], goal: 'Validate legacy receipts', audience_crm_person_refs: ['crm-person-legacy'], created_at: '2026-09-27T10:00:00.000Z' });
  svc.upsertMarketingRecord(ownerB, 'assets', { asset_id: 'legacy-email-asset', campaign_id: 'legacy-email-campaign', name: 'Legacy email', channel: 'email', content: '<p>Hello</p>', approval_status: 'approved', created_at: '2026-09-27T10:00:00.000Z' });
  const legacyPixel = svc.createMarketingOpenPixel(ownerB, { campaign_id: 'legacy-email-campaign', asset_id: 'legacy-email-asset', audience_reference: 'legacy.person@example.invalid' });
  const legacySendAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
  handle.prepare(`INSERT INTO content_tool_logs(tool_name,request_payload,response_payload,status,owner_user_id,created_at) VALUES('email_send',?,?, 'ok',?,?)`).run(
    JSON.stringify({ to: 'legacy.person@example.invalid', subject: 'Legacy campaign' }),
    JSON.stringify({ sent: true, messageId: 'legacy-message-1', to: ['legacy.person@example.invalid'] }),
    ownerB,
    legacySendAt
  );
  handle.prepare(`INSERT INTO content_tool_logs(tool_name,request_payload,response_payload,status,owner_user_id,created_at) VALUES('email_send',?,?, 'ok',?,?)`).run(
    JSON.stringify({ to: 'legacy.person@example.invalid', subject: 'Unrelated historical email' }),
    JSON.stringify({ sent: true, messageId: 'historical-message-before-campaign', to: ['legacy.person@example.invalid'] }),
    ownerB,
    '2026-08-27T12:00:00.000Z'
  );
  svc.consumeMarketingOpenPixel(new URL(legacyPixel.pixel_url).searchParams.get('t'));
  assert.equal(svc.reconcileMarketingToolOutcomes(ownerB).reconciled, 1, 'legacy successful email receipt is reconciled generically');
  assert.equal(svc.reconcileMarketingToolOutcomes(ownerB).reconciled, 0, 'legacy receipt reconciliation is idempotent');
  const legacyReport = svc.getMarketingWorkspace(ownerB).analytics.campaign_reports.find((row) => row.campaign_id === 'legacy-email-campaign');
  assert.equal(legacyReport.emails_sent, 1);
  assert.equal(legacyReport.configured_audience_count, 1);
  assert.equal(legacyReport.unique_open_signals, 1);
  assert.equal(legacyReport.recipients[0].recipient_label, 'Legacy Person');
  assert.equal(legacyReport.recipients[0].destination_masked, 'l***@example.invalid');
  svc.upsertMarketingRecord(ownerA, 'engagements', { event_id: 'email-reply-1', campaign_id: 'campaign-growth-q4', asset_id: 'asset-email-1', channel: 'email', event_type: 'reply', audience_hash: identityHash, source: 'provider_webhook' });
  const qualified = svc.prepareMarketingLead(ownerA, { identity_reference: 'crm-person-1', crm_person_reference: 'person-1', crm_opportunity_reference: 'opportunity-1', display_label: 'Existing CRM person', opportunity_key: 'platform-adoption', opportunity_summary: 'Platform adoption', campaign_ids: ['campaign-growth-q4'], channels: ['email'], interests: ['automation'], engagement_event_ids: [opened.record.event_id, 'email-reply-1'], lifecycle_stage: 'marketing_qualified', consent: { overall: 'granted' }, followup_status: 'pending', followup_channel: 'email', followup_due_at: '2026-10-01T09:00:00.000Z', next_action: 'Send the product-fit brief.' });
  assert.equal(qualified.record.status, 'qualified');
  assert.equal(qualified.correlation.person_match, 'new_person');
  assert.equal(qualified.record.crm_opportunity_reference, 'opportunity-1');
  assert.equal(qualified.record.lifecycle_stage, 'marketing_qualified');
  assert.equal(qualified.record.followup_status, 'pending');
  assert.equal(qualified.record.next_action, 'Send the product-fit brief.');
  const updatedQualified = svc.prepareMarketingLead(ownerA, { lead_id: qualified.record.lead_id, followup_status: 'scheduled', followup_due_at: '2026-10-02T09:30:00.000Z', next_action: 'Run the scheduled discovery call.' });
  assert.equal(updatedQualified.created, false, 'an explicit lead id updates one portfolio row instead of duplicating it');
  assert.equal(updatedQualified.record.lead_id, qualified.record.lead_id);
  assert.equal(updatedQualified.record.followup_status, 'scheduled');
  assert.equal(updatedQualified.record.next_action, 'Run the scheduled discovery call.');
  const otherOpportunity = svc.prepareMarketingLead(ownerA, { identity_reference: 'crm-person-1', crm_person_reference: 'person-1', opportunity_key: 'analytics-expansion', opportunity_summary: 'Analytics expansion', interests: ['campaign analytics'], engagement_event_ids: ['email-reply-1'] });
  assert.equal(otherOpportunity.correlation.person_match, 'existing_person');
  assert.equal(otherOpportunity.correlation.opportunity_match, 'new_opportunity_for_existing_person');
  assert.ok(otherOpportunity.correlation.historical_interests.includes('automation'));
  assert.notEqual(otherOpportunity.record.lead_id, qualified.record.lead_id, 'same person can hold distinct opportunities');
  svc.upsertMarketingRecord(ownerA, 'engagements', { event_id: 'email-unsubscribe-1', channel: 'email', event_type: 'unsubscribe', audience_hash: identityHash, source: 'provider_webhook' });
  const suppressed = svc.prepareMarketingLead(ownerA, { identity_reference: 'crm-person-1', opportunity_key: 'analytics-expansion' });
  assert.equal(suppressed.record.status, 'suppressed');
  assert.equal(suppressed.record.eligible_for_followup, 'false');

  const watch = svc.upsertMarketingRecord(ownerA, 'watches', { watch_id: 'watch-facebook-1', campaign_id: 'campaign-growth-q4', asset_id: 'asset-email-1', channel: 'facebook', target_reference: 'https://facebook.example.invalid/post/1', recipe_name: 'Facebook post insights', cadence_minutes: 60, enabled: true });
  assert.equal(svc.listDueMarketingWatches(ownerA).length, 1);
  const watchResult = svc.recordMarketingWatchResult(ownerA, { watch_id: watch.record.watch_id, insight: 'One new comment', snapshot: { comments: 1 }, events: [{ event_id: 'fb-comment-1', event_type: 'comment', value: 1 }] });
  assert.equal(watchResult.events.length, 1);
  assert.ok(Date.parse(watchResult.watch.next_check_at) > Date.now());
  assert.equal(svc.getMarketingWorkspace(ownerB).records.engagements.some((row) => row.event_id === 'fb-comment-1'), false, 'cross-owner engagement data is not visible');

  const configured = svc.configureMarketingCampaign(ownerB, {
    campaign: {
      campaign_id: 'agent-configured-campaign',
      name: 'Agent configured demand campaign',
      objective_id: 'objective-growth',
      goal: 'Generate five qualified leads',
      channels: ['email', 'facebook'],
      audience_list_ids: ['manual-prospects'],
      budget_total: 500,
      budget_daily: 25,
    },
    assets: [
      { asset_id: 'agent-email', name: 'Agent email', channel: 'email', content: 'Hello {{first_name}}', approval_status: 'approved' },
      { asset_id: 'agent-facebook', name: 'Agent social post', channel: 'facebook', asset_type: 'post', content: 'Evidence-backed campaign post', approval_status: 'approved' },
    ],
    channels: [
      { channel: 'email', enabled: true, execution_mode: 'policy_controlled', connector_type: 'agent_tool', connector_id: 'email_send', readiness_status: 'ready' },
      { channel: 'facebook', enabled: true, execution_mode: 'policy_controlled', connector_type: 'browser_recipe', connector_id: 'browse_recipe_run', sender_reference: 'Facebook verified dynamic post', readiness_status: 'ready' },
    ],
    watches: [{ watch_id: 'agent-facebook-watch', channel: 'facebook', target_reference: 'provider-post-after-publish', recipe_name: 'Facebook post insights', enabled: false }],
    strategies: [{ channel: 'facebook', tracked_signals: ['comment', 'message'], score_rules: { comment: 5, message: 10 }, attribution_window_days: 30, followup_rules: { qualified_score: 10 }, consent_required: true }],
    activate: true,
  });
  assert.equal(configured.campaign.status, 'active');
  assert.equal(configured.readiness.ready, true, 'agent can configure a runnable campaign without the UI');
  assert.equal(configured.readiness.actions.length, 2);
  assert.equal(configured.assets.length, 2);
  assert.equal(svc.prepareMarketingCampaignRun(ownerB, { campaign_id: configured.campaign.campaign_id }).ready, true);
  const scheduled = await svc.upsertMarketingCampaignSchedule(ownerB, {
    campaign_id: configured.campaign.campaign_id,
    strategy_brief: 'Educate operations leaders with evidence-backed AI automation posts.',
    content_topics_json: ['objective-led automation', 'operating efficiency'],
    stop_conditions_json: ['campaign end date', 'five qualified leads'],
    cadence: 'weekdays',
    time_local: '09:30',
    timezone: 'Asia/Singapore',
    content_per_run: 1,
  }, 'marketing-specialist-test');
  assert.equal(scheduled.schedule.status, 'active');
  assert.equal(scheduled.schedule.agent_id, 'marketing-specialist-test');
  assert.equal(scheduled.campaign.scheduled_goal_id, scheduled.schedule.id);
  assert.equal(scheduled.managed_in, '/scheduled-goals');
  const pausedSchedule = await svc.upsertMarketingCampaignSchedule(ownerB, { campaign_id: configured.campaign.campaign_id, status: 'paused' }, 'marketing-specialist-test');
  assert.equal(pausedSchedule.schedule.id, scheduled.schedule.id, 'campaign schedule updates instead of duplicating');
  assert.equal(pausedSchedule.schedule.status, 'paused');
  await assert.rejects(
    () => svc.upsertMarketingCampaignSchedule(ownerA, { campaign_id: campaign.record.campaign_id, strategy_brief: 'Cross-owner schedule attempt' }, 'marketing-specialist-test'),
    /not available|not granted/i,
    'an agent granted to another owner cannot create a campaign schedule',
  );

  svc.upsertMarketingRecord(ownerB, 'distributionLists', { list_id: 'blocked-audience', name: 'Blocked audience', default_channel: 'email' });
  svc.upsertMarketingRecord(ownerB, 'distributionMembers', { member_id: 'blocked-audience-1', list_id: 'blocked-audience', display_label: 'No consent recipient', channel: 'email', destination: 'no-consent@example.invalid', consent_status: 'unknown' });
  svc.upsertMarketingRecord(ownerB, 'assets', { asset_id: 'reusable-consent-test', name: 'Reusable consent test', channel: 'email', content: 'Consent test', approval_status: 'approved' });
  svc.upsertMarketingRecord(ownerB, 'campaigns', { campaign_id: 'consent-blocked-campaign', name: 'Consent blocked campaign', goal: 'Test consent gate', status: 'active', channels: ['email'], audience_list_ids: ['blocked-audience'] });
  const consentBlocked = svc.prepareMarketingCampaignRun(ownerB, { campaign_id: 'consent-blocked-campaign' });
  assert.equal(consentBlocked.ready, false);
  assert.ok(consentBlocked.blockers.some((item) => /does not have granted consent/i.test(item)), 'run preparation blocks manual recipients without consent');

  assert.throws(
    () => svc.configureMarketingCampaign(ownerB, {
      campaign: { campaign_id: 'blocked-paid-campaign', name: 'Blocked paid campaign', goal: 'Acquire leads', channels: ['google_ads'] },
      assets: [{ name: 'Paid creative', channel: 'google_ads', content: 'Ad', approval_status: 'approved' }],
      channels: [{ channel: 'google_ads', enabled: true, readiness_status: 'ready' }],
      activate: true,
    }),
    (error) => error.code === 'MARKETING_CAMPAIGN_NOT_READY' && error.readiness.blockers.some((item) => /positive total campaign budget/i.test(item)),
    'agentic activation fails safely when paid-channel budget is missing'
  );

  const role = getHireableRoleTemplate('marketing-specialist');
  assert.equal(role?.department, 'Marketing');
  assert.ok(role.tools.includes('marketing_workspace_read'));
  assert.ok(role.tools.includes('marketing_campaign_configure'));
  assert.ok(role.tools.includes('marketing_campaign_run_prepare'));
  assert.ok(role.tools.includes('marketing_strategy_upsert'));
  assert.ok(role.tools.includes('marketing_channel_send'));
  assert.ok(role.tools.includes('marketing_campaign_outcome_record'));
  assert.ok(role.tools.includes('marketing_audience_list_upsert'));
  assert.ok(role.tools.includes('marketing_audience_member_upsert'));
  assert.ok(role.tools.includes('marketing_campaign_schedule_upsert'));
  assert.ok(role.tools.includes('connector_execute_action'));

  const toolRows = handle.prepare(`SELECT name,risk_tier,action_family FROM content_tools_meta WHERE name LIKE 'marketing_%' ORDER BY name`).all();
  const toolNames = toolRows.map((row) => row.name);
  assert.equal(toolNames.length, 20);
  assert.equal(toolRows.find((row) => row.name === 'marketing_workspace_read')?.action_family, 'read');
  assert.equal(toolRows.find((row) => row.name === 'marketing_campaign_upsert')?.action_family, 'write_internal');
  assert.equal(toolRows.find((row) => row.name === 'marketing_channel_send')?.action_family, 'communicate_external');
  assert.equal(toolRows.find((row) => row.name === 'marketing_channel_send')?.risk_tier, 'R2');
  assert.equal(svc.getMarketingWorkspace(ownerA).records.strategies.length, 7, 'each supported channel has an effectiveness strategy');
  svc.upsertMarketingRecord(ownerA, 'engagements', { event_id: 'old-event', channel: 'email', event_type: 'open_signal', observed_at: '2020-01-01T00:00:00.000Z' });
  svc.recordMarketingOutcome(ownerA, { outcome_id: 'old-outcome', campaign_id: 'campaign-growth-q4', channel: 'facebook', outcome_type: 'reaction', observed_at: '2020-01-01T00:00:00.000Z' });
  svc.upsertMarketingRecord(ownerA, 'distributionLists', { list_id: 'old-list', name: 'Old list', default_channel: 'email' });
  svc.upsertMarketingRecord(ownerA, 'distributionMembers', { member_id: 'old-member', list_id: 'old-list', display_label: 'Old member', channel: 'email', destination: 'old@example.invalid', consent_status: 'granted', created_at: '2020-01-01T00:00:00.000Z' });
  const purged = await purgeOwnerRetention(ownerA, { days: 30 });
  assert.ok(purged.deleted.marketing_engagement_events >= 1, 'engagement history follows owner retention');
  assert.ok(purged.deleted.marketing_campaign_outcomes >= 1, 'campaign outcome ledger follows owner retention');
  assert.ok(purged.deleted.marketing_distribution_list_members >= 1, 'manual audience contacts follow owner retention');
  console.log(JSON.stringify({ ok: true, checks: ['knowledge-backed-storage', 'upsert-idempotency', 'metric-idempotency', 'outcome-ledger-idempotency', 'cross-channel-outcomes', 'legacy-email-reconciliation', 'owner-isolation', 'secret-rejection', 'signed-open-pixel', 'pixel-idempotency', 'cross-campaign-lead-correlation', 'distinct-opportunities', 'structured-followup-update', 'suppression-gate', 'browser-watch-cycle', 'agentic-campaign-configuration', 'run-readiness-contract', 'paid-budget-gate', 'channel-strategies', 'retention', 'hireable-template', 'existing-template-grant-reconciliation', 'tool-registry'] }, null, 2));
} finally {
  try { handle?.close(); } catch {}
  rmSync(root, { recursive: true, force: true });
}
