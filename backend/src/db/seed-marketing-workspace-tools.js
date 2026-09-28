import { getDb } from './schema.js';
import { writeOpenClawToolsList } from '../services/content-tools-meta.js';

export const MARKETING_WORKSPACE_TOOLS = [
  ['marketing_workspace_read', 'Marketing workspace read', '/api/tools/marketing-workspace-read', 'Read owner-scoped campaigns, reusable assets, channel readiness and aggregate metrics.', 'R0', 'read'],
  ['marketing_campaign_upsert', 'Marketing campaign upsert', '/api/tools/marketing-campaign-upsert', 'Create or update an owner-scoped campaign plan by campaign_id. This does not publish externally.', 'R1', 'write_internal'],
  ['marketing_campaign_configure', 'Marketing campaign configure', '/api/tools/marketing-campaign-configure', 'Configure an owner-scoped campaign plus its assets, channel references, watches and strategies from a CEO intent or Objective. This never performs an external action.', 'R1', 'write_internal'],
  ['marketing_campaign_run_prepare', 'Marketing campaign run prepare', '/api/tools/marketing-campaign-run-prepare', 'Validate objective, budgets, enabled channel readiness and approved assets; return the channel action plan before policy-controlled execution.', 'R0', 'read'],
  ['marketing_asset_upsert', 'Marketing asset upsert', '/api/tools/marketing-asset-upsert', 'Create or update a reusable email, social, ad, WhatsApp or call asset by asset_id. This does not publish externally.', 'R1', 'write_internal'],
  ['marketing_channel_config_upsert', 'Marketing channel config upsert', '/api/tools/marketing-channel-config-upsert', 'Store non-secret channel setup and connector references. Credentials must stay in Connectors.', 'R1', 'write_internal'],
  ['marketing_strategy_upsert', 'Marketing effectiveness strategy upsert', '/api/tools/marketing-strategy-upsert', 'Configure channel signals, scoring, attribution, follow-up and consent strategy.', 'R1', 'write_internal'],
  ['marketing_metric_record', 'Marketing metric record', '/api/tools/marketing-metric-record', 'Idempotently record a numeric campaign metric for analytics.', 'R1', 'write_internal'],
  ['marketing_campaign_outcome_record', 'Marketing campaign outcome record', '/api/tools/marketing-campaign-outcome-record', 'Idempotently append channel-specific evidence to the campaign outcome ledger, such as email open/click/reply, WhatsApp delivered/read/reply, social publish/reaction/comment/share/message/lead, ad conversion, or call outcome.', 'R1', 'write_internal'],
  ['marketing_tracking_pixel_create', 'Marketing tracking pixel create', '/api/tools/marketing-tracking-pixel-create', 'Create a signed privacy-preserving email open pixel for one campaign asset and audience reference. The raw audience reference is not persisted.', 'R1', 'write_internal'],
  ['marketing_channel_send', 'Marketing channel send', '/api/tools/marketing-channel-send', 'Send one approved campaign asset through an owner-scoped paired WhatsApp or Slack company channel. The requested recipient must match the configured bound DM target. Action Control governs every external send.', 'R2', 'communicate_external'],
  ['marketing_engagement_record', 'Marketing engagement record', '/api/tools/marketing-engagement-record', 'Idempotently record owner-scoped channel evidence for follow-up and mirror campaign-bound evidence into the generic campaign outcome ledger.', 'R1', 'write_internal'],
  ['marketing_followup_update', 'Marketing follow-up update', '/api/tools/marketing-followup-update', 'Mark an engagement follow-up pending, completed, suppressed or failed with evidence.', 'R1', 'write_internal'],
  ['marketing_watch_upsert', 'Marketing watch upsert', '/api/tools/marketing-watch-upsert', 'Configure a read-only periodic channel watch tied to a campaign asset, live post reference and saved browser recipe.', 'R1', 'write_internal'],
  ['marketing_watches_due', 'Marketing watches due', '/api/tools/marketing-watches-due', 'List owner-scoped enabled channel watches due for read-only inspection.', 'R0', 'read'],
  ['marketing_watch_result_record', 'Marketing watch result record', '/api/tools/marketing-watch-result-record', 'Record a read-only watch snapshot, insight and idempotent engagement events.', 'R1', 'write_internal'],
  ['marketing_lead_prepare', 'Marketing lead prepare', '/api/tools/marketing-lead-prepare', 'Create or update one multi-entry lead/opportunity portfolio row, correlate cross-campaign evidence and CRM references, score with channel strategy, enforce suppression, and schedule a qualified follow-up.', 'R1', 'write_internal'],
];

export function seedMarketingWorkspaceToolsIfMissing() {
  const db = getDb();
  const columns = db.prepare('PRAGMA table_info(content_tools_meta)').all().map((column) => column.name);
  if (!columns.includes('risk_tier')) db.exec(`ALTER TABLE content_tools_meta ADD COLUMN risk_tier TEXT DEFAULT ''`);
  if (!columns.includes('action_family')) db.exec(`ALTER TABLE content_tools_meta ADD COLUMN action_family TEXT DEFAULT ''`);
  const insert = db.prepare(`INSERT OR IGNORE INTO content_tools_meta (name,display_name,endpoint,method,purpose,model_used,enabled,is_builtin,risk_tier,action_family) VALUES (?,?,?,'POST',?,'',1,1,?,?)`);
  const update = db.prepare(`UPDATE content_tools_meta SET display_name=?,endpoint=?,method='POST',purpose=?,enabled=1,is_builtin=1,risk_tier=?,action_family=? WHERE name=?`);
  for (const [name, label, endpoint, purpose, tier, family] of MARKETING_WORKSPACE_TOOLS) {
    insert.run(name, label, endpoint, purpose, tier, family);
    update.run(label, endpoint, purpose, tier, family, name);
  }
  let grantsAdded = 0;
  const agentColumns = db.prepare('PRAGMA table_info(agents)').all().map((column) => column.name);
  if (agentColumns.includes('template_base_id')) {
    const specialists = db.prepare(
      `SELECT id FROM agents WHERE LOWER(COALESCE(template_base_id, '')) = 'marketing-specialist'`
    ).all();
    const grant = db.prepare('INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)');
    for (const specialist of specialists) {
      for (const [name] of MARKETING_WORKSPACE_TOOLS) grantsAdded += grant.run(specialist.id, name).changes;
    }
  }
  writeOpenClawToolsList();
  return { tools: MARKETING_WORKSPACE_TOOLS.length, grants_added: grantsAdded };
}
