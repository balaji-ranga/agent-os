import { Router } from 'express';
import { requireAuth, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { configureMarketingCampaign, createMarketingOpenPixel, getMarketingWorkspace, listDueMarketingWatches, prepareMarketingCampaignRun, prepareMarketingLead, reconcileMarketingToolOutcomes, recordMarketingWatchResult, updateMarketingFollowup, upsertMarketingRecord } from '../services/marketing-workspace.js';
import { assertCrmEntitled } from '../services/company-business-profile.js';
import { crmListOpportunities, crmListPeople } from '../services/twenty-crm.js';
import { erpCrmListOpportunities, erpCrmListPeople, isErpnextCrmOwner } from '../services/erpnext-crm-facade.js';

const router = Router();

function owner(req, res) {
  const value = resolveAuthenticatedCeoUserId(req);
  if (!value) res.status(403).json({ error: 'Company context required' });
  return value;
}

router.get('/workspace', requireAuth, (req, res) => {
  try {
    const ownerUserId = owner(req, res); if (!ownerUserId) return;
    reconcileMarketingToolOutcomes(ownerUserId);
    res.json(getMarketingWorkspace(ownerUserId));
  } catch (error) { res.status(error.status || 500).json({ error: error.message, code: error.code }); }
});

function displayName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return [value.firstName, value.lastName].filter(Boolean).join(' ') || value.name || '';
}

router.get('/crm-options', requireAuth, async (req, res) => {
  const ownerUserId = owner(req, res); if (!ownerUserId) return;
  try {
    assertCrmEntitled(ownerUserId);
    const erpnext = isErpnextCrmOwner(ownerUserId);
    const [peopleResult, opportunityResult] = await Promise.all([
      erpnext ? erpCrmListPeople(ownerUserId, { limit: 100 }) : crmListPeople(ownerUserId, { limit: 100 }),
      erpnext ? erpCrmListOpportunities(ownerUserId, { limit: 100 }) : crmListOpportunities(ownerUserId, { limit: 100 }),
    ]);
    const people = (peopleResult.people || []).map((row) => ({
      id: String(row.id || row.name || ''),
      label: displayName(row.name) || displayName(row) || row.email || row.email_id || 'Unnamed CRM person',
      email: row.email || row.email_id || row.emails?.primaryEmail || row.raw?.email_id || '',
      company_label: displayName(row.company?.name || row.company) || row.companyName || row.raw?.company_name || '',
    })).filter((row) => row.id);
    const opportunities = (opportunityResult.opportunities || opportunityResult.deals || []).map((row) => ({
      id: String(row.id || row.name || ''),
      label: row.title || row.name || row.opportunity_name || row.party_name || 'Untitled opportunity',
      stage: row.stage || row.sales_stage || row.status || '',
      amount: row.amount ?? row.expected_revenue ?? row.opportunity_amount ?? '',
      currency: row.currency || row.currency_code || '',
      person_reference: String(row.personId || row.person?.id || row.contact_id || row.contact || row.party_name || ''),
    })).filter((row) => row.id);
    const error = peopleResult.error || opportunityResult.error || '';
    const mode = peopleResult.mode || opportunityResult.mode || (error ? 'error' : 'live');
    res.json({ available: !error && !['off', 'error', 'unavailable'].includes(mode), provider: erpnext ? 'erpnext' : 'twenty', mode, people, opportunities, error });
  } catch (error) {
    res.json({ available: false, provider: isErpnextCrmOwner(ownerUserId) ? 'erpnext' : 'twenty', mode: 'unavailable', people: [], opportunities: [], error: error.message });
  }
});

router.post('/campaigns/configure', requireAuth, (req, res) => {
  try { const ownerUserId = owner(req, res); if (!ownerUserId) return; res.status(201).json(configureMarketingCampaign(ownerUserId, req.body || {})); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code, campaign_id: error.campaign_id, readiness: error.readiness }); }
});
router.post('/campaigns/run-prepare', requireAuth, (req, res) => {
  try { const ownerUserId = owner(req, res); if (!ownerUserId) return; res.json(prepareMarketingCampaignRun(ownerUserId, req.body || {})); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});

for (const kind of ['campaigns', 'assets', 'channels', 'metrics', 'engagements', 'watches', 'strategies']) {
  router.post(`/${kind}`, requireAuth, (req, res) => {
    try {
      const ownerUserId = owner(req, res); if (!ownerUserId) return;
      const result = upsertMarketingRecord(ownerUserId, kind, req.body || {});
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
  });
}

router.post('/tracking/open-pixel', requireAuth, (req, res) => {
  try { const ownerUserId = owner(req, res); if (!ownerUserId) return; res.status(201).json(createMarketingOpenPixel(ownerUserId, req.body || {})); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});
router.get('/watches/due', requireAuth, (req, res) => {
  try { const ownerUserId = owner(req, res); if (!ownerUserId) return; res.json({ watches: listDueMarketingWatches(ownerUserId) }); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});
router.post('/watches/results', requireAuth, (req, res) => {
  try { const ownerUserId = owner(req, res); if (!ownerUserId) return; res.json(recordMarketingWatchResult(ownerUserId, req.body || {})); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});
router.post('/leads/prepare', requireAuth, (req, res) => {
  try { const ownerUserId = owner(req, res); if (!ownerUserId) return; res.json(prepareMarketingLead(ownerUserId, req.body || {})); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});
router.post('/engagements/followup', requireAuth, (req, res) => {
  try { const ownerUserId = owner(req, res); if (!ownerUserId) return; res.json(updateMarketingFollowup(ownerUserId, req.body || {})); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});

export default router;
