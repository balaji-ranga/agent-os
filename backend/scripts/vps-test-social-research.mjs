/**
 * VPS / local: Social Researcher + Business Discovery (no extra keys required).
 *
 * Live Places Nearby/Discover is skipped when GOOGLE_PLACES_API_KEY / BYOK is absent
 * (asserts the structured 503). Brave + Instaloader + Exchange + agent chat are exercised.
 *
 * Usage (backend container):
 *   node scripts/vps-test-social-research.mjs
 *   SKIP_CHAT=1 node scripts/vps-test-social-research.mjs
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { seedSocialResearchToolsIfMissing, grantSocialResearchToolsToAgents } from '../src/db/seed-social-research-tools.js';
import { seedSocialResearchExchangeAgents } from './seed-social-research-agents.js';
import { fingerprintFor, ensureOpportunitiesTable, recordOpportunities, loadOpportunityIndex, lookupOpportunity } from '../src/services/social-research/opportunities-knowledge.js';
import { createDiscoveryKanbanTask, findCrmHandoffAgentId } from '../src/services/social-research/crm-handoff.js';
import { setUserEnabled } from '../src/services/users.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const skipChat = process.env.SKIP_CHAT === '1' || process.env.SKIP_CHAT === 'true';
const instaloaderUrl = String(process.env.INSTALOADER_URL || 'http://instaloader-sidecar:8083').replace(/\/+$/, '');
const mcpUrl = String(process.env.SOCIAL_RESEARCH_MCP_URL || 'http://social-research-mcp:8084/mcp').replace(/\/mcp\/?$/, '');

let failed = 0;
function ok(cond, msg, extra) {
  if (cond) {
    console.log('OK', msg, extra != null ? extra : '');
    return true;
  }
  failed += 1;
  console.error('FAIL', msg, extra != null ? extra : '');
  return false;
}

initDb();
seedSocialResearchToolsIfMissing();
grantSocialResearchToolsToAgents();
const db = getDb();

const ceo =
  db.prepare(`SELECT id, email FROM platform_users WHERE id = 'ceo-bala'`).get() ||
  db.prepare(`SELECT id, email FROM platform_users WHERE role = 'ceo' AND enabled = 1 ORDER BY created_at LIMIT 1`).get();
if (!ceo) throw new Error('no enabled CEO');
const { token } = createSession(ceo.id, { userAgent: 'vps-test-social-research' });

async function api(method, path, body, headers = {}, timeoutMs = 120000) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function toolHeaders(agentId) {
  return { 'x-openclaw-agent-id': agentId };
}

const seeded = await seedSocialResearchExchangeAgents();
ok(seeded?.ok, 'exchange seed', { owner: seeded?.owner, n: seeded?.published?.length });

const toolNames = [
  'social_research_search',
  'social_research_instagram',
  'social_research_x',
  'social_research_facebook',
  'social_research_profile',
  'google_places_geocode',
  'google_places_nearby',
  'business_discover',
];
for (const name of toolNames) {
  const row = db.prepare('SELECT name, enabled, endpoint FROM content_tools_meta WHERE name = ?').get(name);
  ok(row?.enabled === 1, `tool meta ${name}`, row?.endpoint);
}

const sr = db.prepare(`SELECT * FROM agents WHERE id = 'socialresearcher'`).get();
const bd = db.prepare(`SELECT * FROM agents WHERE id = 'businessdiscovery'`).get();
ok(!!sr, 'socialresearcher agent');
ok(!!bd, 'businessdiscovery agent');

const srGrants = new Set(
  db.prepare('SELECT tool_name FROM agent_tool_grants WHERE agent_id = ?').all('socialresearcher').map((r) => r.tool_name)
);
const bdGrants = new Set(
  db.prepare('SELECT tool_name FROM agent_tool_grants WHERE agent_id = ?').all('businessdiscovery').map((r) => r.tool_name)
);
for (const t of ['social_research_search', 'social_research_instagram', 'social_research_x', 'social_research_facebook', 'social_research_profile', 'brave_web_search']) {
  ok(srGrants.has(t), `socialresearcher grant ${t}`);
}
ok(!srGrants.has('business_discover'), 'socialresearcher does not get business_discover');
for (const t of ['business_discover', 'google_places_geocode', 'google_places_nearby', 'social_research_search', 'master_data_rag', 'summarize_url']) {
  ok(bdGrants.has(t), `businessdiscovery grant ${t}`);
}

const pubs = db
  .prepare(
    `SELECT id, agent_id, name, visibility, status FROM agent_a2a_publications
     WHERE agent_id IN ('socialresearcher','businessdiscovery') AND status = 'published'`
  )
  .all();
ok(
  pubs.some((p) => p.agent_id === 'socialresearcher' && p.visibility === 'flolah'),
  'Social Researcher Flolah listing'
);
ok(
  pubs.some((p) => p.agent_id === 'businessdiscovery' && p.visibility === 'flolah'),
  'Business Discovery Flolah listing'
);

const ocPath = process.env.OPENCLAW_CONFIG_PATH || '/root/.openclaw/openclaw.json';
if (existsSync(ocPath)) {
  const config = JSON.parse(readFileSync(ocPath, 'utf8'));
  const ids = (config.agents?.list || []).map((a) => String(a.id || '').toLowerCase());
  const srRuntime = ids.find((id) => id.includes('--socialresearcher') || id === 'socialresearcher');
  const bdRuntime = ids.find((id) => id.includes('--businessdiscovery') || id === 'businessdiscovery');
  ok(!!srRuntime, 'openclaw socialresearcher runtime', srRuntime);
  ok(!!bdRuntime, 'openclaw businessdiscovery runtime', bdRuntime);
  const allowPath = join(ocPath, '..', 'agent-tool-allowlists.json');
  if (existsSync(allowPath) && srRuntime) {
    const allow = JSON.parse(readFileSync(allowPath, 'utf8'));
    const list = allow[srRuntime] || [];
    ok(list.includes('social_research_profile'), 'allowlist social_research_profile', srRuntime);
    ok(list.includes('social_research_x'), 'allowlist social_research_x', srRuntime);
  }
} else {
  console.log('SKIP openclaw.json (not mounted in this process)');
}

const soulSr = '/root/.openclaw/tenants/ceo-bala/workspace-socialresearcher/SOUL.md';
const soulBd = '/root/.openclaw/tenants/ceo-bala/workspace-businessdiscovery/SOUL.md';
ok(existsSync(soulSr) || existsSync('/opt/agent-os/openclaw-workspace-templates/socialresearcher/SOUL.md'), 'socialresearcher workspace/template');
ok(existsSync(soulBd) || existsSync('/opt/agent-os/openclaw-workspace-templates/businessdiscovery/SOUL.md'), 'businessdiscovery workspace/template');
if (existsSync(soulSr)) {
  const text = readFileSync(soulSr, 'utf8');
  ok(/social_research_profile/i.test(text), 'publisher SOUL mentions social_research_profile');
  ok(/social_research_x/i.test(text) && /posts\[\]/i.test(text), 'publisher SOUL distinguishes posts[] vs search');
  ok(/self-hosted/i.test(text) && /429/i.test(text), 'publisher SOUL explains sidecar vs instagram.com 429');
}

try {
  const igHealth = await fetch(`${instaloaderUrl}/health`, { signal: AbortSignal.timeout(8000) });
  const igj = await igHealth.json().catch(() => ({}));
  ok(igHealth.ok && igj.ok, 'instaloader sidecar health', igj);
  ok(igj.self_hosted === true, 'instaloader sidecar health self_hosted', igj);
} catch (e) {
  ok(false, 'instaloader sidecar health', e.message);
}
try {
  const mcpHealth = await fetch(`${mcpUrl}/health`, { signal: AbortSignal.timeout(8000) });
  const mj = await mcpHealth.json().catch(() => ({}));
  ok(mcpHealth.ok && mj.ok, 'social-research-mcp health', mj);
} catch (e) {
  ok(false, 'social-research-mcp health', e.message);
}

const unauth = await fetch(`${BASE}/api/tools/social-research-search`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'Nike' }),
});
ok(unauth.status === 401, 'tools require auth', unauth.status);

const missing = await api('POST', '/api/tools/social-research-search', {}, toolHeaders('socialresearcher'));
ok(missing.status === 400, 'search requires query', { status: missing.status, error: missing.data.error });

const spoof = await api(
  'POST',
  '/api/tools/social-research-search',
  { query: 'Nike', site: 'linkedin.com', count: 3, ceo_user_id: 'not-this-ceo' },
  toolHeaders('socialresearcher')
);
ok(spoof.status === 200 && spoof.data.ok !== undefined, 'spoofed ceo_user_id ignored (owner from session)', {
  status: spoof.status,
  ok: spoof.data.ok,
  n: spoof.data.results?.length,
});

const braveConfigured = Boolean(String(process.env.BRAVE_API_KEY || '').trim());
ok(braveConfigured, 'BRAVE_API_KEY present (indexed search)');

if (braveConfigured) {
  const searchX = await api(
    'POST',
    '/api/tools/social-research-search',
    { query: 'Nike', site: 'x.com', count: 5, days: 30 },
    toolHeaders('socialresearcher')
  );
  ok(searchX.status === 200 && searchX.data.ok && (searchX.data.results || []).length > 0, 'search Nike site:x.com', {
    status: searchX.status,
    n: searchX.data.results?.length,
    error: searchX.data.error,
    sample: (searchX.data.results || []).slice(0, 2).map((r) => r.url),
  });

  const searchLi = await api(
    'POST',
    '/api/tools/social-research-search',
    { query: 'Nike', site: 'linkedin.com', count: 5 },
    toolHeaders('socialresearcher')
  );
  ok(searchLi.status === 200 && (searchLi.data.results || []).length > 0, 'search Nike site:linkedin.com', {
    n: searchLi.data.results?.length,
    error: searchLi.data.error,
  });

  const ig = await api(
    'POST',
    '/api/tools/social-research-instagram',
    { handle: 'nike', days: 30, limit: 8 },
    toolHeaders('socialresearcher')
  );
  const igPosts = ig.data.posts || [];
  const igOk =
    ig.status === 200 &&
    ig.data.ok &&
    (ig.data.adapter === 'instaloader'
      ? igPosts.length > 0 || ig.data.followers != null
      : igPosts.length > 0);
  ok(igOk, 'instagram nike hydrated posts (not search-only)', {
    status: ig.status,
    adapter: ig.data.adapter,
    fallback: ig.data.fallback,
    posts: igPosts.length,
    with_image: igPosts.filter((p) => p.image_url).length,
    indexed: ig.data.indexed_results?.length,
    instaloader_skipped: ig.data.instaloader?.skipped,
    instaloader_self_hosted: ig.data.instaloader?.self_hosted,
    instaloader_reason: ig.data.instaloader?.reason,
    instagram_http: ig.data.instaloader?.instagram_http,
    instaloader_error: ig.data.instaloader_error,
    next_step: ig.data.next_step,
  });
  ok(ig.data.instaloader?.self_hosted === true, 'instaloader sidecar reported self-hosted');
  ok(
    ig.data.instaloader?.skipped === true || ig.data.adapter === 'instaloader',
    'anonymous instaloader skipped (or session succeeded)',
    ig.data.instaloader
  );
  ok(
    igPosts.every((p) => p.url && /instagram\.com/i.test(p.url)),
    'instagram posts have permalinks',
    igPosts.slice(0, 2).map((p) => p.url)
  );

  const xTool = await api(
    'POST',
    '/api/tools/social-research-x',
    { handle: 'Nike', days: 30, limit: 8 },
    toolHeaders('socialresearcher')
  );
  const xPosts = xTool.data.posts || [];
  ok(
    xTool.status === 200 && xTool.data.ok && xPosts.length > 0,
    'x nike hydrated tweets (not search-only)',
    {
      status: xTool.status,
      adapter: xTool.data.adapter,
      posts: xPosts.length,
      with_text: xPosts.filter((p) => p.text).length,
      sample: xPosts.slice(0, 2).map((p) => ({ url: p.url, text: String(p.text || '').slice(0, 80) })),
      indexed: xTool.data.indexed_results?.length,
      x_api_error: xTool.data.x_api_error,
    }
  );

  const fb = await api(
    'POST',
    '/api/tools/social-research-facebook',
    { brand: 'Nike', days: 30 },
    toolHeaders('socialresearcher')
  );
  ok(fb.status === 200 && fb.data.ok && (fb.data.indexed_results || []).length > 0, 'facebook nike indexed fallback', {
    adapter: fb.data.adapter,
    meta_connected: fb.data.meta_connected,
    indexed: fb.data.indexed_results?.length,
    posts: fb.data.posts?.length,
    reason: fb.data.reason,
  });
  ok(fb.data.meta_connected === false || Array.isArray(fb.data.pages), 'facebook reports meta_connected');

  const profile = await api(
    'POST',
    '/api/tools/social-research-profile',
    { brand: 'Nike', platforms: ['instagram', 'x'], days: 30 },
    toolHeaders('socialresearcher')
  );
  const profileOk =
    profile.status === 200 &&
    profile.data.ok &&
    ((profile.data.instagram?.posts || []).length > 0 || (profile.data.x?.posts || []).length > 0);
  ok(profileOk, 'profile Nike instagram+x hydrated posts', {
    status: profile.status,
    ok: profile.data.ok,
    ig_adapter: profile.data.instagram?.adapter,
    ig_posts: profile.data.instagram?.posts?.length,
    x_adapter: profile.data.x?.adapter,
    x_posts: profile.data.x?.posts?.length,
  });
}

const placesKey = Boolean(String(process.env.GOOGLE_PLACES_API_KEY || '').trim());
const geo = await api(
  'POST',
  '/api/tools/google-places-geocode',
  { locality: 'Tampines, Singapore' },
  toolHeaders('businessdiscovery')
);
const placesLive = geo.status === 200 && geo.data.ok && Number.isFinite(geo.data.lat);
if (!placesLive) {
  ok(geo.status === 503 && geo.data.code === 'google_places_platform_key_missing', 'places geocode 503 without key', {
    status: geo.status,
    code: geo.data.code,
    error: String(geo.data.error || '').slice(0, 160),
  });
  const nearby = await api(
    'POST',
    '/api/tools/google-places-nearby',
    { locality: 'Tampines', business_type: 'dentist', radius_meters: 3000, min_rating: 4.2, plan_goal: false },
    toolHeaders('businessdiscovery')
  );
  ok(nearby.status === 503, 'places nearby 503 without key', nearby.status);
  const disc = await api(
    'POST',
    '/api/tools/business-discover',
    { locality: 'Tampines', business_type: 'dentist', radius_km: 3, min_rating: 4.2, max_results: 5, plan_goal: false },
    toolHeaders('businessdiscovery')
  );
  ok(disc.status === 503, 'business_discover 503 without Places key', disc.status);
} else {
  ok(true, 'places geocode Tampines', {
    lat: geo.data.lat,
    lng: geo.data.lng,
  });
  const TAMPINES_PROMPT = `Research dental clinics within 5 km of Tampines, Singapore.

Find up to 20 businesses using Google Business/Places and research their publicly available online presence.

For each business, identify:

Business name, location, Google rating and number of reviews
Website
Instagram and LinkedIn presence, if available
How recently they have posted on social media
Main services they promote
Any notable promotions or campaigns
Overall quality of their digital/social presence

Identify businesses that appear to have a strong business reputation but weak digital or social-media presence.

Rank the top 5 potential prospects and briefly explain why each is a good opportunity.

Use fresh information where possible. Reuse recently collected data if it is still current; otherwise refresh the source. Do not permanently track these businesses unless I ask you to.`;
  const disc = await api(
    'POST',
    '/api/tools/business-discover',
    { intent: TAMPINES_PROMPT, persist: false, handoff: false },
    toolHeaders('businessdiscovery'),
    180000
  );
  ok(disc.status === 200 && disc.data.ok, 'business_discover Tampines research', {
    status: disc.status,
    error: disc.data.error,
    count: disc.data.count,
    modes: disc.data.modes_used,
    goal: disc.data.goal_run_id,
  });
  ok(
    Array.isArray(disc.data.modes_used) &&
      disc.data.modes_used.includes('discover') &&
      disc.data.modes_used.includes('research') &&
      !disc.data.modes_used.includes('track') &&
      !disc.data.modes_used.includes('act'),
    'Tampines modes discover+research only',
    disc.data.modes_used
  );
  ok(disc.data.persist === false && !disc.data.kanban, 'Tampines did not persist or CRM-handoff', {
    persist: disc.data.persist,
    kanban: disc.data.kanban,
  });
  ok(
    Array.isArray(disc.data.brief?.table) && disc.data.brief.table.length >= 1,
    'research brief table',
    disc.data.brief?.table?.length
  );
  ok(
    Array.isArray(disc.data.top_prospects) && disc.data.top_prospects.length <= 5 && disc.data.top_prospects.length >= 1,
    'top 5 prospects',
    disc.data.top_prospects?.length
  );
  ok(/^agr-/.test(String(disc.data.goal_run_id || '')), 'goal plan agr- id', disc.data.goal_run_id);
  ok(/CRM/i.test(String(disc.data.next_action || '')), 'next action asks CRM', disc.data.next_action);
  if (disc.data.goal_run_id) {
    const plan = db.prepare('SELECT id, status, agent_id FROM agent_goal_runs WHERE id = ? AND owner_user_id = ?').get(
      disc.data.goal_run_id,
      ceo.id
    );
    ok(!!plan, 'goal plan row owner-scoped', plan);
    const steps = db
      .prepare('SELECT label, status FROM agent_goal_steps WHERE goal_run_id = ? ORDER BY step_index')
      .all(disc.data.goal_run_id);
    ok(steps.length >= 4 && steps.every((s) => s.status === 'completed'), 'goal steps completed', steps);
  }
}

const fpPlace = fingerprintFor({ place_id: 'ChIJtest123', name: 'Gym A', locality: 'Tampines' });
const fpName = fingerprintFor({ name: 'Gym C', locality: 'Tampines' });
ok(fpPlace === 'place:chijtest123', 'fingerprint prefers place_id', fpPlace);
ok(fpName.startsWith('name:gym-c|tampines'), 'fingerprint uses name when no place_id', fpName);

const table = ensureOpportunitiesTable(ceo.id);
ok(!!table?.id, 'discovered_opportunities table', table?.id);
const stamp = `vps-sr-${Date.now()}`;
const synthetic = [
  {
    place_id: `${stamp}-a`,
    name: `Probe Gym A ${stamp}`,
    locality: 'Tampines',
    business_type: 'gym',
    rating: 4.6,
    website: 'https://example.com/a',
    instagram: 'https://instagram.com/a',
    linkedin: '',
  },
  {
    place_id: `${stamp}-b`,
    name: `Probe Gym B ${stamp}`,
    locality: 'Tampines',
    business_type: 'gym',
    rating: 4.3,
    website: 'https://example.com/b',
  },
];
const firstWrite = recordOpportunities(ceo.id, synthetic, { status: 'identified' });
ok(firstWrite.written.length === 2, 'knowledge insert 2 new leads', firstWrite.written.length);
const index1 = loadOpportunityIndex(ceo.id);
ok(!!lookupOpportunity(index1, synthetic[0]), 'lookup by place_id');
const nameOnlyLead = { name: `Probe Cafe ${stamp}`, locality: 'Bedok', business_type: 'cafe' };
const nameWrite = recordOpportunities(ceo.id, [nameOnlyLead], { status: 'identified' });
ok(nameWrite.written.length === 1, 'knowledge insert without place_id');
const indexName = loadOpportunityIndex(ceo.id);
ok(!!lookupOpportunity(indexName, { name: nameOnlyLead.name, locality: 'Bedok' }), 'dedup fingerprint uses name when place_id missing');
const nameAgain = recordOpportunities(ceo.id, [{ name: nameOnlyLead.name, locality: 'Bedok' }], { status: 'identified' });
ok(nameAgain.written.length === 0 && nameAgain.skipped.length === 1, 'second name+locality insert is duplicate');

const kanban = createDiscoveryKanbanTask({
  ownerUserId: ceo.id,
  createdByAgentId: 'businessdiscovery',
  title: `TEST Leads: gyms Tampines ${stamp}`,
  query: `gyms in Tampines ${stamp}`,
  newLeads: synthetic,
  skippedLeads: [],
});
ok(!!kanban?.task_id, 'kanban handoff created', { task_id: kanban.task_id, assigned_to: kanban.assigned_to });
const task = db.prepare('SELECT id, owner_user_id, assigned_agent_id, created_by FROM kanban_tasks WHERE id = ?').get(kanban.task_id);
ok(task?.owner_user_id === ceo.id, 'kanban owner-scoped', task?.owner_user_id);
const crmId = findCrmHandoffAgentId(ceo.id);
ok(kanban.assigned_to === (crmId ? 'crm_agent' : 'ceo'), 'handoff target matches CRM lookup', {
  crmId,
  assigned_to: kanban.assigned_to,
});

const secondWrite = recordOpportunities(ceo.id, synthetic, { status: 'handed_to_crm', kanbanTaskId: kanban.task_id });
ok(secondWrite.written.length === 0 && secondWrite.skipped.length === 2, 'knowledge dedup skips existing', {
  written: secondWrite.written.length,
  skipped: secondWrite.skipped.length,
});

try {
  db.prepare('DELETE FROM kanban_tasks WHERE id = ? AND owner_user_id = ?').run(kanban.task_id, ceo.id);
} catch (_) {}

const toolsKey = String(process.env.TOOLS_API_KEY || '').trim();
if (toolsKey) {
  const mcpList = await fetch(`${mcpUrl}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${toolsKey}`,
      'Content-Type': 'application/json',
      'X-Ceo-User-Id': ceo.id,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    signal: AbortSignal.timeout(15000),
  });
  const listed = await mcpList.json().catch(() => ({}));
  const names = (listed?.result?.tools || []).map((t) => t.name);
  ok(mcpList.ok && names.includes('social_research_profile') && names.includes('social_research_x') && names.includes('business_discover'), 'MCP tools/list', names);
  if (braveConfigured) {
    const mcpCall = await fetch(`${mcpUrl}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${toolsKey}`,
        'Content-Type': 'application/json',
        'X-Ceo-User-Id': ceo.id,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'social_research_search', arguments: { query: 'Nike', site: 'x.com', count: 3 } },
      }),
      signal: AbortSignal.timeout(60000),
    });
    const called = await mcpCall.json().catch(() => ({}));
    ok(mcpCall.ok && called?.result && called.result.isError !== true, 'MCP tools/call social_research_search', {
      isError: called?.result?.isError,
      preview: String(called?.result?.content?.[0]?.text || '').slice(0, 180),
    });
  }
} else {
  console.log('SKIP MCP call (TOOLS_API_KEY unset in this process)');
}

const ex = await api('GET', '/api/agent-exchange?limit=200');
const listings = Array.isArray(ex.data?.agents) ? ex.data.agents : Array.isArray(ex.data) ? ex.data : [];
const listingNames = listings.map((x) => String(x.name || x.title || '')).join(' | ');
ok(
  listings.some((x) => /Social Researcher/i.test(x.name || '')) &&
    listings.some((x) => /Business Discovery/i.test(x.name || '')),
  'Agent Exchange lists both Flolah employees',
  { count: listings.length, names: listingNames.slice(0, 400) }
);

const stampUser = Date.now().toString(36);
const email = `sr.import.${stampUser}@example.com`;
const password = `SrTest!${stampUser}Aa`;
const legal = await fetch(`${BASE}/api/auth/legal-versions`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json()).catch(() => ({}));
const reg = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    accept_terms: true,
    terms_version: legal.terms_version,
    privacy_version: legal.privacy_version,
    email,
    password,
    name: `SR Import ${stampUser}`,
    db_mode: 'tenant',
    mfa_policy: 'off',
  }),
  signal: AbortSignal.timeout(120000),
});
const regData = await reg.json().catch(() => ({}));
const importToken = regData.session?.token || regData.token;
const importUserId = regData.user?.id || regData.session?.user?.id;
ok(reg.status === 201 && importToken && importUserId, 'register buyer CEO for Add to org', {
  status: reg.status,
  error: regData.error,
});

if (importToken && importUserId) {
  const buyerAgentsRes = await fetch(`${BASE}/api/agents`, {
    headers: { Authorization: `Bearer ${importToken}` },
  }).then((r) => r.json()).catch(() => []);
  const list = Array.isArray(buyerAgentsRes) ? buyerAgentsRes : buyerAgentsRes.agents || [];
  const buyerCoo = list.find((a) => a.is_coo) || list.find((a) => a.id === 'balserve');
  ok(
    !list.some((a) => a.id === 'socialresearcher' || a.id === 'businessdiscovery'),
    'buyer does not auto-hire research employees',
    list.map((a) => a.id).slice(0, 12)
  );

  const pubSr = pubs.find((p) => p.agent_id === 'socialresearcher');
  const add = await fetch(`${BASE}/api/agent-exchange/${encodeURIComponent(pubSr.id)}/add-to-org`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${importToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ department: 'Research', parent_id: buyerCoo?.id }),
    signal: AbortSignal.timeout(120000),
  });
  const added = await add.json().catch(() => ({}));
  ok(add.status === 201 || add.status === 200, 'Add Social Researcher to buyer org', {
    status: add.status,
    error: added.error,
    imported_id: added.agent?.id || added.imported_agent_id,
  });
  const importedId = added.agent?.id || added.imported_agent_id;
  if (importedId) {
    const grants = db
      .prepare('SELECT tool_name FROM agent_tool_grants WHERE agent_id = ?')
      .all(importedId)
      .map((r) => r.tool_name);
    ok(grants.includes('social_research_profile'), 'imported employee has social_research_profile', grants.slice(0, 20));
    ok(!grants.includes('business_discover'), 'imported Social Researcher still lacks business_discover');
  }

  if (!skipChat && importedId) {
    console.log('Chatting as buyer with imported Social Researcher (may take a minute)...');
    const chat = await fetch(`${BASE}/api/agents/${encodeURIComponent(importedId)}/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${importToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message:
          'Call social_research_search now with JSON {"query":"Nike","site":"x.com","count":3}. Reply with the first URL from the tool only. Do not invent URLs. If the tool fails, quote the error.',
        tz: 'Asia/Singapore',
      }),
      signal: AbortSignal.timeout(180000),
    });
    const chatBody = await chat.json().catch(() => ({}));
    const reply = String(chatBody.reply || chatBody.message || chatBody.content || chatBody.text || JSON.stringify(chatBody));
    ok(chat.ok, 'imported Social Researcher chat HTTP', { status: chat.status, error: chatBody.error });
    const usedTool = db
      .prepare(
        `SELECT id, status FROM content_tool_logs
         WHERE tool_name = 'social_research_search' AND owner_user_id = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(importUserId);
    ok(!!usedTool || /https?:\/\//i.test(reply) || /nike/i.test(reply), 'buyer chat produced research output or tool log', {
      log: usedTool,
      reply: reply.slice(0, 400),
    });
  }

  try {
    setUserEnabled(importUserId, false);
  } catch (_) {}
}

if (!skipChat) {
  console.log('Chatting as publisher with Social Researcher...');
  const chat = await api(
    'POST',
    '/api/agents/socialresearcher/chat',
    {
      message:
        'Use social_research_instagram with handle nike and days 30. Then summarise in 4 bullets: adapter used, whether Instaloader or search fallback, 2 public URLs. Do not invent URLs.',
      tz: 'Asia/Singapore',
    },
    {},
    180000
  );
  const reply = String(chat.data.reply || chat.data.message || chat.data.content || chat.data.text || JSON.stringify(chat.data));
  ok(chat.status === 200, 'publisher Social Researcher chat HTTP', { status: chat.status, error: chat.data.error });
  const log = db
    .prepare(
      `SELECT tool_name, status FROM content_tool_logs
       WHERE owner_user_id = ? AND tool_name LIKE 'social_research%'
       ORDER BY id DESC LIMIT 5`
    )
    .all(ceo.id);
  ok(
    log.some((r) => r.tool_name === 'social_research_instagram' || r.tool_name === 'social_research_profile' || r.tool_name === 'social_research_search') ||
      /instagram|fallback|nike/i.test(reply),
    'publisher chat used a social research tool',
    { log, reply: reply.slice(0, 500) }
  );

  console.log('Chatting as publisher with Business Discovery...');
  const chatBd = await api(
    'POST',
    '/api/agents/businessdiscovery/chat',
    {
      message: placesLive
        ? `Research dental clinics within 5 km of Tampines, Singapore.

Find up to 20 businesses using Google Business/Places and research their publicly available online presence.

For each business, identify:

Business name, location, Google rating and number of reviews
Website
Instagram and LinkedIn presence, if available
How recently they have posted on social media
Main services they promote
Any notable promotions or campaigns
Overall quality of their digital/social presence

Identify businesses that appear to have a strong business reputation but weak digital or social-media presence.

Rank the top 5 potential prospects and briefly explain why each is a good opportunity.

Use fresh information where possible. Reuse recently collected data if it is still current; otherwise refresh the source. Do not permanently track these businesses unless I ask you to.`
        : 'Find dental clinics within 3 km of Tampines with rating above 4.2 and identify potential leads. If Google Places is not configured, say so in one sentence naming GOOGLE_PLACES_API_KEY or GOOGLE_PLACES_BYOK. Do not invent clinics.',
      tz: 'Asia/Singapore',
    },
    {},
    300000
  );
  const replyBd = String(
    chatBd.data.reply || chatBd.data.message || chatBd.data.content || chatBd.data.text || JSON.stringify(chatBd.data)
  );
  ok(chatBd.status === 200, 'publisher Business Discovery chat HTTP', { status: chatBd.status, error: chatBd.data.error });
  if (!placesLive) {
    ok(
      /GOOGLE_PLACES/i.test(replyBd) || /not configured|Places/i.test(replyBd),
      'Business Discovery explains missing Places key',
      replyBd.slice(0, 500)
    );
  } else {
    ok(
      /\| *Business *\|/i.test(replyBd) || /opportunity|prospect|tampines|clinic/i.test(replyBd),
      'Business Discovery returned research brief',
      replyBd.slice(0, 800)
    );
    const bdLog = db
      .prepare(
        `SELECT tool_name, status FROM content_tool_logs
         WHERE owner_user_id = ? AND tool_name = 'business_discover'
         ORDER BY id DESC LIMIT 1`
      )
      .get(ceo.id);
    ok(!!bdLog, 'publisher chat invoked business_discover', bdLog);
  }
}

if (failed) {
  console.error(`VPS_SOCIAL_RESEARCH_FAIL count=${failed}`);
  process.exit(1);
}
console.log('VPS_SOCIAL_RESEARCH_OK');
