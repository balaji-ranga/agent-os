/**
 * Local business discovery: Places search → public web/social URLs → optional Knowledge/Kanban.
 * Ranking, tracking, and CRM handoff are existing tools / goal-plan steps — not this module.
 */
import { geocodeLocality, nearbySearch, parsePlacesSearchText, textSearchPlaces } from './adapters/google-places.js';
import { searchSite } from './adapters/web-search.js';
import {
  fingerprintFor,
  loadOpportunityIndex,
  lookupOpportunity,
  recordOpportunities,
} from './opportunities-knowledge.js';
import { createDiscoveryKanbanTask, findCrmHandoffAgentId } from './crm-handoff.js';

function firstSocialUrl(results, hostRe) {
  for (const r of results || []) {
    const u = String(r.url || '');
    if (hostRe.test(u)) return u.split('?')[0];
  }
  return '';
}

async function enrichPresence(ownerUserId, place, locality) {
  const name = place.name || '';
  const loc = locality || '';
  const q = `${name} ${loc}`.trim();
  const out = {
    ...place,
    locality: loc,
    instagram: '',
    linkedin: '',
    facebook: '',
    has_website: Boolean(place.website),
    has_instagram: false,
    has_linkedin: false,
    has_facebook: false,
  };
  if (!name) return out;
  try {
    const [ig, li, fb] = await Promise.all([
      searchSite(ownerUserId, { query: q, site: 'instagram.com', count: 3 }),
      searchSite(ownerUserId, { query: q, site: 'linkedin.com', count: 3 }),
      searchSite(ownerUserId, { query: q, site: 'facebook.com', count: 3 }),
    ]);
    out.instagram = firstSocialUrl(ig.results, /instagram\.com/i);
    out.linkedin = firstSocialUrl(li.results, /linkedin\.com/i);
    out.facebook = firstSocialUrl(fb.results, /facebook\.com/i);
    out.has_instagram = Boolean(out.instagram);
    out.has_linkedin = Boolean(out.linkedin);
    out.has_facebook = Boolean(out.facebook);
  } catch (e) {
    console.warn('[social-research] presence enrich failed name_len=%s %s', name.length, e.message || e);
  }
  return out;
}

function runPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    for (;;) {
      const idx = i;
      i += 1;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(Math.max(Number(concurrency) || 4, 1), 8);
  return Promise.all(Array.from({ length: n }, () => worker())).then(() => results);
}

function truthy(v, defaultValue = false) {
  if (v === undefined || v === null || v === '') return defaultValue;
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return defaultValue;
}

export async function discoverBusinesses(ownerUserId, opts = {}, { createdByAgentId } = {}) {
  const parsed = parsePlacesSearchText(opts.intent || opts.prompt || opts.query || '', opts);
  const locality = parsed.locality;
  const businessType = parsed.business_type;
  const query = String(opts.query || '').trim();
  if (!locality && !query && !(Number.isFinite(Number(opts.lat)) && Number.isFinite(Number(opts.lng)))) {
    const err = new Error('locality (or lat/lng) is required');
    err.status = 400;
    throw err;
  }

  const maxResults = Math.min(Math.max(parsed.max_results || Number(opts.max_results || opts.limit) || 20, 1), 50);
  const minRating = opts.min_rating != null ? Number(opts.min_rating) : null;
  const radiusKm = parsed.radius_km != null ? parsed.radius_km : 3;
  const radius = Number(opts.radius_meters) || radiusKm * 1000 || 3000;
  const enrich = opts.enrich !== false;
  const handoff = truthy(opts.handoff, false);
  const persist = truthy(opts.persist, handoff);

  let geo = null;
  if (locality && !(Number.isFinite(Number(opts.lat)) && Number.isFinite(Number(opts.lng)))) {
    geo = await geocodeLocality(ownerUserId, { locality });
  }
  const lat = Number.isFinite(Number(opts.lat)) ? Number(opts.lat) : geo?.lat;
  const lng = Number.isFinite(Number(opts.lng)) ? Number(opts.lng) : geo?.lng;

  const textQuery =
    (query && query.length < 180 ? query : '') ||
    [businessType || 'businesses', locality ? `in ${locality}` : ''].filter(Boolean).join(' ');

  let search;
  if (businessType && Number.isFinite(lat) && Number.isFinite(lng)) {
    search = await nearbySearch(ownerUserId, {
      lat,
      lng,
      locality,
      radius_meters: radius,
      included_type: businessType,
      min_rating: minRating,
      max_results: maxResults,
      rank_preference: opts.rank_preference,
    });
    if (!search.places?.length) {
      search = await textSearchPlaces(ownerUserId, {
        query: textQuery,
        lat,
        lng,
        locality,
        radius_meters: radius,
        included_type: businessType,
        min_rating: minRating,
        max_results: maxResults,
      });
    }
  } else {
    search = await textSearchPlaces(ownerUserId, {
      query: textQuery,
      lat,
      lng,
      locality,
      radius_meters: radius,
      included_type: businessType,
      min_rating: minRating,
      max_results: maxResults,
    });
  }

  let places = (search.places || []).map((p) => ({
    ...p,
    locality,
    business_type: businessType,
  }));

  if (enrich && places.length) {
    places = await runPool(places, 4, (p) => enrichPresence(ownerUserId, p, locality));
  }

  const index = loadOpportunityIndex(ownerUserId);
  const fresh = [];
  const duplicates = [];
  for (const p of places) {
    const existing = lookupOpportunity(index, p);
    const row = {
      ...p,
      fingerprint: fingerprintFor(p),
      previously_identified: Boolean(existing),
      prior_status: existing?.status || '',
      prior_kanban_task_id: existing?.kanban_task_id || '',
    };
    if (existing) duplicates.push(row);
    else fresh.push(row);
  }

  let kanban = null;
  let recorded = null;
  if (handoff && (fresh.length || duplicates.length)) {
    kanban = createDiscoveryKanbanTask({
      ownerUserId,
      createdByAgentId: createdByAgentId || null,
      title: `Leads: ${textQuery}`.slice(0, 180),
      query: textQuery,
      newLeads: fresh,
      skippedLeads: duplicates,
    });
    recorded = recordOpportunities(ownerUserId, [...fresh, ...duplicates], {
      status: 'handed_to_crm',
      kanbanTaskId: kanban.task_id,
    });
  } else if (persist && (fresh.length || duplicates.length)) {
    recorded = recordOpportunities(ownerUserId, [...fresh, ...duplicates], { status: 'identified' });
  }

  const crmAgentId = findCrmHandoffAgentId(ownerUserId);
  console.info(
    '[social-research] discover locality_len=%s type=%s places=%s persist=%s handoff=%s',
    locality.length,
    businessType,
    places.length,
    persist,
    handoff
  );

  return {
    ok: true,
    query: textQuery,
    locality,
    business_type: businessType,
    lat: lat ?? null,
    lng: lng ?? null,
    radius_meters: radius,
    min_rating: minRating,
    count: places.length,
    new_count: persist || handoff ? fresh.length : 0,
    duplicate_count: duplicates.length,
    persist,
    handoff,
    businesses: [...fresh, ...duplicates],
    knowledge_table: recorded?.table_name || null,
    knowledge_table_id: recorded?.table_id || null,
    kanban,
    crm_agent_id: crmAgentId,
    handoff_target: handoff ? (crmAgentId ? 'crm_agent' : 'ceo') : null,
    key_source: search.key_source,
    using_byok: search.using_byok,
  };
}
