import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  const { resolveMarketingCampaignRecipient, resolveMarketingTransportAgentId } = await import('../src/routes/marketing-tools.js');
  const { extractMailboxEmail } = await import('../src/services/agent-workflow-webhooks.js');
  handle = initDb();
  seedMarketingWorkspaceToolsIfMissing();

  assert.equal(extractMailboxEmail('Interested Prospect <Reply.Prospect@Example.Invalid>'), 'reply.prospect@example.invalid');
  assert.equal(extractMailboxEmail('reply.prospect@example.invalid'), 'reply.prospect@example.invalid');

  assert.equal(resolveMarketingTransportAgentId({
    ownerUserId: 'marketing-owner-a',
    setup: { account_reference: 't-marketing-owner-a--balserve' },
    callerAgentId: 'marketing-specialist-test',
  }), 'balserve', 'configured owner-scoped company channel supplies the default transport agent');
  assert.equal(resolveMarketingTransportAgentId({
    ownerUserId: 'marketing-owner-a',
    explicitTransportAgentId: 'explicit-sender',
    setup: { account_reference: 't-marketing-owner-a--balserve' },
    callerAgentId: 'marketing-specialist-test',
  }), 'explicit-sender', 'an explicit transport agent takes precedence');
  assert.equal(resolveMarketingTransportAgentId({
    ownerUserId: 'marketing-owner-a',
    setup: { account_reference: 't-marketing-owner-b--balserve' },
    callerAgentId: 'marketing-specialist-test',
  }), 'marketing-specialist-test', 'a cross-owner account reference is never inherited');
  const campaignAudienceWorkspace = { records: { distributionMembers: [
    { member_id: 'wa-member-approved', list_id: 'wa-list', channel: 'whatsapp', destination: '+6593482490', consent_status: 'granted' },
    { member_id: 'wa-member-blocked', list_id: 'wa-list', channel: 'whatsapp', destination: '+6591112222', consent_status: 'denied' },
  ] } };
  const campaignAudience = { audience_list_ids_json: '["wa-list"]' };
  assert.equal(resolveMarketingCampaignRecipient({ workspace: campaignAudienceWorkspace, campaign: campaignAudience, channel: 'whatsapp', requestedTo: '+65 9348 2490', boundTarget: '+6590057664' }).member?.member_id, 'wa-member-approved', 'a consent-granted campaign member may use the configured sender transport');
  assert.equal(resolveMarketingCampaignRecipient({ workspace: campaignAudienceWorkspace, campaign: campaignAudience, channel: 'whatsapp', requestedTo: '+6591112222', boundTarget: '+6590057664' }).reason, 'campaign_audience_consent_missing', 'a campaign member without consent is blocked');
  assert.equal(resolveMarketingCampaignRecipient({ workspace: campaignAudienceWorkspace, campaign: campaignAudience, channel: 'whatsapp', requestedTo: '+6599998888', boundTarget: '+6590057664' }).reason, 'not_in_campaign_audience', 'an arbitrary destination cannot use the company transport');

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

  svc.upsertMarketingRecord(ownerB, 'distributionLists', { list_id: 'wa-replies', name: 'WhatsApp campaign replies', default_channel: 'whatsapp' });
  svc.upsertMarketingRecord(ownerB, 'distributionMembers', { member_id: 'wa-reply-member', list_id: 'wa-replies', display_label: 'Interested WhatsApp prospect', channel: 'whatsapp', destination: '+6590057664', consent_status: 'granted', consent_source: 'Owner-provided campaign contact' });
  svc.upsertMarketingRecord(ownerB, 'campaigns', { campaign_id: 'wa-agentic-campaign', name: 'WhatsApp agentic campaign', goal: 'Generate qualified automation leads', status: 'active', channels: ['whatsapp'], audience_list_ids: ['wa-replies'], content_topics: ['AI operations'], owner_agent: 'marketing-specialist-test' });
  svc.upsertMarketingRecord(ownerB, 'assets', { asset_id: 'wa-agentic-asset', campaign_id: 'wa-agentic-campaign', name: 'WhatsApp campaign message', channel: 'whatsapp', content: 'Reply INTERESTED to learn more', approval_status: 'approved' });
  const waHash = createHash('sha256').update(`${ownerB}:6590057664`).digest('hex');
  svc.recordMarketingOutcome(ownerB, { campaign_id: 'wa-agentic-campaign', asset_id: 'wa-agentic-asset', channel: 'whatsapp', outcome_type: 'send_accepted', audience_hash: waHash, recipient_label: 'Interested WhatsApp prospect', provider_reference: 'wa-send-1', observed_at: '2026-09-28T14:18:00.000Z' });
  const legacySendRow = handle.prepare(`SELECT id,row_json FROM master_data_rows WHERE owner_user_id=? AND table_id=(SELECT id FROM master_data_tables WHERE owner_user_id=? AND name='marketing_campaign_outcomes') AND json_extract(row_json,'$.provider_reference')='wa-send-1'`).get(ownerB, ownerB);
  const legacySendData = JSON.parse(legacySendRow.row_json);
  legacySendData.audience_hash = createHash('sha256').update(`${ownerB}:+6590057664`).digest('hex');
  handle.prepare(`UPDATE master_data_rows SET row_json=? WHERE id=?`).run(JSON.stringify(legacySendData), legacySendRow.id);
  const repairedSend = svc.getMarketingWorkspace(ownerB).records.outcomes.find((row) => row.provider_reference === 'wa-send-1');
  assert.equal(repairedSend.audience_hash, waHash, 'legacy send receipt hash is normalized through its unique campaign audience member');
  const normalCompanyChat = svc.correlateMarketingInbound(ownerB, { channel: 'whatsapp', sender_id: '+6590057664', content: 'What are my open tasks?', message_id: 'wa-owner-chat-1', observed_at: '2026-09-28T14:20:00.000Z', company_actor: { user_id: ownerB, role: 'ceo', name: 'Marketing B' } });
  assert.equal(normalCompanyChat.matched, false);
  assert.equal(normalCompanyChat.reason, 'company_user_normal_chat', 'ordinary CEO chat is not converted into a campaign response');
  const internalCampaignTest = svc.correlateMarketingInbound(ownerB, { channel: 'whatsapp', sender_id: '+6590057664', content: 'INTERESTED', message_id: 'wa-owner-campaign-test-1', observed_at: '2026-09-28T14:20:30.000Z', company_actor: { user_id: ownerB, role: 'ceo', name: 'Marketing B' } });
  assert.equal(internalCampaignTest.matched, true);
  assert.equal(internalCampaignTest.normal_chat, true);
  assert.equal(internalCampaignTest.lead, null, 'a CEO campaign-response test is evidence, not a sales lead');
  const inbound = svc.correlateMarketingInbound(ownerB, { channel: 'whatsapp', sender_id: '6590057664:1@s.whatsapp.net', content: 'INTERESTED', message_id: 'wa-inbound-1', observed_at: '2026-09-28T14:21:33.000Z', transport_agent_id: 'balserve' });
  assert.equal(inbound.matched, true, 'an inbound reply is attributed to the recent send for the same audience member');
  assert.equal(inbound.classification.intent, 'positive_interest');
  assert.equal(inbound.lead.status, 'qualified', 'a consented WhatsApp reply prepares a qualified lead');
  assert.equal(inbound.lead.followup_status, 'pending');
  assert.equal(inbound.lead.owner_agent, 'marketing-specialist-test', 'campaign owner agent owns follow-up instead of the transport agent');
  assert.equal(svc.correlateMarketingInbound(ownerB, { channel: 'whatsapp', sender_id: '+6590057664', content: 'INTERESTED', message_id: 'wa-inbound-1', observed_at: '2026-09-28T14:21:33.000Z' }).idempotent, true, 'gateway retries do not duplicate inbound evidence');
  assert.equal(svc.getMarketingWorkspace(ownerB).records.engagements.filter((row) => row.event_id === inbound.engagement.event_id).length, 1);
  assert.equal(svc.correlateMarketingInbound(ownerB, { channel: 'whatsapp', sender_id: '+6599998888', content: 'INTERESTED', message_id: 'wa-inbound-unmatched', observed_at: '2026-09-28T14:22:00.000Z' }).reason, 'sender_not_in_distribution_lists', 'unknown senders are not assigned to a campaign');

  svc.upsertMarketingRecord(ownerB, 'distributionLists', { list_id: 'email-replies', name: 'Email campaign replies', default_channel: 'email' });
  svc.upsertMarketingRecord(ownerB, 'distributionMembers', { member_id: 'email-reply-member', list_id: 'email-replies', display_label: 'Interested email prospect', channel: 'email', destination: 'reply.prospect@example.invalid', consent_status: 'granted', consent_source: 'Owner-provided campaign contact' });
  svc.upsertMarketingRecord(ownerB, 'campaigns', { campaign_id: 'email-agentic-campaign', name: 'Email agentic campaign', goal: 'Generate qualified email leads', status: 'active', channels: ['email'], audience_list_ids: ['email-replies'], content_topics: ['AI operations'], owner_agent: 'marketing-specialist-test' });
  svc.upsertMarketingRecord(ownerB, 'assets', { asset_id: 'email-agentic-asset', campaign_id: 'email-agentic-campaign', name: 'Email reply campaign', channel: 'email', content: 'Reply INTERESTED to learn more', variables: { response_keywords: ['interested'] }, approval_status: 'approved' });
  const emailReplyHash = createHash('sha256').update(`${ownerB}:reply.prospect@example.invalid`).digest('hex');
  svc.recordMarketingOutcome(ownerB, { campaign_id: 'email-agentic-campaign', asset_id: 'email-agentic-asset', channel: 'email', outcome_type: 'send_accepted', audience_hash: emailReplyHash, recipient_label: 'Interested email prospect', provider_reference: 'email-send-1', observed_at: '2026-09-28T15:00:00.000Z' });
  const emailInbound = svc.correlateMarketingInbound(ownerB, { channel: 'email', sender_id: 'reply.prospect@example.invalid', content: 'INTERESTED — please send me details.', message_id: 'email-reply-provider-1', observed_at: '2026-09-28T15:10:00.000Z' });
  assert.equal(emailInbound.matched, true, 'an inbound email reply is attributed to the most recent send for the same address');
  assert.equal(emailInbound.classification.intent, 'positive_interest');
  assert.equal(emailInbound.lead.status, 'qualified', 'a consented email reply prepares a qualified Marketing lead');
  assert.equal(emailInbound.lead.owner_agent, 'marketing-specialist-test');

  const optOut = svc.correlateMarketingInbound(ownerB, { channel: 'whatsapp', sender_id: '+6590057664', content: 'STOP', message_id: 'wa-inbound-stop', observed_at: '2026-09-28T14:23:00.000Z' });
  assert.equal(optOut.classification.outcome_type, 'opt_out');
  assert.equal(optOut.lead.status, 'suppressed');
  assert.equal(optOut.lead.eligible_for_followup, 'false');
  assert.equal(svc.getMarketingWorkspace(ownerB).records.distributionMembers.find((row) => row.member_id === 'wa-reply-member').consent_status, 'denied', 'standard opt-out suppresses future campaign contact');

  const audienceList = svc.upsertMarketingRecord(ownerB, 'distributionLists', { list_id: 'manual-prospects', name: 'Manual prospects', default_channel: 'email' });
  assert.equal(audienceList.created, true);
  const audienceMember = svc.upsertMarketingRecord(ownerB, 'distributionMembers', { member_id: 'manual-prospect-1', list_id: 'manual-prospects', display_label: 'Manual prospect', channel: 'email', destination: 'prospect@example.invalid', consent_status: 'granted', consent_source: 'Owner-provided test contact' });
  assert.equal(audienceMember.record.destination_encrypted, undefined, 'encrypted destination is not returned by the upsert contract');
  const legacyMemberRow = handle.prepare(`SELECT id,row_json FROM master_data_rows WHERE owner_user_id=? AND table_id=(SELECT id FROM master_data_tables WHERE owner_user_id=? AND name='marketing_distribution_list_members') AND json_extract(row_json,'$.member_id')='manual-prospect-1'`).get(ownerB, ownerB);
  const legacyMemberData = JSON.parse(legacyMemberRow.row_json);
  legacyMemberData.destination_hash = '';
  handle.prepare(`UPDATE master_data_rows SET row_json=? WHERE id=?`).run(JSON.stringify(legacyMemberData), legacyMemberRow.id);
  const manualAudienceWorkspace = svc.getMarketingWorkspace(ownerB);
  assert.equal(manualAudienceWorkspace.records.distributionMembers.find((row) => row.member_id === 'manual-prospect-1').destination, 'prospect@example.invalid', 'authorized workspace resolves encrypted contact destination');
  assert.equal(manualAudienceWorkspace.records.distributionMembers.find((row) => row.member_id === 'manual-prospect-1').destination_hash, createHash('sha256').update(`${ownerB}:prospect@example.invalid`).digest('hex'), 'legacy audience identity hash is repaired from the encrypted destination');
  const repairedMemberData = JSON.parse(handle.prepare(`SELECT row_json FROM master_data_rows WHERE id=?`).get(legacyMemberRow.id).row_json);
  assert.notEqual(repairedMemberData.destination_hash, '', 'legacy identity repair persists for later inbound correlation');
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
  assert.equal(qualified.record.status, 'crm_synced', 'an existing CRM opportunity marks the Marketing row as linked');
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

  svc.upsertMarketingRecord(ownerA, 'distributionLists', { list_id: 'crm-handoff-list', name: 'CRM handoff prospects', default_channel: 'email' });
  const handoffMember = svc.upsertMarketingRecord(ownerA, 'distributionMembers', { member_id: 'crm-handoff-member', list_id: 'crm-handoff-list', display_label: 'Qualified handoff prospect', channel: 'email', destination: 'qualified.handoff@example.invalid', consent_status: 'granted', consent_source: 'Test consent' }).record;
  svc.upsertMarketingRecord(ownerA, 'campaigns', { campaign_id: 'crm-handoff-campaign', name: 'CRM handoff campaign', status: 'active', goal: 'Validate one-click CRM handoff', channels: ['email'], audience_list_ids: ['crm-handoff-list'] });
  svc.upsertMarketingRecord(ownerA, 'engagements', { event_id: 'crm-handoff-reply', campaign_id: 'crm-handoff-campaign', channel: 'email', event_type: 'reply', audience_hash: handoffMember.destination_hash, source: 'provider_webhook' });
  const handoffReady = svc.prepareMarketingLead(ownerA, { identity_reference: 'qualified.handoff@example.invalid', display_label: 'Qualified handoff prospect', opportunity_key: 'crm-handoff-campaign', opportunity_summary: 'Qualified campaign response', campaign_ids: ['crm-handoff-campaign'], channels: ['email'], engagement_event_ids: ['crm-handoff-reply'], consent: { email: 'granted' }, followup_status: 'pending', followup_channel: 'email' });
  assert.equal(handoffReady.record.status, 'qualified');
  assert.equal(handoffReady.record.eligible_for_followup, 'true');
  let crmPersonCreates = 0;
  let crmLeadCreates = 0;
  const crmAdapter = {
    provider: 'twenty',
    listPeople: async () => ({ mode: 'live', people: [] }),
    createPerson: async ({ email, idempotency_key }) => { crmPersonCreates += 1; assert.equal(email, 'qualified.handoff@example.invalid'); assert.equal(idempotency_key, `marketing-crm-person:${handoffReady.record.lead_id}`); return { person: { id: 'crm-person-handoff-1' } }; },
    createLead: async ({ pointOfContactId, idempotency_key }) => { crmLeadCreates += 1; assert.equal(pointOfContactId, 'crm-person-handoff-1'); assert.equal(idempotency_key, `marketing-crm-lead:${handoffReady.record.lead_id}`); return { opportunity: { id: 'crm-lead-handoff-1' } }; },
  };
  const handedOff = await svc.handoffMarketingLeadToCrm(ownerA, { lead_id: handoffReady.record.lead_id }, { adapter: crmAdapter });
  assert.equal(handedOff.lead.status, 'crm_synced');
  assert.equal(handedOff.lead.crm_person_reference, 'crm-person-handoff-1');
  assert.equal(handedOff.lead.crm_lead_reference, 'crm-lead-handoff-1');
  assert.equal(handedOff.lead.crm_opportunity_reference, 'crm-lead-handoff-1');
  const handoffRetry = await svc.handoffMarketingLeadToCrm(ownerA, { lead_id: handoffReady.record.lead_id }, { adapter: crmAdapter });
  assert.equal(handoffRetry.idempotent, true, 'CRM handoff retry returns the linked record');
  assert.equal(crmPersonCreates, 1, 'CRM person is created once');
  assert.equal(crmLeadCreates, 1, 'CRM lead is created once');
  svc.upsertMarketingRecord(ownerA, 'distributionMembers', { member_id: 'crm-handoff-whatsapp-member', list_id: 'crm-handoff-list', display_label: 'Qualified WhatsApp prospect', channel: 'whatsapp', destination: '6593482490', consent_status: 'granted', consent_source: 'Test consent' });
  const whatsappMember = svc.getMarketingWorkspace(ownerA).records.distributionMembers.find((row) => row.member_id === 'crm-handoff-whatsapp-member');
  svc.upsertMarketingRecord(ownerA, 'campaigns', { campaign_id: 'crm-handoff-whatsapp-campaign', name: 'CRM WhatsApp handoff campaign', status: 'active', goal: 'Validate E.164 CRM handoff', channels: ['whatsapp'], audience_list_ids: ['crm-handoff-list'] });
  svc.upsertMarketingRecord(ownerA, 'engagements', { event_id: 'crm-handoff-whatsapp-reply', campaign_id: 'crm-handoff-whatsapp-campaign', channel: 'whatsapp', event_type: 'reply', audience_hash: whatsappMember.destination_hash, source: 'provider_webhook' });
  const whatsappHandoffReady = svc.prepareMarketingLead(ownerA, { identity_reference: '6593482490', display_label: 'Qualified WhatsApp prospect', opportunity_key: 'crm-handoff-whatsapp-campaign', opportunity_summary: 'Qualified WhatsApp response', campaign_ids: ['crm-handoff-whatsapp-campaign'], channels: ['whatsapp'], engagement_event_ids: ['crm-handoff-whatsapp-reply'], consent: { whatsapp: 'granted' }, followup_status: 'pending', followup_channel: 'whatsapp' });
  const whatsappCrmAdapter = {
    provider: 'twenty',
    listPeople: async () => ({ mode: 'live', people: [] }),
    createPerson: async ({ phone }) => { assert.equal(phone, '+6593482490', 'CRM person phone uses E.164 format'); return { person: { id: 'crm-person-whatsapp-1' } }; },
    createLead: async ({ phone, pointOfContactId }) => { assert.equal(phone, '+6593482490', 'CRM lead phone uses E.164 format'); assert.equal(pointOfContactId, 'crm-person-whatsapp-1'); return { opportunity: { id: 'crm-lead-whatsapp-1' } }; },
  };
  const whatsappHandedOff = await svc.handoffMarketingLeadToCrm(ownerA, { lead_id: whatsappHandoffReady.record.lead_id }, { adapter: whatsappCrmAdapter });
  assert.equal(whatsappHandedOff.lead.status, 'crm_synced');
  await assert.rejects(
    () => svc.handoffMarketingLeadToCrm(ownerB, { lead_id: handoffReady.record.lead_id }, { adapter: crmAdapter }),
    (error) => error.code === 'MARKETING_LEAD_NOT_FOUND',
    'CRM handoff cannot access another owner lead',
  );
  const notReady = svc.prepareMarketingLead(ownerA, { identity_reference: 'open.only@example.invalid', display_label: 'Open only', opportunity_key: 'open-only', channels: ['email'], engagement_event_ids: [opened.record.event_id], consent: { email: 'granted' }, followup_channel: 'email' });
  await assert.rejects(
    () => svc.handoffMarketingLeadToCrm(ownerA, { lead_id: notReady.record.lead_id }, { adapter: crmAdapter }),
    (error) => error.code === 'MARKETING_LEAD_NOT_READY',
    'unqualified evidence cannot be handed to CRM',
  );
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
  assert.ok(role.tools.includes('marketing_crm_handoff'));
  assert.ok(role.tools.includes('connector_execute_action'));

  const toolRows = handle.prepare(`SELECT name,risk_tier,action_family FROM content_tools_meta WHERE name LIKE 'marketing_%' ORDER BY name`).all();
  const toolNames = toolRows.map((row) => row.name);
  assert.equal(toolNames.length, 21);
  assert.equal(toolRows.find((row) => row.name === 'marketing_workspace_read')?.action_family, 'read');
  assert.equal(toolRows.find((row) => row.name === 'marketing_campaign_upsert')?.action_family, 'write_internal');
  assert.equal(toolRows.find((row) => row.name === 'marketing_channel_send')?.action_family, 'communicate_external');
  assert.equal(toolRows.find((row) => row.name === 'marketing_channel_send')?.risk_tier, 'R2');
  assert.equal(toolRows.find((row) => row.name === 'marketing_crm_handoff')?.risk_tier, 'R1');
  assert.equal(svc.getMarketingWorkspace(ownerA).records.strategies.length, 7, 'each supported channel has an effectiveness strategy');
  svc.upsertMarketingRecord(ownerA, 'engagements', { event_id: 'old-event', channel: 'email', event_type: 'open_signal', observed_at: '2020-01-01T00:00:00.000Z' });
  svc.recordMarketingOutcome(ownerA, { outcome_id: 'old-outcome', campaign_id: 'campaign-growth-q4', channel: 'facebook', outcome_type: 'reaction', observed_at: '2020-01-01T00:00:00.000Z' });
  svc.upsertMarketingRecord(ownerA, 'distributionLists', { list_id: 'old-list', name: 'Old list', default_channel: 'email' });
  svc.upsertMarketingRecord(ownerA, 'distributionMembers', { member_id: 'old-member', list_id: 'old-list', display_label: 'Old member', channel: 'email', destination: 'old@example.invalid', consent_status: 'granted', created_at: '2020-01-01T00:00:00.000Z' });
  const purged = await purgeOwnerRetention(ownerA, { days: 30 });
  assert.ok(purged.deleted.marketing_engagement_events >= 1, 'engagement history follows owner retention');
  assert.ok(purged.deleted.marketing_campaign_outcomes >= 1, 'campaign outcome ledger follows owner retention');
  assert.ok(purged.deleted.marketing_distribution_list_members >= 1, 'manual audience contacts follow owner retention');
  console.log(JSON.stringify({ ok: true, checks: ['configured-channel-transport-resolution', 'knowledge-backed-storage', 'upsert-idempotency', 'metric-idempotency', 'outcome-ledger-idempotency', 'cross-channel-outcomes', 'company-user-vs-contact-precedence', 'campaign-response-contract', 'inbound-campaign-attribution', 'inbound-idempotency', 'inbound-opt-out-suppression', 'marketing-followup-ownership', 'legacy-audience-identity-repair', 'legacy-send-receipt-identity-repair', 'legacy-email-reconciliation', 'owner-isolation', 'secret-rejection', 'signed-open-pixel', 'pixel-idempotency', 'cross-campaign-lead-correlation', 'distinct-opportunities', 'structured-followup-update', 'crm-handoff', 'crm-handoff-idempotency', 'crm-handoff-owner-isolation', 'crm-handoff-readiness-gate', 'suppression-gate', 'browser-watch-cycle', 'agentic-campaign-configuration', 'run-readiness-contract', 'paid-budget-gate', 'channel-strategies', 'retention', 'hireable-template', 'existing-template-grant-reconciliation', 'tool-registry'] }, null, 2));
} finally {
  try { handle?.close(); } catch {}
  rmSync(root, { recursive: true, force: true });
}
