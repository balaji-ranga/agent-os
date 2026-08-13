/**
 * Business Discovery modes: Discover → Research → Track → Act.
 * Maps CEO wording onto one or more modes and extracts Places args from free text.
 */

export const MODES = ['discover', 'research', 'track', 'act'];

const TYPE_HINTS = [
  { re: /\bdental clinics?\b|\bdentists?\b|\bdental\b/i, type: 'dentist' },
  { re: /\bgyms?\b|\bfitness\b/i, type: 'gym' },
  { re: /\brestaurants?\b/i, type: 'restaurant' },
  { re: /\bcafes?\b|\bcoffee\b/i, type: 'cafe' },
  { re: /\bhotels?\b|\blodging\b/i, type: 'lodging' },
  { re: /\bpharmac(?:y|ies)\b/i, type: 'pharmacy' },
  { re: /\bsalons?\b|\bhair\b/i, type: 'hair_salon' },
  { re: /\bspas?\b/i, type: 'spa' },
  { re: /\bclinics?\b|\bdoctors?\b/i, type: 'doctor' },
  { re: /\bhospitals?\b/i, type: 'hospital' },
  { re: /\bbanks?\b/i, type: 'bank' },
  { re: /\bschools?\b/i, type: 'school' },
  { re: /\bsupermarkets?\b|\bgrocer(?:y|ies)\b/i, type: 'supermarket' },
];

function blobFrom(opts = {}) {
  return [
    opts.mode,
    opts.intent,
    opts.prompt,
    opts.query,
    opts.message,
    opts.locality,
    opts.business_type,
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}

function modeTextFrom(opts = {}) {
  return [opts.mode, opts.intent, opts.prompt, opts.query, opts.message]
    .filter(Boolean)
    .join('\n')
    .trim();
}

function truthy(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return null;
}

function hasAny(text, res) {
  return res.some((re) => re.test(text));
}

function extractBusinessType(text, explicit) {
  const given = String(explicit || '').trim();
  if (given) return given;
  for (const h of TYPE_HINTS) {
    if (h.re.test(text)) return h.type;
  }
  return '';
}

function extractRadiusKm(text, opts = {}) {
  if (opts.radius_km != null && opts.radius_km !== '') {
    const n = Number(opts.radius_km);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (opts.radius_meters != null && opts.radius_meters !== '') {
    const n = Number(opts.radius_meters);
    if (Number.isFinite(n) && n > 0) return n / 1000;
  }
  const m =
    String(text || '').match(/\bwithin\s+(\d+(?:\.\d+)?)\s*k(?:m|ilomet(?:er|re)s?)\b/i) ||
    String(text || '').match(/\b(\d+(?:\.\d+)?)\s*k(?:m|ilomet(?:er|re)s?)\s+(?:of|from|around|near)\b/i) ||
    String(text || '').match(/\bradius\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*k(?:m|ilomet(?:er|re)s?)\b/i);
  if (m) return Number(m[1]);
  return null;
}

function extractMaxResults(text, opts = {}) {
  if (opts.max_results != null && opts.max_results !== '') {
    const n = Number(opts.max_results);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (opts.limit != null && opts.limit !== '') {
    const n = Number(opts.limit);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const m =
    String(text || '').match(/\bup to\s+(\d+)\s+business/i) ||
    String(text || '').match(/\bfind\s+(?:up to\s+)?(\d+)\s+business/i) ||
    String(text || '').match(/\b(?:max(?:imum)?|at most)\s+(\d+)\b/i);
  if (m) return Number(m[1]);
  return null;
}

function extractLocality(text, explicit) {
  const given = String(explicit || '').trim();
  if (given) return given;
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const within = t.match(
    /\bwithin\s+\d+(?:\.\d+)?\s*k(?:m|ilomet(?:er|re)s?)\s+of\s+([^.\n]+?)(?:\.|$)/i
  );
  if (within) return within[1].replace(/\s+/g, ' ').trim();
  const near = t.match(/\b(?:near|around|in)\s+([A-Z][A-Za-z0-9 .,'-]{2,80}?)(?:\.|$)/);
  if (near) {
    const loc = near[1].replace(/\s+/g, ' ').trim();
    if (!/^(their|the|this|that|more|depth)\b/i.test(loc)) return loc;
  }
  return '';
}

function forbidTrack(text) {
  return /\bdo not (?:permanently )?track\b|\bdon'?t (?:permanently )?track\b|\bunless i ask\b.*\btrack\b|\bno tracking\b/i.test(
    text
  );
}

function forbidAct(text) {
  return /\bdo not (?:save|handoff|email|act)\b|\bdon'?t (?:save|handoff)\b|\bunless i ask\b.*\b(crm|save)\b/i.test(
    text
  );
}

/**
 * Infer which pipeline modes this request should run.
 * Research includes Discover. Track/Act are opt-in unless the CEO clearly asked.
 */
export function inferDiscoverModes(opts = {}) {
  const rawMode = String(opts.mode || '').trim().toLowerCase();
  const text = modeTextFrom(opts);
  const lower = text.toLowerCase();

  if (rawMode === 'auto' || !rawMode) {
    /* fall through */
  } else if (MODES.includes(rawMode)) {
    const modes = rawMode === 'discover' ? ['discover'] : ['discover', rawMode];
    if (rawMode === 'track') modes.splice(1, 0, 'research');
    if (rawMode === 'act') modes.splice(1, 0, 'research');
    return uniqueModes(modes);
  } else if (rawMode.includes(',')) {
    return uniqueModes(
      rawMode
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => MODES.includes(s))
    );
  }

  const wantsResearch = hasAny(lower, [
    /\bresearch\b/,
    /\btell me about\b/,
    /\bonline presence\b/,
    /\bdigital(?:\/social)?(?:\s+or\s+social)?(?:-|\s+)?(?:media\s+)?presence\b/,
    /\bsocial media\b/,
    /\binstagram\b/,
    /\blinkedin\b/,
    /\bwebsite\b/,
    /\brank\b/,
    /\bprospects?\b/,
    /\bpromotions?\b/,
    /\bcampaigns?\b/,
  ]);
  const wantsTrack =
    !forbidTrack(lower) &&
    hasAny(lower, [
      /\btell me what changes\b/,
      /\bwhat(?:'s| is) (?:new|changed)\b/,
      /\btrack(?:ing)?\b/,
      /\bwatch(?:ing)?\b/,
      /\bmonitor(?:ing)?\b/,
      /\bkeep (?:an )?eye\b/,
    ]);
  const wantsAct =
    !forbidAct(lower) &&
    hasAny(lower, [
      /\bsave\b.{0,80}\bcrm\b/,
      /\badd\b.{0,80}\bcrm\b/,
      /\bhandoff\b/,
      /\bcreate (?:a )?kanban\b/,
      /\bsend (?:an? )?email\b/,
      /\bemail them\b/,
      /\bpost (?:on|to) (?:instagram|linkedin|facebook|social)\b/,
      /\brun (?:a )?workflow\b/,
      /\bdo something about (?:it|them)\b/,
    ]);
  const discoverOnly =
    !wantsResearch &&
    !wantsTrack &&
    !wantsAct &&
    hasAny(lower, [/\bfind businesses\b/, /\blist (?:nearby|local) businesses\b/, /\bjust (?:find|list)\b/]);

  if (discoverOnly) return ['discover'];

  const modes = ['discover', 'research'];
  if (wantsTrack) modes.push('track');
  if (wantsAct) modes.push('act');
  return uniqueModes(modes);
}

function uniqueModes(list) {
  const out = [];
  for (const m of MODES) {
    if (list.includes(m)) out.push(m);
  }
  return out.length ? out : ['discover', 'research'];
}

export function parseDiscoverIntent(opts = {}) {
  const text = blobFrom(opts);
  const modes = inferDiscoverModes(opts);
  const locality = extractLocality(text, opts.locality || opts.location);
  const businessType = extractBusinessType(text, opts.business_type || opts.type || opts.included_type);
  const radiusKm = extractRadiusKm(text, opts);
  const maxResults = extractMaxResults(text, opts);
  const persistExplicit = truthy(opts.persist);
  const handoffExplicit = truthy(opts.handoff);
  const trackForbidden = forbidTrack(text);
  const actForbidden = forbidAct(text);

  const persist =
    persistExplicit != null
      ? persistExplicit
      : modes.includes('act') || (modes.includes('track') && !trackForbidden);
  const handoff =
    handoffExplicit != null ? handoffExplicit : modes.includes('act') && !actForbidden;

  return {
    modes,
    modes_skipped: MODES.filter((m) => !modes.includes(m)),
    locality,
    business_type: businessType,
    radius_km: radiusKm,
    max_results: maxResults,
    persist,
    handoff: handoff && !actForbidden,
    reuse_cache: truthy(opts.reuse_cache) !== false,
    cache_ttl_days: Math.min(Math.max(Number(opts.cache_ttl_days) || 7, 1), 90),
    plan_goal: truthy(opts.plan_goal) !== false,
    intent_text: text,
  };
}

export function nextActionPrompt(modes, { topN = 5 } = {}) {
  if (modes.includes('act')) {
    return `Saved the top prospects for follow-up. Say if you want a deeper research pass or a workflow on any one business.`;
  }
  if (modes.includes('track')) {
    return `Would you like me to keep tracking these businesses, save the top ${topN} to CRM, or research any one in more depth?`;
  }
  if (modes.includes('research')) {
    return `Would you like me to save these ${topN} prospects to CRM or research them in more depth?`;
  }
  return `Would you like me to research their websites and social presence, or save them to CRM?`;
}

export function goalStepsForModes(modes, { locality = '', businessType = '' } = {}) {
  const loc = locality || 'the locality';
  const kind = businessType || 'businesses';
  const steps = [];
  if (modes.includes('discover')) {
    steps.push({
      type: 'agent_tool',
      label: `Discover ${kind} (Google Places)`,
      tool_name: 'google_places_nearby',
      spec: { tool_name: 'google_places_nearby', args: { locality: loc, business_type: kind } },
    });
  }
  if (modes.includes('research')) {
    steps.push({
      type: 'agent_continue',
      label: 'Research websites',
      spec: { message: 'Website quality, services, promotions' },
    });
    steps.push({
      type: 'agent_continue',
      label: 'Research Instagram / LinkedIn',
      spec: { message: 'Public social presence and recency' },
    });
    steps.push({
      type: 'agent_continue',
      label: 'Reuse local index if current',
      spec: { message: 'Owner-scoped Knowledge / OpenSearch cache' },
    });
    steps.push({
      type: 'agent_continue',
      label: 'Enrich, reason, and rank prospects',
      spec: { message: 'Reputation vs digital presence' },
    });
  }
  if (modes.includes('track')) {
    steps.push({
      type: 'agent_tool',
      label: 'Track changes (OpenSearch)',
      tool_name: 'master_data_rag',
      spec: { tool_name: 'master_data_rag', args: { query: `${kind} ${loc}` } },
    });
  }
  if (modes.includes('act')) {
    steps.push({
      type: 'agent_continue',
      label: 'Act — CRM / Kanban handoff',
      spec: { message: 'Persist opportunities and create CRM or CEO Kanban' },
    });
  }
  return steps;
}
