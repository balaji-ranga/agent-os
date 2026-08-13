/**
 * Business Discovery pipeline: Discover → Research → Track → Act.
 * Default research runs do not persist or CRM-handoff unless the CEO asked.
 */
import { geocodeLocality, nearbySearch, textSearchPlaces } from './adapters/google-places.js';
import { searchSite, webSearch } from './adapters/web-search.js';
import {
  fingerprintFor,
  loadOpportunityIndex,
  lookupOpportunity,
  recordOpportunities,
} from './opportunities-knowledge.js';
import { createDiscoveryKanbanTask, findCrmHandoffAgentId } from './crm-handoff.js';
import { ragDocumentsForAgent, indexDocumentForAgent } from '../master-data-tools.js';
import { parseDiscoverIntent, nextActionPrompt } from './discover-intent.js';
import {
  buildResearchBrief,
  extractServicesAndPromos,
  isCacheFresh,
  parseCachedResearch,
  websiteQuality,
} from './discover-score.js';
import {
  startDiscoveryGoalPlan,
  completeDiscoveryGoalStep,
  failDiscoveryGoal,
} from './discover-goal-plan.js';

const SOCIAL_PROFILE_RE = {
  instagram: /instagram\.com\/(?!p\/|reel\/|stories\/)[A-Za-z0-9._]+/i,
  linkedin: /linkedin\.com\/(company|in|school)\//i,
  facebook: /facebook\.com\/(?!sharer|dialog)/i,
};

function firstSocialUrl(results, hostRe) {
  for (const r of results || []) {
    const u = String(r.url || '');
    if (hostRe.test(u)) return u.split('?')[0];
  }
  return '';
}

function firstOwnedWebsite(results, placeWebsite) {
  if (placeWebsite && websiteQuality(placeWebsite) === 'Good') return placeWebsite;
  for (const r of results || []) {
    const u = String(r.url || '');
    if (websiteQuality(u) === 'Good') return u;
  }
  return placeWebsite || '';
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

async function enrichPresence(ownerUserId, place, locality, { reuse } = {}) {
  if (reuse && typeof reuse === 'object') {
    return {
      ...place,
      ...reuse,
      locality: locality || place.locality || reuse.locality || '',
      reused: true,
    };
  }
  const name = place.name || '';
  const loc = locality || '';
  const q = `${name} ${loc}`.trim();
  const out = {
    ...place,
    locality: loc,
    instagram: place.instagram || '',
    linkedin: place.linkedin || '',
    facebook: place.facebook || '',
    has_website: Boolean(place.website),
    has_instagram: Boolean(place.instagram),
    has_linkedin: Boolean(place.linkedin),
    has_facebook: Boolean(place.facebook),
    instagram_status: place.instagram ? 'Inactive' : 'None',
    last_posted: '',
    main_services: '',
    promotions: '',
    reused: false,
  };
  if (!name) return out;
  try {
    const general = await webSearch(ownerUserId, { query: q, count: 8 });
    const results = general.results || [];
    out.instagram = out.instagram || firstSocialUrl(results, SOCIAL_PROFILE_RE.instagram);
    out.linkedin = out.linkedin || firstSocialUrl(results, SOCIAL_PROFILE_RE.linkedin);
    out.facebook = out.facebook || firstSocialUrl(results, SOCIAL_PROFILE_RE.facebook);
    out.website = firstOwnedWebsite(results, out.website);
    const snippets = results.map((r) => r.description || r.title).filter(Boolean);
    const extracted = extractServicesAndPromos(snippets);
    out.main_services = extracted.main_services;
    out.promotions = extracted.promotions;
    if (out.instagram) {
      const recent = await searchSite(ownerUserId, {
        query: name,
        site: 'instagram.com',
        count: 3,
        days: 30,
      });
      const hits = recent.results || [];
      out.instagram_status = hits.length ? 'Active' : 'Inactive';
      out.last_posted = hits.length ? 'Posted within ~30 days (indexed)' : 'No recent indexed posts';
    } else {
      out.instagram_status = 'None';
      out.last_posted = 'None';
    }
    out.has_website = Boolean(out.website);
    out.has_instagram = Boolean(out.instagram);
    out.has_linkedin = Boolean(out.linkedin);
    out.has_facebook = Boolean(out.facebook);
  } catch (e) {
    console.warn('[social-research] presence enrich failed name_len=%s %s', name.length, e.message || e);
  }
  return out;
}

async function runTrack(ownerUserId, { query, places, persist }) {
  const names = (places || [])
    .map((p) => p.name)
    .filter(Boolean)
    .slice(0, 12)
    .join(', ');
  const ragQuery = `${query} ${names}`.trim().slice(0, 500);
  let rag = { ok: false, hits: [], skipped: true };
  try {
    rag = await ragDocumentsForAgent(ownerUserId, {
      query: ragQuery || query,
      top_k: 8,
      agent_id: 'businessdiscovery',
    });
  } catch (e) {
    rag = { ok: false, error: e.message || String(e), hits: [] };
  }
  let indexed = null;
  if (persist) {
    try {
      const body = [
        `# Business Discovery track snapshot`,
        '',
        `Query: ${query}`,
        `When: ${new Date().toISOString()}`,
        '',
        ...(places || []).slice(0, 20).map((p) => {
          return `- ${p.name || ''} | ${p.rating ?? '—'} / ${p.user_rating_count || 0} | site=${p.website || 'none'} | ig=${p.instagram_status || 'None'}`;
        }),
      ].join('\n');
      indexed = await indexDocumentForAgent(ownerUserId, {
        title: `Business Discovery ${query}`.slice(0, 120),
        filename: `business-discovery-${Date.now()}.md`,
        content_text: body,
        mime_type: 'text/markdown',
        agent_id: 'businessdiscovery',
      });
    } catch (e) {
      indexed = { ok: false, error: e.message || String(e) };
    }
  }
  return {
    rag_ok: Boolean(rag?.ok),
    rag_hit_count: Array.isArray(rag?.chunks)
      ? rag.chunks.length
      : Array.isArray(rag?.hits)
        ? rag.hits.length
        : Array.isArray(rag?.results)
          ? rag.results.length
          : 0,
    indexed: indexed?.id || indexed?.document?.id || null,
    note: persist
      ? 'Indexed this snapshot into your OpenSearch documents.'
      : 'Read-only check against your indexed documents; nothing new was stored.',
  };
}

function summarizeGoal(goal) {
  if (!goal?.id) return null;
  return {
    id: goal.id,
    status: goal.status,
    title: goal.title,
    steps: (goal.steps || []).map((s) => ({
      id: s.id,
      label: s.label,
      status: s.status,
      step_type: s.step_type,
    })),
  };
}

export async function discoverBusinesses(ownerUserId, opts = {}, { createdByAgentId } = {}) {
  const parsed = parseDiscoverIntent(opts);
  const locality = parsed.locality;
  const businessType = parsed.business_type;
  const query = String(opts.query || parsed.intent_text || '').trim();
  if (!locality && !query && !(Number.isFinite(Number(opts.lat)) && Number.isFinite(Number(opts.lng)))) {
    const err = new Error('locality (or lat/lng) is required');
    err.status = 400;
    throw err;
  }

  const maxResults = Math.min(Math.max(parsed.max_results || Number(opts.max_results || opts.limit) || 20, 1), 50);
  const minRating = opts.min_rating != null ? Number(opts.min_rating) : null;
  const radiusKm = parsed.radius_km != null ? parsed.radius_km : 3;
  const radius = Number(opts.radius_meters) || radiusKm * 1000 || 3000;
  const modes = parsed.modes;
  const doResearch = modes.includes('research');
  const doTrack = modes.includes('track');
  const doAct = modes.includes('act');
  const persist = Boolean(parsed.persist);
  const handoff = Boolean(parsed.handoff);
  const topN = Math.min(Math.max(Number(opts.top_n) || 5, 1), 10);

  let goal = null;
  if (parsed.plan_goal) {
    try {
      goal = startDiscoveryGoalPlan({
        ownerUserId,
        agentId: createdByAgentId || 'businessdiscovery',
        prompt: parsed.intent_text || query,
        title: `Research ${businessType || 'businesses'} near ${locality || 'location'}`.slice(0, 120),
        modes,
        locality,
        businessType,
      });
    } catch (e) {
      console.warn('[social-research] goal plan create failed: %s', e.message || e);
    }
  }

  try {
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

    if (goal) {
      goal = completeDiscoveryGoalStep(goal, 'discover', {
        tool_name: 'google_places_nearby',
        count: places.length,
        locality,
        business_type: businessType,
        radius_meters: radius,
      });
    }

    const index = loadOpportunityIndex(ownerUserId);
    let reusedCount = 0;
    if (doResearch && places.length) {
      places = await runPool(places, 4, (p) => {
        const existing = lookupOpportunity(index, p);
        const cached = parseCachedResearch(existing);
        const fresh = parsed.reuse_cache && existing && isCacheFresh(existing, parsed.cache_ttl_days) && cached;
        if (fresh) reusedCount += 1;
        return enrichPresence(ownerUserId, p, locality, { reuse: fresh ? cached : null });
      });
    }

    if (goal && doResearch) {
      goal = completeDiscoveryGoalStep(goal, 'website', {
        tool_name: 'brave_web_search',
        researched: places.length,
        reused: reusedCount,
      });
      goal = completeDiscoveryGoalStep(goal, 'instagram', {
        with_instagram: places.filter((p) => p.has_instagram).length,
        active: places.filter((p) => p.instagram_status === 'Active').length,
      });
      goal = completeDiscoveryGoalStep(goal, 'index', {
        knowledge_table: 'discovered_opportunities',
        reused: reusedCount,
        cache_ttl_days: parsed.cache_ttl_days,
        persisted: persist,
      });
    }

    const nextAction = nextActionPrompt(modes, { topN });
    const { ranked, brief, brief_markdown } = doResearch
      ? buildResearchBrief(places, { topN, nextAction })
      : { ranked: places, brief: { table: [], top_prospects: [], next_action: nextAction }, brief_markdown: '' };
    places = ranked.length ? ranked : places;

    if (goal && doResearch) {
      goal = completeDiscoveryGoalStep(goal, 'rank', {
        top_n: brief.top_prospects?.length || 0,
        lead: brief.top_opportunity?.business || '',
      });
    }

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
        researched_at: new Date().toISOString(),
        research_json: JSON.stringify({
          website: p.website || '',
          instagram: p.instagram || '',
          linkedin: p.linkedin || '',
          facebook: p.facebook || '',
          instagram_status: p.instagram_status || '',
          last_posted: p.last_posted || '',
          main_services: p.main_services || '',
          promotions: p.promotions || '',
          locality: p.locality || locality,
        }),
      };
      if (existing) duplicates.push(row);
      else fresh.push(row);
    }

    let track = null;
    if (doTrack) {
      track = await runTrack(ownerUserId, { query: textQuery, places, persist });
      if (goal) {
        goal = completeDiscoveryGoalStep(goal, 'track', {
          tool_name: 'master_data_rag',
          rag_hit_count: track.rag_hit_count,
          indexed: track.indexed,
        });
      }
    }

    let kanban = null;
    let recorded = null;
    if (doAct && handoff && (fresh.length || duplicates.length)) {
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

    if (goal && doAct) {
      goal = completeDiscoveryGoalStep(goal, 'act', {
        kanban_task_id: kanban?.task_id || null,
        persisted: Boolean(recorded),
      });
    }

    const crmAgentId = findCrmHandoffAgentId(ownerUserId);
    console.info(
      '[social-research] discover modes=%s locality_len=%s type=%s places=%s reused=%s persist=%s handoff=%s goal=%s',
      modes.join(','),
      locality.length,
      businessType,
      places.length,
      reusedCount,
      persist,
      handoff,
      goal?.id || ''
    );

    return {
      ok: true,
      modes_used: modes,
      modes_skipped: parsed.modes_skipped,
      pipeline: 'discover → research → track → act',
      query: textQuery,
      locality,
      business_type: businessType,
      lat: lat ?? null,
      lng: lng ?? null,
      radius_meters: radius,
      min_rating: minRating,
      count: places.length,
      new_count: persist ? fresh.length : 0,
      duplicate_count: persist ? duplicates.length : duplicates.length,
      reused_count: reusedCount,
      persist,
      handoff,
      businesses: places.map((p) => ({
        ...p,
        instagram_url: p.instagram_url || (/instagram\.com/i.test(String(p.instagram || '')) ? p.instagram : ''),
        linkedin_url: p.linkedin_url || p.linkedin,
        facebook_url: p.facebook_url || p.facebook,
      })),
      brief,
      brief_markdown,
      top_prospects: brief.top_prospects || [],
      next_action: nextAction,
      track,
      knowledge_table: recorded?.table_name || (persist ? 'discovered_opportunities' : null),
      knowledge_table_id: recorded?.table_id || null,
      kanban,
      crm_agent_id: crmAgentId,
      handoff_target: handoff ? (crmAgentId ? 'crm_agent' : 'ceo') : null,
      goal_run_id: goal?.id || null,
      goal_plan: summarizeGoal(goal),
      key_source: search.key_source,
      using_byok: search.using_byok,
      agent_instructions:
        'Present brief_markdown (or brief.table) to the CEO. Quote goal_run_id so the Goal Plan panel appears. Do not save to CRM or start tracking unless they said yes to next_action. Do not invent ratings or URLs.',
    };
  } catch (e) {
    if (goal) {
      try {
        failDiscoveryGoal(goal, e.message || String(e));
      } catch (_) {}
      e.goal_run_id = goal.id;
    }
    throw e;
  }
}
