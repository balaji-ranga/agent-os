/**
 * Seed Social Research + Business Discovery content tools.
 */
import { getDb } from './schema.js';

export const SOCIAL_RESEARCH_TOOLS = [
  {
    name: 'social_research_search',
    display_name: 'Social research search',
    endpoint: '/api/tools/social-research-search',
    method: 'POST',
    purpose:
      'API tool: public web/search for LinkedIn, X, Facebook, Instagram (Brave indexed results). Pass query (required), optional site, count (1–20), days. Not a crawler. Do not use exec.',
    model_used: 'Brave Search API',
  },
  {
    name: 'social_research_instagram',
    display_name: 'Social research Instagram',
    endpoint: '/api/tools/social-research-instagram',
    method: 'POST',
    purpose:
      'API tool: Instagram public research. Instaloader with optional vault INSTAGRAM_SESSIONID; otherwise hydrates /p/{shortcode}/ URLs (real image CDN + caption hint). Indexed hits stay in indexed_results and are not a post feed. Pass handle or brand, optional days (default 30). Do not use exec.',
    model_used: 'Instaloader / Instagram media / Brave Search',
  },
  {
    name: 'social_research_x',
    display_name: 'Social research X',
    endpoint: '/api/tools/social-research-x',
    method: 'POST',
    purpose:
      'API tool: X/Twitter research. Official API v2 when X_BEARER_TOKEN or vault X_API_BYOK is set; otherwise hydrates status URLs (tweet text + media). Indexed hits stay in indexed_results. Pass handle or brand, optional days. Do not use exec.',
    model_used: 'X API / fxtwitter / Brave Search',
  },
  {
    name: 'social_research_facebook',
    display_name: 'Social research Facebook',
    endpoint: '/api/tools/social-research-facebook',
    method: 'POST',
    purpose:
      'API tool: Facebook research. Uses Meta Graph when the CEO has Connectors → MCPs Facebook connected (owned Pages only); otherwise public indexed search. Pass brand, optional days. Indexed hits are not Page posts. Do not use exec.',
    model_used: 'Meta Graph / Brave Search',
  },
  {
    name: 'social_research_profile',
    display_name: 'Social research profile',
    endpoint: '/api/tools/social-research-profile',
    method: 'POST',
    purpose:
      'API tool: analyse a brand across Instagram, X, LinkedIn, Facebook for a time window. Pass brand (required), optional handle, platforms[], days (default 30). Use posts[] for actual posts; indexed_results are search hits only. Do not use exec.',
    model_used: 'Social Research adapters',
  },
  {
    name: 'google_places_geocode',
    display_name: 'Google Places geocode',
    endpoint: '/api/tools/google-places-geocode',
    method: 'POST',
    purpose:
      'API tool: geocode a locality via Google Places API (New). Pass locality. Key: Platform default uses GOOGLE_PLACES_API_KEY; other Profiles use vault GOOGLE_PLACES_BYOK. Do not use exec.',
    model_used: 'Google Places API (New)',
  },
  {
    name: 'google_places_nearby',
    display_name: 'Google Places nearby',
    endpoint: '/api/tools/google-places-nearby',
    method: 'POST',
    purpose:
      'API tool: Nearby Search (New) around lat/lng or locality. Pass locality or lat/lng, optional radius_meters, business_type, min_rating, max_results, rank_preference (POPULARITY|DISTANCE). Do not use exec.',
    model_used: 'Google Places API (New)',
  },
  {
    name: 'business_discover',
    display_name: 'Business discover',
    endpoint: '/api/tools/business-discover',
    method: 'POST',
    purpose:
      'API tool: find local businesses via Google Places API (New), enrich public website/Instagram/LinkedIn URLs, optionally persist Knowledge discovered_opportunities and Kanban-handoff to CRM. Pass intent (CEO wording) and/or locality + business_type. Optional radius_km, max_results, persist, handoff (default false). Ranking, tracking, and CRM Act are existing goal-plan / master_data / kanban tools — not this pipeline. Do not use exec.',
    model_used: 'Google Places API (New) + Social Research',
  },
];

export const SOCIAL_RESEARCH_TOOL_NAMES = SOCIAL_RESEARCH_TOOLS.map((t) => t.name);

export function seedSocialResearchToolsIfMissing() {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint, method, purpose, model_used, enabled, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1)`
  );
  const update = db.prepare(
    'UPDATE content_tools_meta SET purpose = ?, display_name = ?, endpoint = ?, method = ?, model_used = ? WHERE name = ?'
  );
  for (const t of SOCIAL_RESEARCH_TOOLS) {
    insert.run(t.name, t.display_name, t.endpoint, t.method, t.purpose, t.model_used);
    update.run(t.purpose, t.display_name, t.endpoint, t.method, t.model_used, t.name);
  }
  console.info('[startup] social research tools seeded (%s)', SOCIAL_RESEARCH_TOOLS.length);
}

const GRANT_BASE_IDS = ['socialresearcher', 'businessdiscovery'];

function socialResearchGrantBase(agent) {
  const id = String(agent?.id || '');
  const idBase = id.includes('--') ? id.split('--').pop() : id;
  if (GRANT_BASE_IDS.includes(idBase)) return idBase;
  return null;
}

export function grantSocialResearchToolsToAgents() {
  const db = getDb();
  const agents = db.prepare('SELECT id FROM agents').all();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)'
  );
  let n = 0;
  for (const a of agents) {
    const base = socialResearchGrantBase(a);
    if (!base) continue;
    const names =
      base === 'socialresearcher'
        ? SOCIAL_RESEARCH_TOOL_NAMES.filter((n) => n !== 'business_discover')
        : SOCIAL_RESEARCH_TOOL_NAMES;
    const extra =
      base === 'socialresearcher'
        ? ['brave_web_search', 'summarize_url', 'learnings_summary', 'notify_ceo', 'kanban_move_status']
        : [
            'brave_web_search',
            'summarize_url',
            'learnings_summary',
            'notify_ceo',
            'kanban_create_task',
            'kanban_move_status',
            'master_data_list_tables',
            'master_data_list_rows',
            'master_data_insert_row',
            'master_data_rag',
            'master_data_index_document',
            'agent_goal_create',
            'agent_goal_list',
            'agent_goal_status',
          ];
    for (const name of [...names, ...extra]) {
      const info = insert.run(a.id, name);
      n += info.changes || 0;
    }
  }
  if (n > 0) {
    console.info('[startup] granted social research tools to %s grant(s)', n);
  }
  return n;
}
