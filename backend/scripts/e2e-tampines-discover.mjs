/**
 * Tampines Business Discovery E2E: Places discover + publisher chat brief.
 * Never prints API keys. Usage (backend container):
 *   node scripts/e2e-tampines-discover.mjs
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { getGooglePlacesConfig } from '../src/config/tools.js';

initDb();
const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const db = getDb();
const ceo = db.prepare(`SELECT id, email FROM platform_users WHERE id = 'ceo-bala'`).get();
if (!ceo) throw new Error('ceo-bala not found');
const { token } = createSession(ceo.id, { userAgent: 'e2e-tampines-discover' });

const TAMPINES = `Research dental clinics within 5 km of Tampines, Singapore.

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

const cfg = getGooglePlacesConfig(ceo.id);
console.log(
  JSON.stringify(
    {
      owner: ceo.id,
      places: {
        has_key: Boolean(cfg.apiKey),
        source: cfg.source,
        using_byok: cfg.using_byok,
        error_code: cfg.error_code,
      },
    },
    null,
    2
  )
);
if (!cfg.apiKey) {
  console.error('E2E_TAMPINES_FAIL no Places key (platform or vault)');
  process.exit(1);
}

async function api(path, body, headers = {}, timeoutMs = 180000) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const disc = await api(
  '/api/tools/business-discover',
  { intent: TAMPINES, persist: false, handoff: false },
  { 'x-openclaw-agent-id': 'businessdiscovery' },
  180000
);
const businesses = Array.isArray(disc.data.businesses) ? disc.data.businesses : [];
console.log(
  JSON.stringify(
    {
      discover: {
        status: disc.status,
        ok: disc.data.ok,
        error: disc.data.error,
        code: disc.data.code,
        count: disc.data.count,
        persist: disc.data.persist,
        handoff: disc.data.handoff,
        kanban: Boolean(disc.data.kanban),
        using_byok: disc.data.using_byok,
        key_source: disc.data.key_source,
        sample: businesses.slice(0, 3).map((b) => ({
          name: b.name,
          rating: b.rating,
          reviews: b.user_rating_count,
          website: Boolean(b.website),
          instagram: Boolean(b.instagram),
          linkedin: Boolean(b.linkedin),
        })),
      },
    },
    null,
    2
  )
);
if (disc.status !== 200 || !disc.data.ok || businesses.length < 1) {
  console.error('E2E_TAMPINES_FAIL discover');
  process.exit(1);
}

const nearby = await api(
  '/api/tools/google-places-nearby',
  { locality: 'Tampines, Singapore', business_type: 'dentist', radius_meters: 5000, max_results: 10 },
  { 'x-openclaw-agent-id': 'businessdiscovery' },
  60000
);
console.log(
  JSON.stringify(
    {
      nearby: {
        status: nearby.status,
        ok: nearby.data.ok,
        error: nearby.data.error,
        count: nearby.data.count || nearby.data.places?.length,
      },
    },
    null,
    2
  )
);

const fresh = await api('/api/agents/businessdiscovery/sessions/new', {}, {}, 60000);
console.log(JSON.stringify({ new_session: { status: fresh.status, ok: fresh.data.ok, error: fresh.data.error } }));

console.log('Chatting Business Discovery (may take several minutes)...');
const chat = await api(
  '/api/agents/businessdiscovery/chat',
  { message: TAMPINES, tz: 'Asia/Singapore' },
  {},
  360000
);
const reply = String(
  chat.data.reply || chat.data.message || chat.data.content || chat.data.text || JSON.stringify(chat.data)
);
const logs = db
  .prepare(
    `SELECT tool_name, status FROM content_tool_logs
     WHERE owner_user_id = ? AND created_at > datetime('now', '-20 minutes')
       AND tool_name IN ('business_discover','google_places_nearby','google_places_geocode','agent_goal_create','master_data_rag','social_research_search','social_research_instagram')
     ORDER BY id DESC LIMIT 12`
  )
  .all(ceo.id);

const hasTable = /\| *Business *\|/i.test(reply) && /Google/i.test(reply) && /Opportunity/i.test(reply);
const hasNext = /CRM|in more depth/i.test(reply);
const noInventBlocker = !/ClinicGeek/i.test(reply);
console.log(
  JSON.stringify(
    {
      chat: {
        status: chat.status,
        error: chat.data.error,
        reply_len: reply.length,
        has_table: hasTable,
        has_next_action: hasNext,
        no_clinicgeek: noInventBlocker,
        tools: logs,
        preview: reply.slice(0, 2500),
      },
    },
    null,
    2
  )
);
if (chat.status !== 200 || !hasTable || !hasNext) {
  console.error('E2E_TAMPINES_FAIL chat brief');
  process.exit(1);
}
console.log('E2E_TAMPINES_OK');
