import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import './MarketingWorkspace.css';

const CHANNELS = ['email', 'whatsapp', 'facebook', 'google_ads', 'linkedin', 'instagram', 'telemarketing'];
const TABS = ['Overview', 'Campaigns', 'Templates & assets', 'Channels', 'Analytics', 'Leads & follow-up'];
const EMPTY_CAMPAIGN = { name: '', objective_id: '', status: 'draft', channels: [], audience_crm_filter: '', crm_reference: '', budget_total: '', budget_daily: '', currency: 'USD', goal: '', owner_agent: '', notes: '' };
const EMPTY_ASSET = { name: '', campaign_id: '', channel: 'email', asset_type: 'template', subject: '', content: '', variables_json: '{\n  "first_name": "Customer"\n}', approval_status: 'draft', version: '1' };
const EMPTY_CHANNEL = { channel: 'email', enabled: false, execution_mode: 'draft_only', connector_type: 'open_connector', connector_id: '', account_reference: '', sender_reference: '', config_json: '{}', readiness_status: 'not_configured' };
const EMPTY_METRIC = { campaign_id: '', channel: 'email', metric_name: 'impressions', value: '', unit: 'count', period_start: '', period_end: '', source: 'manual', receipt_id: '' };
const EMPTY_WATCH = { campaign_id: '', asset_id: '', channel: 'facebook', target_reference: '', recipe_name: '', cadence_minutes: '60', enabled: true };
const EMPTY_TRACKING = { campaign_id: '', asset_id: '', audience_reference: '', recipient_label: '', expires_days: '90' };
const EMPTY_LEAD = { identity_reference: '', crm_person_reference: '', display_label: '', opportunity_key: '', opportunity_summary: '', interests: '', engagement_event_ids: '', owner_agent: 'marketing-specialist' };

function dataRows(workspace, key) { return workspace?.records?.[key] || []; }
function money(value, currency = 'USD') {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount) : '—';
}

export default function MarketingWorkspace() {
  const [tab, setTab] = useState('Overview');
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [campaign, setCampaign] = useState(EMPTY_CAMPAIGN);
  const [asset, setAsset] = useState(EMPTY_ASSET);
  const [channel, setChannel] = useState(EMPTY_CHANNEL);
  const [metric, setMetric] = useState(EMPTY_METRIC);
  const [watch, setWatch] = useState(EMPTY_WATCH);
  const [tracking, setTracking] = useState(EMPTY_TRACKING);
  const [trackingResult, setTrackingResult] = useState(null);
  const [analyticsCampaignId, setAnalyticsCampaignId] = useState('');
  const [lead, setLead] = useState(EMPTY_LEAD);

  const load = useCallback(async () => {
    setLoading(true);
    try { setWorkspace(await api.marketingWorkspace()); setMessage(null); }
    catch (error) { setMessage({ type: 'error', text: error.message || 'Could not load Marketing.' }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (kind, fn, value, reset) => {
    setBusy(kind); setMessage(null);
    try {
      await fn(value);
      setMessage({ type: 'success', text: `${kind} saved.` });
      reset(); await load();
    } catch (error) { setMessage({ type: 'error', text: error.message || `Could not save ${kind.toLowerCase()}.` }); }
    finally { setBusy(''); }
  };

  const summary = workspace?.analytics || {};
  const campaigns = dataRows(workspace, 'campaigns');
  const assets = dataRows(workspace, 'assets');
  const channels = dataRows(workspace, 'channels');
  const metrics = dataRows(workspace, 'metrics');
  const engagements = dataRows(workspace, 'engagements');
  const outcomes = dataRows(workspace, 'outcomes');
  const watches = dataRows(workspace, 'watches');
  const strategies = dataRows(workspace, 'strategies');
  const leads = dataRows(workspace, 'leads');
  const metricCards = useMemo(() => Object.entries(summary.totals || {}).slice(0, 8), [summary.totals]);
  const campaignReports = summary.campaign_reports || [];
  const selectedReport = campaignReports.find((row) => row.campaign_id === analyticsCampaignId) || campaignReports[0] || null;
  const selectedOutcomes = outcomes.filter((row) => !selectedReport || row.campaign_id === selectedReport.campaign_id).slice().reverse();

  if (loading && !workspace) return <main className="marketing-page"><div className="marketing-loading">Preparing your marketing workspace…</div></main>;

  return (
    <main className="marketing-page">
      <header className="marketing-hero">
        <div>
          <span className="marketing-eyebrow">Run &amp; Operate</span>
          <h1>Marketing</h1>
          <p>Plan campaigns, reuse channel-ready content, coordinate CRM audiences, and measure outcomes in one company workspace.</p>
        </div>
        <div className="marketing-hero-actions">
          <Link to="/crm" className="marketing-link">Open CRM</Link>
          <Link to="/master-data" className="marketing-link">View Knowledge</Link>
          <Link to="/connectors" className="marketing-primary">Configure connectors</Link>
        </div>
      </header>

      <aside className="marketing-safety">
        <strong>Safe channel setup:</strong> Marketing stores connector references and operating settings only. Add OAuth connections and credentials in Connectors. External sends and publishing remain governed by Action Control.
      </aside>

      {message && <div className={`marketing-message ${message.type}`} role="status">{message.text}</div>}
      <nav className="marketing-tabs" aria-label="Marketing workspace sections">
        {TABS.map((name) => <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>)}
      </nav>

      {tab === 'Overview' && <section className="marketing-section">
        <div className="marketing-stat-grid">
          <Stat label="Campaigns" value={summary.campaign_count || 0} detail={`${summary.active_campaign_count || 0} active`} />
          <Stat label="Reusable assets" value={summary.asset_count || 0} detail="Templates and creative" />
          <Stat label="Enabled channels" value={summary.enabled_channel_count || 0} detail={`of ${CHANNELS.length} supported`} />
          <Stat label="Metric records" value={summary.metric_count || 0} detail="Provider or receipt observations" />
          <Stat label="Follow-up leads" value={summary.followup_lead_count || 0} detail={`${summary.qualified_lead_count || 0} qualified or CRM synced`} />
        </div>
        <div className="marketing-two-col">
          <Panel title="Campaign control room" subtitle="Objectives, audiences, budgets and channel mix stay together.">
            {campaigns.length ? campaigns.slice(0, 5).map((row) => <RecordLine key={row.row_id} title={row.name} badge={row.status} detail={(parseJson(row.channels_json, []) || []).join(' · ') || 'No channels selected'} />) : <Empty text="Create your first campaign plan." action={() => setTab('Campaigns')} />}
          </Panel>
          <Panel title="Channel readiness" subtitle="Execution uses existing Connectors and browser recipes.">
            {CHANNELS.map((name) => { const row = channels.find((x) => x.channel === name); return <RecordLine key={name} title={label(name)} badge={row?.enabled === 'true' ? 'Enabled' : 'Off'} detail={row?.readiness_status || 'Not configured'} />; })}
          </Panel>
        </div>
      </section>}

      {tab === 'Campaigns' && <section className="marketing-section marketing-two-col">
        <Panel title={campaign.campaign_id ? 'Edit campaign' : 'New campaign'} subtitle="Link execution to an OKR and a CRM audience without copying customer data.">
          <form onSubmit={(e) => { e.preventDefault(); save('Campaign', api.marketingCampaignUpsert, campaign, () => setCampaign(EMPTY_CAMPAIGN)); }} className="marketing-form">
            <Field label="Campaign name"><input required value={campaign.name} onChange={(e) => setCampaign({ ...campaign, name: e.target.value })} /></Field>
            <div className="marketing-form-row"><Field label="Objective ID"><input value={campaign.objective_id} onChange={(e) => setCampaign({ ...campaign, objective_id: e.target.value })} /></Field><Field label="Status"><select value={campaign.status} onChange={(e) => setCampaign({ ...campaign, status: e.target.value })}><option>draft</option><option>active</option><option>paused</option><option>completed</option></select></Field></div>
            <Field label="Channels"><div className="marketing-checks">{CHANNELS.map((name) => <label key={name}><input type="checkbox" checked={campaign.channels.includes(name)} onChange={(e) => setCampaign({ ...campaign, channels: e.target.checked ? [...campaign.channels, name] : campaign.channels.filter((x) => x !== name) })} />{label(name)}</label>)}</div></Field>
            <Field label="CRM audience filter"><input placeholder="Example: lifecycleStage=Customer; country=SG" value={campaign.audience_crm_filter} onChange={(e) => setCampaign({ ...campaign, audience_crm_filter: e.target.value })} /></Field>
            <Field label="CRM list or segment reference"><input value={campaign.crm_reference} onChange={(e) => setCampaign({ ...campaign, crm_reference: e.target.value })} /></Field>
            <div className="marketing-form-row"><Field label="Total budget"><input type="number" min="0" step="0.01" value={campaign.budget_total} onChange={(e) => setCampaign({ ...campaign, budget_total: e.target.value })} /></Field><Field label="Daily budget"><input type="number" min="0" step="0.01" value={campaign.budget_daily} onChange={(e) => setCampaign({ ...campaign, budget_daily: e.target.value })} /></Field></div>
            <Field label="Outcome goal"><textarea rows="3" value={campaign.goal} onChange={(e) => setCampaign({ ...campaign, goal: e.target.value })} /></Field>
            <FormActions busy={busy === 'Campaign'} edit={!!campaign.campaign_id} clear={() => setCampaign(EMPTY_CAMPAIGN)} />
          </form>
        </Panel>
        <Panel title="Campaign portfolio" subtitle="Edit a plan without duplicating it.">
          {campaigns.length ? campaigns.map((row) => <RecordLine key={row.row_id} title={row.name} badge={row.status} detail={`${money(row.budget_total, row.currency)} · ${row.goal || 'No outcome goal'}`} action={() => { setCampaign({ ...EMPTY_CAMPAIGN, ...row, channels: parseJson(row.channels_json, []) }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />) : <Empty text="No campaigns yet." />}
        </Panel>
      </section>}

      {tab === 'Templates & assets' && <section className="marketing-section marketing-two-col">
        <Panel title={asset.asset_id ? 'Edit asset' : 'New reusable asset'} subtitle="Store email templates, social copy, ad creative briefs, WhatsApp scripts and call scripts.">
          <form onSubmit={(e) => { e.preventDefault(); save('Asset', api.marketingAssetUpsert, asset, () => setAsset(EMPTY_ASSET)); }} className="marketing-form">
            <Field label="Name"><input required value={asset.name} onChange={(e) => setAsset({ ...asset, name: e.target.value })} /></Field>
            <div className="marketing-form-row"><Field label="Channel"><ChannelSelect value={asset.channel} onChange={(channel) => setAsset({ ...asset, channel })} /></Field><Field label="Asset type"><select value={asset.asset_type} onChange={(e) => setAsset({ ...asset, asset_type: e.target.value })}><option>template</option><option>post</option><option>ad_copy</option><option>call_script</option><option>landing_copy</option><option>creative_brief</option></select></Field></div>
            <Field label="Campaign"><select value={asset.campaign_id} onChange={(e) => setAsset({ ...asset, campaign_id: e.target.value })}><option value="">Reusable across campaigns</option>{campaigns.map((x) => <option key={x.campaign_id} value={x.campaign_id}>{x.name}</option>)}</select></Field>
            <Field label="Subject / headline"><input value={asset.subject} onChange={(e) => setAsset({ ...asset, subject: e.target.value })} /></Field>
            <Field label="Content"><textarea required rows="8" value={asset.content} onChange={(e) => setAsset({ ...asset, content: e.target.value })} /></Field>
            <Field label="Template variables (JSON)"><textarea className="marketing-code" rows="4" value={asset.variables_json} onChange={(e) => setAsset({ ...asset, variables_json: e.target.value })} /></Field>
            <div className="marketing-form-row"><Field label="Approval state"><select value={asset.approval_status} onChange={(e) => setAsset({ ...asset, approval_status: e.target.value })}><option>draft</option><option>approved</option><option>retired</option></select></Field><Field label="Version"><input value={asset.version} onChange={(e) => setAsset({ ...asset, version: e.target.value })} /></Field></div>
            <FormActions busy={busy === 'Asset'} edit={!!asset.asset_id} clear={() => setAsset(EMPTY_ASSET)} />
          </form>
        </Panel>
        <Panel title="Asset library" subtitle={`${assets.length} saved asset${assets.length === 1 ? '' : 's'}`}>
          {assets.length ? assets.map((row) => <RecordLine key={row.row_id} title={row.name} badge={label(row.channel)} detail={`${label(row.asset_type)} · v${row.version} · ${row.approval_status}`} action={() => setAsset({ ...EMPTY_ASSET, ...row })} />) : <Empty text="No reusable assets yet." />}
        </Panel>
      </section>}

      {tab === 'Channels' && <section className="marketing-section marketing-two-col">
        <Panel title="Channel operating setup" subtitle="Reference an existing connection; do not enter credentials here.">
          <form onSubmit={(e) => { e.preventDefault(); save('Channel', api.marketingChannelUpsert, channel, () => setChannel(EMPTY_CHANNEL)); }} className="marketing-form">
            <div className="marketing-form-row"><Field label="Channel"><ChannelSelect value={channel.channel} onChange={(value) => setChannel({ ...channel, channel: value })} /></Field><Field label="Execution mode"><select value={channel.execution_mode} onChange={(e) => setChannel({ ...channel, execution_mode: e.target.value })}><option value="draft_only">Draft only</option><option value="approval_required">Approval required</option><option value="policy_controlled">Policy controlled</option></select></Field></div>
            <label className="marketing-switch"><input type="checkbox" checked={!!channel.enabled} onChange={(e) => setChannel({ ...channel, enabled: e.target.checked })} /><span>Enable this channel for campaign planning</span></label>
            <div className="marketing-form-row"><Field label="Connector type"><input value={channel.connector_type} onChange={(e) => setChannel({ ...channel, connector_type: e.target.value })} /></Field><Field label="Connector ID"><input value={channel.connector_id} onChange={(e) => setChannel({ ...channel, connector_id: e.target.value })} /></Field></div>
            <Field label="Account reference"><input placeholder="Non-secret provider account/page reference" value={channel.account_reference} onChange={(e) => setChannel({ ...channel, account_reference: e.target.value })} /></Field>
            <Field label="Sender reference"><input placeholder="Sender identity, page, phone or recipe name" value={channel.sender_reference} onChange={(e) => setChannel({ ...channel, sender_reference: e.target.value })} /></Field>
            <Field label="Non-secret settings (JSON)"><textarea className="marketing-code" rows="5" value={channel.config_json} onChange={(e) => setChannel({ ...channel, config_json: e.target.value })} /></Field>
            <Field label="Readiness"><select value={channel.readiness_status} onChange={(e) => setChannel({ ...channel, readiness_status: e.target.value })}><option value="not_configured">Not configured</option><option value="needs_verification">Needs verification</option><option value="ready">Ready</option><option value="error">Error</option></select></Field>
            <FormActions busy={busy === 'Channel'} edit={channels.some((x) => x.channel === channel.channel)} clear={() => setChannel(EMPTY_CHANNEL)} />
          </form>
        </Panel>
        <Panel title="Configured channels" subtitle="Publishing tools remain separately permissioned and policy-controlled.">
          {CHANNELS.map((name) => { const row = channels.find((x) => x.channel === name); return <RecordLine key={name} title={label(name)} badge={row?.enabled === 'true' ? 'Enabled' : 'Off'} detail={row ? `${row.readiness_status} · ${row.execution_mode}` : 'Not configured'} action={() => setChannel(row ? { ...EMPTY_CHANNEL, ...row, enabled: row.enabled === 'true' } : { ...EMPTY_CHANNEL, channel: name })} />; })}
        </Panel>
        <Panel title="Add a read-only channel watch" subtitle="Correlate a live post/ad reference with the campaign asset through a saved browser recipe or provider reader.">
          <form onSubmit={(e) => { e.preventDefault(); save('Watch', api.marketingWatchUpsert, watch, () => setWatch(EMPTY_WATCH)); }} className="marketing-form">
            <div className="marketing-form-row"><Field label="Channel"><ChannelSelect value={watch.channel} onChange={(channel) => setWatch({ ...watch, channel })} /></Field><Field label="Cadence (minutes)"><input type="number" min="15" value={watch.cadence_minutes} onChange={(e) => setWatch({ ...watch, cadence_minutes: e.target.value })} /></Field></div>
            <Field label="Campaign"><select value={watch.campaign_id} onChange={(e) => setWatch({ ...watch, campaign_id: e.target.value })}><option value="">Select campaign</option>{campaigns.map((x) => <option key={x.campaign_id} value={x.campaign_id}>{x.name}</option>)}</select></Field>
            <Field label="Stored asset"><select value={watch.asset_id} onChange={(e) => setWatch({ ...watch, asset_id: e.target.value })}><option value="">Select asset</option>{assets.filter((x) => !watch.campaign_id || !x.campaign_id || x.campaign_id === watch.campaign_id).map((x) => <option key={x.asset_id} value={x.asset_id}>{x.name}</option>)}</select></Field>
            <Field label="Live post / provider reference"><input required placeholder="Post URL, provider object ID or report reference" value={watch.target_reference} onChange={(e) => setWatch({ ...watch, target_reference: e.target.value })} /></Field>
            <Field label="Saved read-only browser recipe"><input placeholder="Example: Facebook post insights" value={watch.recipe_name} onChange={(e) => setWatch({ ...watch, recipe_name: e.target.value })} /></Field>
            <label className="marketing-switch"><input type="checkbox" checked={!!watch.enabled} onChange={(e) => setWatch({ ...watch, enabled: e.target.checked })} /><span>Enable periodic inspection</span></label>
            <FormActions busy={busy === 'Watch'} edit={!!watch.watch_id} clear={() => setWatch(EMPTY_WATCH)} />
          </form>
        </Panel>
        <Panel title="Effectiveness strategies" subtitle="Signals, scoring and attribution are configurable by channel.">
          {strategies.map((row) => <RecordLine key={row.channel} title={label(row.channel)} badge={`${row.attribution_window_days} day attribution`} detail={`${parseJson(row.tracked_signals_json, []).join(' · ')}${watches.some((x) => x.channel === row.channel && x.enabled === 'true') ? ' · Watch enabled' : ''}`} />)}
        </Panel>
      </section>}

      {tab === 'Analytics' && <section className="marketing-section">
        <Panel title="Campaign outcome report" subtitle="One campaign view across email, WhatsApp, social, ads and telemarketing. Provider receipts and channel-specific signals feed the same retention-managed ledger.">
          <div className="marketing-report-toolbar">
            <Field label="Campaign"><select value={selectedReport?.campaign_id || ''} onChange={(e) => setAnalyticsCampaignId(e.target.value)}><option value="">Select campaign</option>{campaignReports.map((row) => <option key={row.campaign_id} value={row.campaign_id}>{row.campaign_name}</option>)}</select></Field>
          </div>
          {selectedReport ? <>
            <div className="marketing-stat-grid marketing-report-stats">
              <Stat label="Emails sent" value={selectedReport.emails_sent} detail="Receipt-backed sends" />
              <Stat label="Unique email open signals" value={selectedReport.unique_open_signals} detail="Privacy-safe recipient count" />
              <Stat label="Email open rate" value={selectedReport.open_rate_percent == null ? '—' : `${selectedReport.open_rate_percent}%`} detail="Signal only; mail proxies may affect accuracy" />
              <Stat label="Ledger outcomes" value={selectedOutcomes.filter((row) => row.outcome_type !== 'tracking_prepared').length} detail="All channels" />
            </div>
            <div className="marketing-channel-outcomes">
              {Object.entries(selectedReport.channel_outcomes || {}).map(([channelName, channelMetrics]) => <div className="marketing-channel-card" key={channelName}><strong>{label(channelName)}</strong><div>{Object.entries(channelMetrics).filter(([name]) => name !== 'tracking_prepared').map(([name, value]) => <span key={name}>{label(name)} <b>{Number(value).toLocaleString()}</b></span>)}</div></div>)}
            </div>
            <h3 className="marketing-subheading">Email recipient status</h3>
            <div className="marketing-table-wrap"><table className="marketing-table"><thead><tr><th>Recipient</th><th>Delivery</th><th>Open signals</th><th>Last open signal</th></tr></thead><tbody>{selectedReport.recipients.length ? selectedReport.recipients.map((row) => <tr key={row.audience_hash || row.outcome_id}><td><strong>{row.recipient_label}</strong><small>{row.destination_masked || 'Identity protected'}</small></td><td>{label(row.delivery_status)}</td><td>{row.open_count}</td><td>{formatDate(row.last_opened_at)}</td></tr>) : <tr><td colSpan="4">No recipient-level email evidence yet.</td></tr>}</tbody></table></div>
            <h3 className="marketing-subheading">Campaign outcome ledger</h3>
            <div className="marketing-table-wrap"><table className="marketing-table"><thead><tr><th>Channel</th><th>Outcome</th><th>Audience</th><th>Evidence time</th><th>Source</th></tr></thead><tbody>{selectedOutcomes.length ? selectedOutcomes.map((row) => <tr key={row.outcome_id}><td>{label(row.channel)}</td><td><strong>{label(row.outcome_type)}</strong></td><td>{row.recipient_label || row.destination_masked || (row.audience_hash ? `Recipient ${row.audience_hash.slice(0, 8)}` : 'Campaign-wide')}</td><td>{formatDate(row.observed_at)}</td><td>{label(row.source)}</td></tr>) : <tr><td colSpan="5">No outcomes have been captured for this campaign.</td></tr>}</tbody></table></div>
          </> : <Empty text="No campaign outcome report is available yet." />}
        </Panel>
        <div className="marketing-stat-grid">{metricCards.length ? metricCards.map(([name, value]) => <Stat key={name} label={label(name)} value={Number(value).toLocaleString()} detail="Recorded total" />) : <Stat label="No metrics yet" value="—" detail="Record provider results below" />}</div>
        <div className="marketing-two-col">
          <Panel title="Record a campaign metric" subtitle="Provider adapters and agents can use the same idempotent API.">
            <form onSubmit={(e) => { e.preventDefault(); save('Metric', api.marketingMetricRecord, metric, () => setMetric(EMPTY_METRIC)); }} className="marketing-form">
              <Field label="Campaign"><select value={metric.campaign_id} onChange={(e) => setMetric({ ...metric, campaign_id: e.target.value })}><option value="">Company-wide</option>{campaigns.map((x) => <option key={x.campaign_id} value={x.campaign_id}>{x.name}</option>)}</select></Field>
              <div className="marketing-form-row"><Field label="Channel"><ChannelSelect value={metric.channel} onChange={(channel) => setMetric({ ...metric, channel })} /></Field><Field label="Metric"><input required value={metric.metric_name} onChange={(e) => setMetric({ ...metric, metric_name: e.target.value })} /></Field></div>
              <div className="marketing-form-row"><Field label="Value"><input required type="number" step="any" value={metric.value} onChange={(e) => setMetric({ ...metric, value: e.target.value })} /></Field><Field label="Unit"><input value={metric.unit} onChange={(e) => setMetric({ ...metric, unit: e.target.value })} /></Field></div>
              <div className="marketing-form-row"><Field label="Period start"><input type="date" value={metric.period_start} onChange={(e) => setMetric({ ...metric, period_start: e.target.value })} /></Field><Field label="Period end"><input type="date" value={metric.period_end} onChange={(e) => setMetric({ ...metric, period_end: e.target.value })} /></Field></div>
              <Field label="Action receipt / provider event ID"><input value={metric.receipt_id} onChange={(e) => setMetric({ ...metric, receipt_id: e.target.value })} /></Field>
              <FormActions busy={busy === 'Metric'} clear={() => setMetric(EMPTY_METRIC)} />
            </form>
          </Panel>
          <Panel title="Recent observations" subtitle="Metrics remain owner-scoped in Knowledge.">
            {metrics.length ? metrics.slice().reverse().slice(0, 20).map((row) => <RecordLine key={row.row_id} title={label(row.metric_name)} badge={`${row.value} ${row.unit || ''}`} detail={`${label(row.channel)} · ${row.period_end || row.captured_at || 'No period'}`} />) : <Empty text="No campaign statistics have been recorded." />}
          </Panel>
        </div>
        <div className="marketing-two-col">
          <Panel title="Email open tracking setup" subtitle="This setup utility creates the invisible signed image placed in one recipient's HTML email. When a mail client retrieves it, the Campaign Outcome Ledger records an open signal—not guaranteed proof that a person read the message.">
            <form onSubmit={async (e) => { e.preventDefault(); setBusy('Tracking'); try { setTrackingResult(await api.marketingOpenPixelCreate(tracking)); setMessage({ type: 'success', text: 'Signed tracking pixel created.' }); } catch (error) { setMessage({ type: 'error', text: error.message }); } finally { setBusy(''); } }} className="marketing-form">
              <Field label="Campaign"><select required value={tracking.campaign_id} onChange={(e) => setTracking({ ...tracking, campaign_id: e.target.value, asset_id: '' })}><option value="">Select campaign</option>{campaigns.map((x) => <option key={x.campaign_id} value={x.campaign_id}>{x.name}</option>)}</select></Field>
              <Field label="Email asset"><select required value={tracking.asset_id} onChange={(e) => setTracking({ ...tracking, asset_id: e.target.value })}><option value="">Select email template</option>{assets.filter((x) => x.channel === 'email' && (!tracking.campaign_id || !x.campaign_id || x.campaign_id === tracking.campaign_id)).map((x) => <option key={x.asset_id} value={x.asset_id}>{x.name}</option>)}</select></Field>
              <Field label="CRM person / audience reference"><input required value={tracking.audience_reference} onChange={(e) => setTracking({ ...tracking, audience_reference: e.target.value })} /></Field>
              <Field label="Recipient display label"><input placeholder="Example: Priya Shah" value={tracking.recipient_label} onChange={(e) => setTracking({ ...tracking, recipient_label: e.target.value })} /></Field>
              <button className="marketing-primary" disabled={busy === 'Tracking'} type="submit">{busy === 'Tracking' ? 'Generating…' : 'Generate pixel HTML'}</button>
              {trackingResult && <Field label="Paste into the HTML email template"><textarea className="marketing-code" readOnly rows="4" value={trackingResult.html} /></Field>}
            </form>
          </Panel>
          <Panel title="Engagement and follow-up queue" subtitle="Every event remains attributable to its campaign, asset and evidence source.">
            {engagements.length ? engagements.slice().reverse().slice(0, 20).map((row) => <RecordLine key={row.event_id} title={`${label(row.channel)} · ${label(row.event_type)}`} badge={row.followup_status} detail={`${row.campaign_id || 'No campaign'} · ${row.observed_at}`} />) : <Empty text="No engagement evidence has been observed." />}
          </Panel>
        </div>
      </section>}

      {tab === 'Leads & follow-up' && <section className="marketing-section marketing-two-col">
        <Panel title="Prepare or correlate a lead" subtitle="The same CRM person may have multiple opportunities; prior interests remain available without duplicating the person.">
          <form onSubmit={(e) => { e.preventDefault(); save('Lead', api.marketingLeadPrepare, { ...lead, interests: lead.interests.split(',').map((x) => x.trim()).filter(Boolean), engagement_event_ids: lead.engagement_event_ids.split(',').map((x) => x.trim()).filter(Boolean) }, () => setLead(EMPTY_LEAD)); }} className="marketing-form">
            <Field label="Identity reference"><input placeholder="CRM person ID, consented email/phone, or provider identity" value={lead.identity_reference} onChange={(e) => setLead({ ...lead, identity_reference: e.target.value })} /></Field>
            <Field label="Existing CRM person reference"><input value={lead.crm_person_reference} onChange={(e) => setLead({ ...lead, crm_person_reference: e.target.value })} /></Field>
            <Field label="Display label"><input value={lead.display_label} onChange={(e) => setLead({ ...lead, display_label: e.target.value })} /></Field>
            <Field label="Opportunity key"><input required placeholder="Stable product / need / opportunity identifier" value={lead.opportunity_key} onChange={(e) => setLead({ ...lead, opportunity_key: e.target.value })} /></Field>
            <Field label="Opportunity summary"><textarea rows="3" value={lead.opportunity_summary} onChange={(e) => setLead({ ...lead, opportunity_summary: e.target.value })} /></Field>
            <Field label="Demonstrated interests (comma separated)"><input value={lead.interests} onChange={(e) => setLead({ ...lead, interests: e.target.value })} /></Field>
            <Field label="Engagement event IDs (comma separated)"><textarea className="marketing-code" rows="3" value={lead.engagement_event_ids} onChange={(e) => setLead({ ...lead, engagement_event_ids: e.target.value })} /></Field>
            <FormActions busy={busy === 'Lead'} edit={false} clear={() => setLead(EMPTY_LEAD)} />
          </form>
        </Panel>
        <Panel title="Qualified follow-up portfolio" subtitle="CRM references and cumulative interests guide the next best action.">
          {leads.length ? leads.map((row) => <RecordLine key={row.row_id} title={row.display_label || row.crm_person_reference || 'Privacy-safe lead'} badge={`${row.status} · score ${row.score}`} detail={`${row.opportunity_summary || row.opportunity_key} · Interests: ${parseJson(row.interests_json, []).join(', ') || 'not established'} · ${row.recommended_followup}`} />) : <Empty text="No correlated leads yet." />}
        </Panel>
      </section>}
    </main>
  );
}

function parseJson(value, fallback) { try { return JSON.parse(value || '') ?? fallback; } catch { return fallback; } }
function label(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase()); }
function formatDate(value) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
function Stat({ label: name, value, detail }) { return <article className="marketing-stat"><span>{name}</span><strong>{value}</strong><small>{detail}</small></article>; }
function Panel({ title, subtitle, children }) { return <article className="marketing-panel"><header><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</header><div className="marketing-panel-body">{children}</div></article>; }
function Field({ label: name, children }) { return <label className="marketing-field"><span>{name}</span>{children}</label>; }
function ChannelSelect({ value, onChange }) { return <select value={value} onChange={(e) => onChange(e.target.value)}>{CHANNELS.map((name) => <option key={name} value={name}>{label(name)}</option>)}</select>; }
function FormActions({ busy, edit, clear }) { return <div className="marketing-form-actions"><button className="marketing-primary" disabled={busy} type="submit">{busy ? 'Saving…' : edit ? 'Update' : 'Save'}</button><button className="marketing-secondary" type="button" onClick={clear}>Clear</button></div>; }
function RecordLine({ title, badge, detail, action }) { return <div className="marketing-record"><div><strong>{title}</strong><span>{detail}</span></div><div className="marketing-record-side"><em>{badge}</em>{action && <button onClick={action}>Edit</button>}</div></div>; }
function Empty({ text, action }) { return <div className="marketing-empty"><p>{text}</p>{action && <button className="marketing-secondary" onClick={action}>Get started</button>}</div>; }
