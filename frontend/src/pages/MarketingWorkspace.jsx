import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import './MarketingWorkspace.css';

const CHANNELS = ['email', 'whatsapp', 'facebook', 'google_ads', 'linkedin', 'instagram', 'telemarketing'];
const TABS = ['Overview', 'Campaigns', 'Audience lists', 'Templates & assets', 'Channels', 'Analytics', 'Leads & follow-up'];
const EMPTY_CAMPAIGN = { name: '', objective_id: '', status: 'draft', channels: [], audience_list_ids: [], audience_crm_filter: '', audience_crm_person_refs: [], crm_reference: '', budget_total: '', budget_daily: '', currency: 'USD', goal: '', strategy_brief: '', content_topics: [], content_cadence: '', content_per_run: '1', stop_conditions: [], scheduled_goal_id: '', owner_agent: '', notes: '' };
const EMPTY_AUDIENCE_LIST = { name: '', description: '', status: 'active', default_channel: 'email' };
const EMPTY_AUDIENCE_MEMBER = { list_id: '', display_label: '', channel: 'email', destination: '', provider: 'manual', provider_reference: '', crm_person_reference: '', consent_status: 'unknown', consent_source: '', consent_at: '', tags: [] };
const EMPTY_ASSET = { name: '', campaign_id: '', channel: 'email', asset_type: 'template', subject: '', content: '', variables_json: '{\n  "first_name": "Customer"\n}', approval_status: 'draft', version: '1' };
const EMPTY_CHANNEL = { channel: 'email', enabled: false, execution_mode: 'draft_only', connector_type: 'open_connector', connector_id: '', account_reference: '', sender_reference: '', config_json: '{}', readiness_status: 'not_configured' };
const EMPTY_METRIC = { campaign_id: '', channel: 'email', metric_name: 'impressions', value: '', unit: 'count', period_start: '', period_end: '', source: 'manual', receipt_id: '' };
const EMPTY_WATCH = { campaign_id: '', asset_id: '', channel: 'facebook', target_reference: '', recipe_name: '', cadence_minutes: '60', enabled: true };
const EMPTY_TRACKING = { campaign_id: '', asset_id: '', audience_reference: '', recipient_label: '', expires_days: '90' };
const EMPTY_LEAD = { lead_id: '', identity_reference: '', identity_hash: '', crm_person_reference: '', crm_lead_reference: '', crm_opportunity_reference: '', display_label: '', opportunity_key: '', opportunity_summary: '', campaign_ids: [], channels: [], interests: [], engagement_event_ids: [], lifecycle_stage: 'new', consent_state: 'unknown', followup_status: 'not_ready', followup_channel: '', followup_due_at: '', next_action: '', owner_agent: 'marketing-specialist' };
const LIFECYCLE_STAGES = ['new', 'engaged', 'marketing_qualified', 'sales_qualified', 'proposal', 'converted', 'closed'];
const FOLLOWUP_STATES = ['not_ready', 'pending', 'scheduled', 'in_progress', 'completed', 'suppressed'];

function dataRows(workspace, key) { return workspace?.records?.[key] || []; }
function money(value, currency = 'USD') {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount) : '—';
}

function contactPoints(person) {
  const profiles = person.channel_profiles || {};
  return [
    person.email && `Email: ${person.email}`,
    person.phone && `WhatsApp/phone: ${person.phone}`,
    profiles.facebook && `Facebook: ${profiles.facebook}`,
    profiles.linkedin && `LinkedIn: ${profiles.linkedin}`,
    profiles.instagram && `Instagram: ${profiles.instagram}`,
  ].filter(Boolean).join(' · ') || person.company_label || 'No channel contact point in CRM';
}

function destinationLabel(channel) {
  if (channel === 'email') return 'Email address';
  if (['whatsapp', 'telemarketing'].includes(channel)) return 'International phone number';
  if (channel === 'google_ads') return 'Provider audience ID';
  return 'Provider identity / profile reference';
}

function destinationPlaceholder(channel) {
  if (channel === 'email') return 'name@example.com';
  if (['whatsapp', 'telemarketing'].includes(channel)) return '+6591234567';
  if (channel === 'google_ads') return 'Customer match or audience reference';
  return 'Provider profile, user, or audience reference';
}

export default function MarketingWorkspace() {
  const [tab, setTab] = useState('Overview');
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [campaign, setCampaign] = useState(EMPTY_CAMPAIGN);
  const [audienceList, setAudienceList] = useState(EMPTY_AUDIENCE_LIST);
  const [audienceMember, setAudienceMember] = useState(EMPTY_AUDIENCE_MEMBER);
  const [runCheck, setRunCheck] = useState(null);
  const [asset, setAsset] = useState(EMPTY_ASSET);
  const [channel, setChannel] = useState(EMPTY_CHANNEL);
  const [metric, setMetric] = useState(EMPTY_METRIC);
  const [watch, setWatch] = useState(EMPTY_WATCH);
  const [tracking, setTracking] = useState(EMPTY_TRACKING);
  const [trackingResult, setTrackingResult] = useState(null);
  const [analyticsCampaignId, setAnalyticsCampaignId] = useState('');
  const [lead, setLead] = useState(EMPTY_LEAD);
  const [crmOptions, setCrmOptions] = useState({ available: false, people: [], opportunities: [], mode: 'loading' });
  const [leadSearch, setLeadSearch] = useState('');
  const [leadCampaignFilter, setLeadCampaignFilter] = useState('');
  const [leadStatusFilter, setLeadStatusFilter] = useState('');
  const [followupFilter, setFollowupFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setWorkspace(await api.marketingWorkspace()); setMessage(null);
      api.marketingCrmOptions().then(setCrmOptions).catch((error) => setCrmOptions({ available: false, people: [], opportunities: [], mode: 'unavailable', error: error.message }));
    }
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
  const distributionLists = dataRows(workspace, 'distributionLists');
  const distributionMembers = dataRows(workspace, 'distributionMembers');
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
  const editedCampaignReport = campaignReports.find((row) => row.campaign_id === campaign.campaign_id) || null;
  const selectedOutcomes = outcomes.filter((row) => !selectedReport || row.campaign_id === selectedReport.campaign_id).slice().reverse();
  const filteredLeads = useMemo(() => leads.filter((row) => {
    const search = leadSearch.trim().toLowerCase();
    const haystack = `${row.display_label || ''} ${row.opportunity_summary || ''} ${row.opportunity_key || ''} ${row.crm_person_reference || ''}`.toLowerCase();
    return (!search || haystack.includes(search))
      && (!leadCampaignFilter || parseJson(row.campaign_ids_json, []).includes(leadCampaignFilter))
      && (!leadStatusFilter || row.status === leadStatusFilter)
      && (!followupFilter || row.followup_status === followupFilter);
  }), [leads, leadSearch, leadCampaignFilter, leadStatusFilter, followupFilter]);
  const dueFollowups = useMemo(() => leads.filter((row) => ['pending', 'scheduled', 'in_progress'].includes(row.followup_status) && row.followup_due_at).sort((a, b) => String(a.followup_due_at).localeCompare(String(b.followup_due_at))), [leads]);
  const selectedPersonRecords = useMemo(() => leads.filter((row) => row.lead_id !== lead.lead_id && ((lead.crm_person_reference && row.crm_person_reference === lead.crm_person_reference) || (lead.identity_hash && row.identity_hash === lead.identity_hash))), [leads, lead]);
  const relevantEngagements = useMemo(() => engagements.filter((row) => (!lead.campaign_ids.length || lead.campaign_ids.includes(row.campaign_id)) && (!lead.identity_hash || !row.audience_hash || row.audience_hash === lead.identity_hash)), [engagements, lead.campaign_ids, lead.identity_hash]);
  const suggestedInterests = useMemo(() => [...new Set([
    ...selectedPersonRecords.flatMap((row) => parseJson(row.interests_json, [])),
    ...assets.filter((row) => lead.campaign_ids.includes(row.campaign_id)).flatMap((row) => [row.subject, row.name]),
  ].map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 20), [selectedPersonRecords, assets, lead.campaign_ids]);

  const selectLead = (row) => setLead(leadFromRecord(row));
  const selectCrmPerson = (reference) => {
    const person = crmOptions.people.find((row) => row.id === reference);
    setLead((current) => ({ ...current, crm_person_reference: reference, display_label: person?.label || current.display_label, identity_reference: '' }));
  };
  const selectCrmOpportunity = (reference) => {
    const opportunity = crmOptions.opportunities.find((row) => row.id === reference);
    setLead((current) => ({ ...current, crm_opportunity_reference: reference, opportunity_key: reference || current.opportunity_key, opportunity_summary: opportunity?.label || current.opportunity_summary, lifecycle_stage: normalizeLifecycle(opportunity?.stage) || current.lifecycle_stage }));
  };
  const saveLead = (event) => {
    event.preventDefault();
    setBusy('Lead'); setMessage(null);
    api.marketingLeadPrepare({
      ...lead,
      consent: { overall: lead.consent_state },
      recommended_followup: lead.next_action,
    }).then(async (result) => {
      await load();
      setLead(leadFromRecord(result.record));
      setMessage({ type: 'success', text: 'Lead saved. Qualification and consent were recalculated from the selected evidence.' });
    }).catch((error) => setMessage({ type: 'error', text: error.message || 'Could not save lead.' }))
      .finally(() => setBusy(''));
  };
  const handoffLeadToCrm = async () => {
    if (!lead.lead_id) return;
    setBusy('CrmHandoff'); setMessage(null);
    try {
      const saved = await api.marketingLeadPrepare({
        ...lead,
        consent: { overall: lead.consent_state },
        recommended_followup: lead.next_action,
      });
      const result = await api.marketingLeadCrmHandoff(saved.record.lead_id);
      await load();
      setLead(leadFromRecord(result.lead));
      setMessage({ type: 'success', text: `Lead sent to ${label(result.provider || 'CRM')}. CRM lead ${result.lead_id} is now linked.` });
    } catch (error) { setMessage({ type: 'error', text: error.message || 'Could not send lead to CRM.' }); }
    finally { setBusy(''); }
  };
  const validateCampaignRun = async () => {
    if (!campaign.campaign_id) return;
    setBusy('RunCheck'); setMessage(null);
    try { setRunCheck(await api.marketingCampaignRunPrepare({ campaign_id: campaign.campaign_id })); }
    catch (error) { setMessage({ type: 'error', text: error.message || 'Could not validate campaign readiness.' }); }
    finally { setBusy(''); }
  };

  if (loading && !workspace) return <main className="marketing-page"><div className="marketing-loading">Preparing your marketing workspace…</div></main>;

  return (
    <main className="marketing-page">
      <header className="marketing-hero">
        <div>
          <span className="marketing-eyebrow">Run &amp; Operate</span>
          <h1>Marketing</h1>
          <p>Plan campaigns, build reusable distribution lists, coordinate optional CRM audiences, and measure outcomes in one company workspace.</p>
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
        <Panel title={campaign.campaign_id ? 'Edit campaign' : 'New campaign'} subtitle="Link execution to an OKR and select manual, CRM, or provider-native audiences.">
          <form onSubmit={(e) => { e.preventDefault(); save('Campaign', api.marketingCampaignUpsert, campaign, () => setCampaign(EMPTY_CAMPAIGN)); }} className="marketing-form">
            <Field label="Campaign name"><input required value={campaign.name} onChange={(e) => setCampaign({ ...campaign, name: e.target.value })} /></Field>
            <div className="marketing-form-row"><Field label="Objective ID"><input value={campaign.objective_id} onChange={(e) => setCampaign({ ...campaign, objective_id: e.target.value })} /></Field><Field label="Status"><select value={campaign.status} onChange={(e) => setCampaign({ ...campaign, status: e.target.value })}><option>draft</option><option>active</option><option>paused</option><option>completed</option></select></Field></div>
            <Field label="Channels"><div className="marketing-checks">{CHANNELS.map((name) => <label key={name}><input type="checkbox" checked={campaign.channels.includes(name)} onChange={(e) => setCampaign({ ...campaign, channels: e.target.checked ? [...campaign.channels, name] : campaign.channels.filter((x) => x !== name) })} />{label(name)}</label>)}</div></Field>
            <Field label="Marketing distribution lists"><div className="marketing-audience-picker">{distributionLists.length ? distributionLists.filter((row) => row.status !== 'inactive').map((row) => <label key={row.list_id}><input type="checkbox" checked={campaign.audience_list_ids.includes(row.list_id)} onChange={(e) => setCampaign({ ...campaign, audience_list_ids: e.target.checked ? [...campaign.audience_list_ids, row.list_id] : campaign.audience_list_ids.filter((id) => id !== row.list_id) })} /><span><strong>{row.name}</strong><small>{label(row.default_channel)} · {distributionMembers.filter((member) => member.list_id === row.list_id).length} entries</small></span></label>) : <small>No manual lists yet. Create one under Audience lists.</small>}</div></Field>
            <Field label="CRM audience filter"><input placeholder="Example: lifecycleStage=Customer; country=SG" value={campaign.audience_crm_filter} onChange={(e) => setCampaign({ ...campaign, audience_crm_filter: e.target.value })} /></Field>
            <Field label="CRM list or segment reference"><input value={campaign.crm_reference} onChange={(e) => setCampaign({ ...campaign, crm_reference: e.target.value })} /></Field>
            <Field label="Optional named CRM recipients">
              <div className="marketing-audience-picker">
                {crmOptions.people.length ? crmOptions.people.map((person) => <label key={person.id}>
                  <input type="checkbox" checked={campaign.audience_crm_person_refs.includes(person.id)} onChange={(e) => setCampaign({ ...campaign, audience_crm_person_refs: e.target.checked ? [...campaign.audience_crm_person_refs, person.id] : campaign.audience_crm_person_refs.filter((id) => id !== person.id) })} />
                  <span><strong>{person.label}</strong><small>{contactPoints(person)}</small></span>
                </label>) : <small>{crmOptions.available ? 'No CRM people are available.' : 'CRM is unavailable. Manual distribution lists remain available.'}</small>}
              </div>
            </Field>
            <div className="marketing-form-row"><Field label="Total budget"><input type="number" min="0" step="0.01" value={campaign.budget_total} onChange={(e) => setCampaign({ ...campaign, budget_total: e.target.value })} /></Field><Field label="Daily budget"><input type="number" min="0" step="0.01" value={campaign.budget_daily} onChange={(e) => setCampaign({ ...campaign, budget_daily: e.target.value })} /></Field></div>
            <Field label="Outcome goal"><textarea rows="3" value={campaign.goal} onChange={(e) => setCampaign({ ...campaign, goal: e.target.value })} /></Field>
            <Field label="Agentic strategy brief"><textarea rows="4" placeholder="Audience promise, positioning, channel approach, success measure and any constraints agreed with the Marketing Specialist." value={campaign.strategy_brief} onChange={(e) => setCampaign({ ...campaign, strategy_brief: e.target.value })} /></Field>
            <Field label="Content topics"><input placeholder="AI operations, sales growth, customer proof" value={campaign.content_topics.join(', ')} onChange={(e) => setCampaign({ ...campaign, content_topics: e.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></Field>
            <div className="marketing-form-row"><Field label="Strategy cadence"><select value={campaign.content_cadence} onChange={(e) => setCampaign({ ...campaign, content_cadence: e.target.value })}><option value="">Set by Marketing Specialist</option><option value="hourly">hourly</option><option value="daily">daily</option><option value="weekdays">weekdays</option><option value="weekly">weekly</option></select></Field><Field label="Content items per run"><input type="number" min="1" max="20" value={campaign.content_per_run} onChange={(e) => setCampaign({ ...campaign, content_per_run: e.target.value })} /></Field></div>
            <Field label="Stop conditions"><textarea rows="3" placeholder={'One per line, for example:\nQualified leads reach 25\nCampaign budget is exhausted'} value={campaign.stop_conditions.join('\n')} onChange={(e) => setCampaign({ ...campaign, stop_conditions: e.target.value.split('\n').map((value) => value.trim()).filter(Boolean) })} /></Field>
            <aside className="marketing-safety"><strong>Scheduling:</strong> The Marketing Specialist creates one standard Scheduled Goal after confirming the strategy. {campaign.scheduled_goal_id ? <>This campaign is scheduled. <Link to="/scheduled-goals">Manage it in Scheduled Goals</Link>.</> : <>No schedule has been created yet. Ask the Marketing Specialist to schedule it after saving.</>}</aside>
            <FormActions busy={busy === 'Campaign'} edit={!!campaign.campaign_id} clear={() => setCampaign(EMPTY_CAMPAIGN)} />
          </form>
          {campaign.campaign_id && <div className="marketing-run-audience">
            <h3>Observed run recipients</h3>
            <p>These recipients came from recorded send receipts. They may have been supplied by an agent at run time rather than saved in this campaign’s planned CRM audience.</p>
            {editedCampaignReport?.recipients?.length ? editedCampaignReport.recipients.map((row) => <div key={row.audience_hash || row.outcome_id}><span><strong>{row.recipient_label}</strong><small>{row.destination_masked || 'Identity protected'}</small></span><em>{label(row.delivery_status)} · {row.open_count} open signal{row.open_count === 1 ? '' : 's'}</em></div>) : <small>No recipient-level send evidence has been recorded.</small>}
          </div>}
          {campaign.campaign_id && <div className="marketing-run-box"><div><h3>Run this campaign</h3><p>Validate first, then ask the Marketing Specialist to execute the ready channel actions. External sends and publishing still pass through Action Control.</p></div><button type="button" className="marketing-primary" disabled={busy === 'RunCheck'} onClick={validateCampaignRun}>{busy === 'RunCheck' ? 'Checking…' : 'Validate for run'}</button>{runCheck && <div className={runCheck.ready ? 'ready' : 'blocked'}><strong>{runCheck.ready ? 'Ready for agent execution' : 'Not ready'}</strong>{runCheck.blockers?.length ? <ul>{runCheck.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p>{runCheck.actions?.map((item) => `${label(item.channel)} (${item.audience?.ready_member_count || 0} list recipients)`).join(' · ')}</p>}<Link to={`/agents/marketing-specialist/chat?message=${encodeURIComponent(`Run marketing campaign ${campaign.campaign_id}. First validate it with marketing_campaign_run_prepare, then execute only the ready channel actions using the selected audience and approved assets. Record every provider receipt and outcome.`)}`}>Open Marketing Specialist with run request</Link></div>}</div>}
        </Panel>
        <Panel title="Campaign portfolio" subtitle="Edit a plan without duplicating it.">
          {campaigns.length ? campaigns.map((row) => { const report = campaignReports.find((item) => item.campaign_id === row.campaign_id); return <RecordLine key={row.row_id} title={row.name} badge={row.status} detail={`${report?.configured_audience_count || 0} planned · ${report?.recipients?.length || 0} observed recipients · ${row.scheduled_goal_id ? 'Scheduled Goal linked' : 'Not scheduled'} · ${money(row.budget_total, row.currency)} · ${row.goal || 'No outcome goal'}`} action={() => { setCampaign({ ...EMPTY_CAMPAIGN, ...row, channels: parseJson(row.channels_json, []), audience_list_ids: parseJson(row.audience_list_ids_json, []), audience_crm_person_refs: parseJson(row.audience_crm_person_refs_json, []), content_topics: parseJson(row.content_topics_json, []), stop_conditions: parseJson(row.stop_conditions_json, []) }); setRunCheck(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />; }) : <Empty text="No campaigns yet." />}
        </Panel>
      </section>}

      {tab === 'Audience lists' && <section className="marketing-section">
        <aside className="marketing-safety"><strong>CRM is optional:</strong> create reusable lists here, select CRM people in a campaign, or combine both. Manual destinations are encrypted at rest and list members follow the company data-retention policy. A destination is usable only when consent is granted.</aside>
        <div className="marketing-two-col">
          <Panel title={audienceList.list_id ? 'Edit distribution list' : 'New distribution list'} subtitle="Create a reusable campaign audience independently of CRM.">
            <form onSubmit={(e) => { e.preventDefault(); save('Audience list', api.marketingAudienceListUpsert, audienceList, () => setAudienceList(EMPTY_AUDIENCE_LIST)); }} className="marketing-form">
              <Field label="List name"><input required value={audienceList.name} onChange={(e) => setAudienceList({ ...audienceList, name: e.target.value })} /></Field>
              <div className="marketing-form-row"><Field label="Default channel"><ChannelSelect value={audienceList.default_channel} onChange={(default_channel) => setAudienceList({ ...audienceList, default_channel })} /></Field><Field label="Status"><select value={audienceList.status} onChange={(e) => setAudienceList({ ...audienceList, status: e.target.value })}><option value="active">active</option><option value="inactive">inactive</option></select></Field></div>
              <Field label="Description"><textarea rows="3" value={audienceList.description} onChange={(e) => setAudienceList({ ...audienceList, description: e.target.value })} /></Field>
              <FormActions busy={busy === 'Audience list'} edit={!!audienceList.list_id} clear={() => setAudienceList(EMPTY_AUDIENCE_LIST)} />
            </form>
          </Panel>
          <Panel title="Saved distribution lists" subtitle={`${distributionLists.length} reusable list${distributionLists.length === 1 ? '' : 's'}`}>
            {distributionLists.length ? distributionLists.map((row) => <RecordLine key={row.list_id} title={row.name} badge={row.status} detail={`${label(row.default_channel)} · ${distributionMembers.filter((member) => member.list_id === row.list_id).length} entries · ${row.description || 'No description'}`} action={() => { setAudienceList({ ...EMPTY_AUDIENCE_LIST, ...row }); setAudienceMember((current) => ({ ...current, list_id: row.list_id, channel: current.member_id ? current.channel : row.default_channel })); }} />) : <Empty text="No distribution lists yet." />}
          </Panel>
          <Panel title={audienceMember.member_id ? 'Edit list entry' : 'Add list entry'} subtitle="Add email addresses, WhatsApp/phone numbers, or provider identities with consent evidence.">
            <form onSubmit={(e) => { e.preventDefault(); save('Audience member', api.marketingAudienceMemberUpsert, audienceMember, () => setAudienceMember({ ...EMPTY_AUDIENCE_MEMBER, list_id: audienceMember.list_id })); }} className="marketing-form">
              <Field label="Distribution list"><select required value={audienceMember.list_id} onChange={(e) => { const selected = distributionLists.find((row) => row.list_id === e.target.value); setAudienceMember({ ...audienceMember, list_id: e.target.value, channel: selected?.default_channel || audienceMember.channel }); }}><option value="">Select list</option>{distributionLists.map((row) => <option key={row.list_id} value={row.list_id}>{row.name}</option>)}</select></Field>
              <div className="marketing-form-row"><Field label="Display name"><input value={audienceMember.display_label} onChange={(e) => setAudienceMember({ ...audienceMember, display_label: e.target.value })} /></Field><Field label="Channel"><ChannelSelect value={audienceMember.channel} onChange={(channel) => setAudienceMember({ ...audienceMember, channel, destination: '' })} /></Field></div>
              <Field label={destinationLabel(audienceMember.channel)}><input required placeholder={destinationPlaceholder(audienceMember.channel)} value={audienceMember.destination} onChange={(e) => setAudienceMember({ ...audienceMember, destination: e.target.value })} /></Field>
              <div className="marketing-form-row"><Field label="Consent"><select value={audienceMember.consent_status} onChange={(e) => setAudienceMember({ ...audienceMember, consent_status: e.target.value })}><option value="unknown">unknown</option><option value="granted">granted</option><option value="denied">denied / opted out</option></select></Field><Field label="Consent date"><input type="date" value={(audienceMember.consent_at || '').slice(0, 10)} onChange={(e) => setAudienceMember({ ...audienceMember, consent_at: e.target.value })} /></Field></div>
              <Field label="Consent source"><input placeholder="Example: web signup form, owner-provided test contact" value={audienceMember.consent_source} onChange={(e) => setAudienceMember({ ...audienceMember, consent_source: e.target.value })} /></Field>
              <Field label="Optional CRM person"><select value={audienceMember.crm_person_reference} onChange={(e) => setAudienceMember({ ...audienceMember, crm_person_reference: e.target.value })}><option value="">Not linked to CRM</option>{crmOptions.people.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}</select></Field>
              <FormActions busy={busy === 'Audience member'} edit={!!audienceMember.member_id} clear={() => setAudienceMember(EMPTY_AUDIENCE_MEMBER)} />
            </form>
          </Panel>
          <Panel title="Distribution entries" subtitle="Campaign execution resolves channel destinations from selected lists.">
            <div className="marketing-table-wrap"><table className="marketing-table"><thead><tr><th>List</th><th>Person / target</th><th>Channel</th><th>Destination</th><th>Consent</th><th></th></tr></thead><tbody>{distributionMembers.length ? distributionMembers.map((row) => <tr key={row.member_id}><td>{distributionLists.find((list) => list.list_id === row.list_id)?.name || row.list_id}</td><td>{row.display_label || 'Unnamed'}</td><td>{label(row.channel)}</td><td>{row.destination}</td><td>{label(row.consent_status)}</td><td><button type="button" onClick={() => setAudienceMember({ ...EMPTY_AUDIENCE_MEMBER, ...row, tags: parseJson(row.tags_json, []) })}>Edit</button></td></tr>) : <tr><td colSpan="6">No manual distribution entries yet.</td></tr>}</tbody></table></div>
          </Panel>
        </div>
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
        <Panel title="Company Email inbox" subtitle="Email OAuth, mailbox ownership and inbound routing are configured once at company level—not duplicated in Marketing.">
          <p>Campaign replies are attributed here automatically. Other messages remain in the Events &amp; Productivity inbox.</p>
          <Link className="marketing-primary" to="/connectors?tab=channels" style={{ display: 'inline-block' }}>Configure company Email channel</Link>
        </Panel>
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

      {tab === 'Leads & follow-up' && <section className="marketing-section">
        <div className="marketing-stat-grid">
          <Stat label="Lead opportunities" value={leads.length} detail={`${new Set(leads.map((row) => row.crm_person_reference || row.identity_hash).filter(Boolean)).size} distinct people`} />
          <Stat label="Qualified" value={leads.filter((row) => ['qualified', 'crm_synced'].includes(row.status)).length} detail="Eligible or already in CRM" />
          <Stat label="Follow-ups due" value={dueFollowups.filter((row) => Date.parse(row.followup_due_at) <= Date.now()).length} detail={`${dueFollowups.length} scheduled in total`} />
          <Stat label="CRM linked" value={leads.filter((row) => row.crm_person_reference || row.crm_opportunity_reference).length} detail={crmOptions.available ? `${label(crmOptions.provider)} connected` : 'CRM selection unavailable'} />
        </div>

        <aside className={`marketing-crm-status ${crmOptions.available ? 'ready' : 'warning'}`}>
          <div><strong>{crmOptions.available ? `${label(crmOptions.provider)} CRM is connected` : 'CRM records are not currently available'}</strong><span>{crmOptions.available ? 'People and opportunities below are selected from the company CRM; Marketing keeps only their references and campaign evidence.' : (crmOptions.error || 'You can retain privacy-safe campaign leads and link them after CRM is configured.')}</span></div>
          <Link to="/crm" className="marketing-secondary">Open CRM</Link>
        </aside>

        <Panel title="Lead and opportunity portfolio" subtitle="One campaign can create many records. The same person may also have separate opportunities without losing cross-campaign history.">
          <div className="marketing-lead-toolbar">
            <Field label="Search"><input type="search" placeholder="Person, opportunity or CRM reference" value={leadSearch} onChange={(e) => setLeadSearch(e.target.value)} /></Field>
            <Field label="Campaign"><select value={leadCampaignFilter} onChange={(e) => setLeadCampaignFilter(e.target.value)}><option value="">All campaigns</option>{campaigns.map((row) => <option key={row.campaign_id} value={row.campaign_id}>{row.name}</option>)}</select></Field>
            <Field label="Qualification"><select value={leadStatusFilter} onChange={(e) => setLeadStatusFilter(e.target.value)}><option value="">All qualification states</option>{[...new Set(leads.map((row) => row.status).filter(Boolean))].map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></Field>
            <Field label="Follow-up"><select value={followupFilter} onChange={(e) => setFollowupFilter(e.target.value)}><option value="">All follow-up states</option>{FOLLOWUP_STATES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></Field>
            <button className="marketing-primary marketing-add-lead" type="button" onClick={() => setLead(EMPTY_LEAD)}>Add lead / opportunity</button>
          </div>
          <div className="marketing-table-wrap"><table className="marketing-table marketing-lead-table"><thead><tr><th>Person</th><th>Opportunity</th><th>Campaigns</th><th>Stage</th><th>Score</th><th>Follow-up</th><th></th></tr></thead><tbody>{filteredLeads.length ? filteredLeads.map((row) => <tr key={row.lead_id} className={lead.lead_id === row.lead_id ? 'selected' : ''}>
            <td><strong>{row.display_label || row.crm_person_reference || 'Privacy-safe lead'}</strong><small>{row.crm_person_reference ? 'CRM linked' : 'Marketing identity'}</small></td>
            <td><strong>{row.opportunity_summary || label(row.opportunity_key)}</strong><small>{row.crm_opportunity_reference ? `CRM · ${row.crm_opportunity_reference}` : label(row.status)}</small></td>
            <td>{parseJson(row.campaign_ids_json, []).map((id) => campaigns.find((item) => item.campaign_id === id)?.name || id).join(', ') || 'Unattributed'}</td>
            <td>{label(row.lifecycle_stage || 'new')}</td><td>{row.score || 0}</td>
            <td>{label(row.followup_status || 'not_ready')}<small>{formatDate(row.followup_due_at)}</small></td>
            <td><button className="marketing-row-action" type="button" onClick={() => selectLead(row)}>View</button></td>
          </tr>) : <tr><td colSpan="7">No lead opportunities match these filters.</td></tr>}</tbody></table></div>
        </Panel>

        <div className="marketing-lead-layout">
          <Panel title={lead.lead_id ? 'Edit lead opportunity' : 'Add lead opportunity'} subtitle="Choose CRM and campaign records wherever possible. Narrative fields are reserved for context and the next action.">
            <form onSubmit={saveLead} className="marketing-form">
              <div className="marketing-form-row">
                <Field label="CRM person"><select value={lead.crm_person_reference} onChange={(e) => selectCrmPerson(e.target.value)}><option value="">Select a CRM person</option>{crmOptions.people.map((row) => <option key={row.id} value={row.id}>{row.label}{row.company_label ? ` · ${row.company_label}` : ''}{row.email ? ` · ${row.email}` : ''}</option>)}</select></Field>
                <Field label="CRM opportunity"><select value={lead.crm_opportunity_reference} onChange={(e) => selectCrmOpportunity(e.target.value)}><option value="">Create or correlate in Marketing</option>{crmOptions.opportunities.filter((row) => !lead.crm_person_reference || !row.person_reference || row.person_reference === lead.crm_person_reference).map((row) => <option key={row.id} value={row.id}>{row.label}{row.stage ? ` · ${row.stage}` : ''}</option>)}</select></Field>
              </div>
              {!crmOptions.available && <div className="marketing-form-row"><Field label="Consented identity reference"><input placeholder="Email, phone, or provider identity" value={lead.identity_reference} onChange={(e) => setLead({ ...lead, identity_reference: e.target.value })} /></Field><Field label="Display label"><input value={lead.display_label} onChange={(e) => setLead({ ...lead, display_label: e.target.value })} /></Field></div>}
              <Field label="Marketing opportunity"><select required value={lead.opportunity_key} onChange={(e) => setLead({ ...lead, opportunity_key: e.target.value })}><option value="">Select the need or campaign opportunity</option>{lead.opportunity_key && !crmOptions.opportunities.some((row) => row.id === lead.opportunity_key) && !campaigns.some((row) => `campaign:${row.campaign_id}` === lead.opportunity_key) && <option value={lead.opportunity_key}>{label(lead.opportunity_key)}</option>}{crmOptions.opportunities.map((row) => <option key={`crm-${row.id}`} value={row.id}>{row.label} (CRM)</option>)}{campaigns.map((row) => <option key={`campaign-${row.campaign_id}`} value={`campaign:${row.campaign_id}`}>{row.name} opportunity</option>)}</select></Field>
              <Field label="Attributed campaigns"><ChoiceList values={lead.campaign_ids} options={campaigns.map((row) => ({ value: row.campaign_id, label: row.name }))} onChange={(values) => setLead({ ...lead, campaign_ids: values })} empty="Create a campaign first." /></Field>
              <Field label="Observed channels"><ChoiceList values={lead.channels} options={CHANNELS.map((value) => ({ value, label: label(value) }))} onChange={(values) => setLead({ ...lead, channels: values })} /></Field>
              <Field label="Engagement evidence"><ChoiceList values={lead.engagement_event_ids} options={relevantEngagements.map((row) => ({ value: row.event_id, label: `${label(row.channel)} · ${label(row.event_type)} · ${formatDate(row.observed_at)}` }))} onChange={(values) => setLead({ ...lead, engagement_event_ids: values })} empty="No matching campaign engagement has been observed." /></Field>
              <Field label="Demonstrated interests"><TagEditor values={lead.interests} suggestions={suggestedInterests} onChange={(values) => setLead({ ...lead, interests: values })} /></Field>
              <div className="marketing-form-row"><Field label="Lifecycle stage"><select value={lead.lifecycle_stage} onChange={(e) => setLead({ ...lead, lifecycle_stage: e.target.value })}>{LIFECYCLE_STAGES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></Field><Field label="Contact permission"><select value={lead.consent_state} onChange={(e) => setLead({ ...lead, consent_state: e.target.value })}><option value="unknown">Unknown — do not send</option><option value="granted">Granted</option><option value="denied">Denied / opted out</option></select></Field></div>
              <Field label="Opportunity context"><textarea rows="3" placeholder="What business need or intent did the campaign reveal?" value={lead.opportunity_summary} onChange={(e) => setLead({ ...lead, opportunity_summary: e.target.value })} /></Field>
              <div className="marketing-followup-box">
                <strong>Follow-up plan</strong>
                <div className="marketing-form-row"><Field label="State"><select value={lead.followup_status} onChange={(e) => setLead({ ...lead, followup_status: e.target.value })}>{FOLLOWUP_STATES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></Field><Field label="Channel"><select value={lead.followup_channel} onChange={(e) => setLead({ ...lead, followup_channel: e.target.value })}><option value="">Select consented channel</option>{CHANNELS.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></Field></div>
                <Field label="Due date and time"><input type="datetime-local" value={lead.followup_due_at} onChange={(e) => setLead({ ...lead, followup_due_at: e.target.value })} /></Field>
                <Field label="Next action"><textarea rows="3" placeholder="Concrete next step for the owner or Marketing Specialist" value={lead.next_action} onChange={(e) => setLead({ ...lead, next_action: e.target.value })} /></Field>
              </div>
              <FormActions busy={busy === 'Lead'} edit={!!lead.lead_id} clear={() => setLead(EMPTY_LEAD)} />
              <CrmHandoff
                lead={lead}
                crmAvailable={crmOptions.available}
                busy={busy === 'CrmHandoff'}
                onHandoff={handoffLeadToCrm}
              />
            </form>
          </Panel>

          <div className="marketing-lead-side">
            <Panel title="Person and campaign correlation" subtitle="Separate opportunities share prior interests and history, not one combined sales record.">
              {lead.lead_id || lead.crm_person_reference || lead.identity_hash ? <>
                <div className="marketing-correlation-summary"><span>Other opportunities <strong>{selectedPersonRecords.length}</strong></span><span>Linked campaigns <strong>{lead.campaign_ids.length}</strong></span><span>Evidence selected <strong>{lead.engagement_event_ids.length}</strong></span></div>
                {selectedPersonRecords.length ? selectedPersonRecords.map((row) => <RecordLine key={row.lead_id} title={row.opportunity_summary || label(row.opportunity_key)} badge={label(row.status)} detail={`${parseJson(row.interests_json, []).join(', ') || 'No interests'} · ${label(row.lifecycle_stage || 'new')}`} action={() => selectLead(row)} />) : <Empty text="No other opportunities are correlated with this person yet." />}
              </> : <Empty text="Select a portfolio row or CRM person to see cross-campaign correlation." />}
            </Panel>
            <Panel title="Scheduled follow-up queue" subtitle="Due work across every lead and opportunity, ordered by date.">
              {dueFollowups.length ? dueFollowups.slice(0, 12).map((row) => <RecordLine key={row.lead_id} title={row.display_label || 'Privacy-safe lead'} badge={label(row.followup_status)} detail={`${formatDate(row.followup_due_at)} · ${row.opportunity_summary || label(row.opportunity_key)} · ${label(row.followup_channel || 'channel pending')}`} action={() => selectLead(row)} />) : <Empty text="No follow-ups are scheduled." />}
            </Panel>
          </div>
        </div>
      </section>}
    </main>
  );
}

function parseJson(value, fallback) { try { return JSON.parse(value || '') ?? fallback; } catch { return fallback; } }
function label(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase()); }
function formatDate(value) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
function toLocalDateTime(value) { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return String(value).slice(0, 16); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); }
function normalizeLifecycle(value) { const normalized = String(value || '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, ''); return LIFECYCLE_STAGES.includes(normalized) ? normalized : ''; }
function normalizedConsentState(value) {
  const state = String(value || '').toLowerCase();
  if (['granted', 'consented', 'opted_in', 'true'].includes(state)) return 'granted';
  if (['denied', 'opted_out', 'unsubscribed', 'do_not_call', 'false'].includes(state)) return 'denied';
  return 'unknown';
}
function leadFromRecord(row) {
  const consent = parseJson(row.consent_json, {});
  const channels = parseJson(row.channels_json, []);
  const preferredConsent = consent.overall || consent[row.followup_channel] || channels.map((channel) => consent[channel]).find(Boolean) || Object.values(consent).find(Boolean);
  return { ...EMPTY_LEAD, ...row, campaign_ids: parseJson(row.campaign_ids_json, []), channels, interests: parseJson(row.opportunity_interests_json || row.interests_json, []), engagement_event_ids: parseJson(row.engagement_event_ids_json, []), consent_state: normalizedConsentState(preferredConsent), followup_due_at: toLocalDateTime(row.followup_due_at), next_action: row.next_action || row.recommended_followup || '' };
}

function CrmHandoff({ lead, crmAvailable, busy, onHandoff }) {
  const synced = !!(lead.crm_lead_reference || lead.crm_opportunity_reference);
  const ready = !!lead.lead_id && ['qualified', 'crm_synced'].includes(lead.status) && String(lead.eligible_for_followup) === 'true' && crmAvailable && !synced;
  let detail = 'Save the lead first. Flolah will then show whether it is ready for CRM.';
  if (lead.lead_id && synced) detail = `Linked to CRM ${lead.crm_lead_reference || lead.crm_opportunity_reference}. Future saves keep this reference.`;
  else if (lead.lead_id && !crmAvailable) detail = 'CRM is unavailable. Check the company CRM connection before handoff.';
  else if (lead.lead_id && !['qualified', 'crm_synced'].includes(lead.status)) detail = 'Not ready: add attributable evidence until the lead qualifies.';
  else if (lead.lead_id && String(lead.eligible_for_followup) !== 'true') detail = 'Not ready: grant contact permission and resolve any suppression before handoff.';
  else if (ready) detail = 'Ready: Flolah will reuse an exact CRM person match or create one, create the CRM lead, and link both records.';
  return <div className={`marketing-crm-handoff ${synced ? 'synced' : ready ? 'ready' : 'blocked'}`}>
    <div><strong>{synced ? 'CRM linked' : 'Send to CRM'}</strong><span>{detail}</span></div>
    {synced ? <Link to="/crm" className="marketing-secondary">Open CRM</Link> : <button className="marketing-primary" type="button" disabled={!ready || busy} onClick={onHandoff}>{busy ? 'Sending to CRM…' : 'Send qualified lead to CRM'}</button>}
  </div>;
}
function Stat({ label: name, value, detail }) { return <article className="marketing-stat"><span>{name}</span><strong>{value}</strong><small>{detail}</small></article>; }
function Panel({ title, subtitle, children }) { return <article className="marketing-panel"><header><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</header><div className="marketing-panel-body">{children}</div></article>; }
function Field({ label: name, children }) { return <div className="marketing-field"><span>{name}</span>{children}</div>; }
function ChannelSelect({ value, onChange }) { return <select value={value} onChange={(e) => onChange(e.target.value)}>{CHANNELS.map((name) => <option key={name} value={name}>{label(name)}</option>)}</select>; }
function FormActions({ busy, edit, clear }) { return <div className="marketing-form-actions"><button className="marketing-primary" disabled={busy} type="submit">{busy ? 'Saving…' : edit ? 'Update' : 'Save'}</button><button className="marketing-secondary" type="button" onClick={clear}>Clear</button></div>; }
function RecordLine({ title, badge, detail, action }) { return <div className="marketing-record"><div><strong>{title}</strong><span>{detail}</span></div><div className="marketing-record-side"><em>{badge}</em>{action && <button onClick={action}>Edit</button>}</div></div>; }
function Empty({ text, action }) { return <div className="marketing-empty"><p>{text}</p>{action && <button className="marketing-secondary" onClick={action}>Get started</button>}</div>; }
function ChoiceList({ values, options, onChange, empty }) { return options.length ? <div className="marketing-choice-list">{options.map((option) => <label key={option.value}><input type="checkbox" checked={values.includes(option.value)} onChange={(event) => onChange(event.target.checked ? [...values, option.value] : values.filter((value) => value !== option.value))} /><span>{option.label}</span></label>)}</div> : <span className="marketing-inline-empty">{empty || 'No options available.'}</span>; }
function TagEditor({ values, suggestions, onChange }) { const [draft, setDraft] = useState(''); const add = () => { const value = draft.trim(); if (value && !values.includes(value)) onChange([...values, value]); setDraft(''); }; return <div className="marketing-tag-editor"><div className="marketing-tags">{values.map((value) => <button key={value} type="button" onClick={() => onChange(values.filter((item) => item !== value))}>{value}<span aria-hidden="true">×</span></button>)}</div>{suggestions.filter((value) => !values.includes(value)).length > 0 && <div className="marketing-tag-suggestions">{suggestions.filter((value) => !values.includes(value)).map((value) => <button key={value} type="button" onClick={() => onChange([...values, value])}>+ {value}</button>)}</div>}<div className="marketing-tag-input"><input value={draft} placeholder="Add a specific interest" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} /><button type="button" onClick={add}>Add</button></div></div>; }
