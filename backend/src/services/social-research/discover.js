/**
 * Business Discovery: Places search → online presence → Knowledge dedup → Kanban CRM/CEO handoff.
 */
import { geocodeLocality, nearbySearch, textSearchPlaces } from './adapters/google-places.js';
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
    if (hostRe.test(u)) return u;
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

export async function discoverBusinesses(ownerUserId, opts = {}, { createdByAgentId } = {}) {
  const locality = String(opts.locality || opts.location || '').trim();
  const businessType = String(opts.business_type || opts.type || opts.included_type || '').trim();
  const query = String(opts.query || '').trim();
  if (!locality && !query && !(Number.isFinite(Number(opts.lat)) && Number.isFinite(Number(opts.lng)))) {
    const err = new Error('locality (or lat/lng) is required');
    err.status = 400;
    throw err;
  }

  const maxResults = Math.min(Math.max(Number(opts.max_results || opts.limit) || 20, 1), 50);
  const minRating = opts.min_rating != null ? Number(opts.min_rating) : null;
  const radius =
    Number(opts.radius_meters) ||
    (opts.radius_km != null && opts.radius_km !== '' ? Number(opts.radius_km) * 1000 : 3000) ||
    3000;
  const enrich = opts.enrich !== false;
  const handoff = opts.handoff !== false;

  let geo = null;
  if (locality && !(Number.isFinite(Number(opts.lat)) && Number.isFinite(Number(opts.lng)))) {
    geo = await geocodeLocality(ownerUserId, { locality });
  }
  const lat = Number.isFinite(Number(opts.lat)) ? Number(opts.lat) : geo?.lat;
  const lng = Number.isFinite(Number(opts.lng)) ? Number(opts.lng) : geo?.lng;

  const textQuery =
    query ||
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
  } else if (fresh.length || duplicates.length) {
    recorded = recordOpportunities(ownerUserId, [...fresh, ...duplicates], { status: 'identified' });
  }

  const crmAgentId = findCrmHandoffAgentId(ownerUserId);
  console.info(
    '[social-research] discover locality_len=%s type_len=%s places=%s fresh=%s dup=%s crm=%s',
    locality.length,
    businessType.length,
    places.length,
    fresh.length,
    duplicates.length,
    crmAgentId || 'ceo'
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
    new_count: fresh.length,
    duplicate_count: duplicates.length,
    businesses: [...fresh, ...duplicates],
    knowledge_table: recorded?.table_name || 'discovered_opportunities',
    knowledge_table_id: recorded?.table_id || null,
    kanban,
    crm_agent_id: crmAgentId,
    handoff_target: crmAgentId ? 'crm_agent' : 'ceo',
    key_source: search.key_source,
    using_byok: search.using_byok,
  };
}
