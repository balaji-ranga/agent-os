import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { getDb } from '../db/schema.js';
import { announceOnAgentChannel } from './agent-channel-announce.js';
import { assertSafePublicUrl } from './mcp-universe.js';

const STATES = new Set(['draft', 'pending_approval', 'scheduled', 'active', 'paused', 'completed', 'cancelled']);
const FREQUENCIES = new Set(['once', 'daily', 'capped']);
const DELIVERIES = new Set(['popup', 'whatsapp', 'both']);
const EVENT_TYPES = new Set(['eligible', 'delivered', 'impression', 'viewable', 'expanded_read', 'dismissed', 'suppressed_by_user', 'cta_clicked', 'whatsapp_queued', 'whatsapp_sent', 'whatsapp_failed', 'whatsapp_media_queued', 'whatsapp_media_sent', 'whatsapp_media_failed']);
const BLOCK_TYPES = new Set(['heading', 'paragraph', 'image', 'video', 'audio', 'cta', 'disclosure']);
const MAX_PROMOTION_MEDIA_BYTES = 1_200_000;
const PROMOTION_MEDIA_TIMEOUT_MS = 20_000;
const PROMOTION_MEDIA_REDIRECTS = 3;
const ALLOWED_PROMOTION_MEDIA = new Map([
  ['image/png', { kind: 'image', ext: 'png' }],
  ['image/jpeg', { kind: 'image', ext: 'jpg' }],
  ['image/gif', { kind: 'image', ext: 'gif' }],
  ['image/webp', { kind: 'image', ext: 'webp' }],
  ['video/mp4', { kind: 'video', ext: 'mp4' }],
  ['video/webm', { kind: 'video', ext: 'webm' }],
  ['video/quicktime', { kind: 'video', ext: 'mov' }],
]);

export function ensurePromotionTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS promotion_campaigns (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, advertiser TEXT NOT NULL,
      disclosure TEXT NOT NULL, content_json TEXT NOT NULL DEFAULT '[]',
      delivery TEXT NOT NULL DEFAULT 'popup', audience TEXT NOT NULL DEFAULT 'all',
      frequency TEXT NOT NULL DEFAULT 'once', frequency_cap INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0, starts_at TEXT, ends_at TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC', state TEXT NOT NULL DEFAULT 'draft',
      allow_suppress INTEGER NOT NULL DEFAULT 1, approved_by TEXT,
      approved_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS promotion_campaign_targets (
      campaign_id TEXT NOT NULL, user_id TEXT NOT NULL,
      PRIMARY KEY(campaign_id, user_id),
      FOREIGN KEY(campaign_id) REFERENCES promotion_campaigns(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS promotion_events (
      id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, user_id TEXT NOT NULL,
      event_type TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'popup',
      idempotency_key TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, UNIQUE(user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_promotion_eligible ON promotion_campaigns(state, starts_at, ends_at, priority DESC);
    CREATE INDEX IF NOT EXISTS idx_promotion_events_campaign ON promotion_events(campaign_id, event_type, created_at DESC);
    CREATE TABLE IF NOT EXISTS promotion_user_preferences (
      user_id TEXT PRIMARY KEY, whatsapp_consent INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

function safeUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('/api/media/')) return value;
  const url = new URL(value);
  if (url.protocol !== 'https:') throw Object.assign(new Error('Only HTTPS URLs are allowed'), { status: 400 });
  return url.toString();
}

function cleanText(value, max = 4000) {
  const text = String(value || '').replace(/[<>]/g, '').trim();
  return text.slice(0, max);
}

export function validateCampaign(input = {}) {
  const state = STATES.has(input.state) ? input.state : 'draft';
  const delivery = DELIVERIES.has(input.delivery) ? input.delivery : 'popup';
  const frequency = FREQUENCIES.has(input.frequency) ? input.frequency : 'once';
  const audience = input.audience === 'selected' ? 'selected' : 'all';
  const blocks = Array.isArray(input.blocks) ? input.blocks.slice(0, 30).map((block) => {
    const type = String(block?.type || 'paragraph');
    if (!BLOCK_TYPES.has(type)) throw Object.assign(new Error(`Unsupported content block: ${type}`), { status: 400 });
    return {
      type,
      text: cleanText(block?.text, 8000),
      label: cleanText(block?.label, 120),
      alt: cleanText(block?.alt, 300),
      url: block?.url ? safeUrl(block.url) : '',
    };
  }) : [];
  const name = cleanText(input.name, 160);
  const advertiser = cleanText(input.advertiser, 160);
  const disclosure = cleanText(input.disclosure, 500);
  if (!name || !advertiser || !disclosure) throw Object.assign(new Error('Name, advertiser, and disclosure are required'), { status: 400 });
  if (!blocks.length) throw Object.assign(new Error('At least one content block is required'), { status: 400 });
  return { name, advertiser, disclosure, blocks, delivery, audience, frequency, frequency_cap: Math.max(1, Math.min(Number(input.frequency_cap) || 1, 30)), priority: Math.max(-100, Math.min(Number(input.priority) || 0, 100)), starts_at: input.starts_at || null, ends_at: input.ends_at || null, timezone: cleanText(input.timezone || 'UTC', 80), state, allow_suppress: input.allow_suppress === false ? 0 : 1, target_user_ids: [...new Set((input.target_user_ids || []).map(String).filter(Boolean))] };
}

export function saveCampaign(input, actorId, existingId = null) {
  const db = ensurePromotionTables();
  const c = validateCampaign(input);
  const id = existingId || randomUUID();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM promotion_campaigns WHERE id = ?').get(id);
  const approved = ['scheduled', 'active'].includes(c.state);
  db.prepare(`INSERT INTO promotion_campaigns (id,name,advertiser,disclosure,content_json,delivery,audience,frequency,frequency_cap,priority,starts_at,ends_at,timezone,state,allow_suppress,approved_by,approved_at,created_by,created_at,updated_at)
    VALUES (@id,@name,@advertiser,@disclosure,@content_json,@delivery,@audience,@frequency,@frequency_cap,@priority,@starts_at,@ends_at,@timezone,@state,@allow_suppress,@approved_by,@approved_at,@created_by,@created_at,@updated_at)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,advertiser=excluded.advertiser,disclosure=excluded.disclosure,content_json=excluded.content_json,delivery=excluded.delivery,audience=excluded.audience,frequency=excluded.frequency,frequency_cap=excluded.frequency_cap,priority=excluded.priority,starts_at=excluded.starts_at,ends_at=excluded.ends_at,timezone=excluded.timezone,state=excluded.state,allow_suppress=excluded.allow_suppress,approved_by=excluded.approved_by,approved_at=excluded.approved_at,updated_at=excluded.updated_at`).run({ ...c, id, content_json: JSON.stringify(c.blocks), approved_by: approved ? actorId : null, approved_at: approved ? now : null, created_by: existing?.created_by || actorId, created_at: existing?.created_at || now, updated_at: now });
  db.prepare('DELETE FROM promotion_campaign_targets WHERE campaign_id = ?').run(id);
  const add = db.prepare('INSERT INTO promotion_campaign_targets(campaign_id,user_id) VALUES (?,?)');
  if (c.audience === 'selected') for (const uid of c.target_user_ids) add.run(id, uid);
  return getCampaign(id);
}

function hydrate(row) {
  if (!row) return null;
  return { ...row, blocks: JSON.parse(row.content_json || '[]'), allow_suppress: !!row.allow_suppress };
}

function withTargets(db,row){const c=hydrate(row);if(c)c.target_user_ids=db.prepare('SELECT user_id FROM promotion_campaign_targets WHERE campaign_id=?').all(c.id).map(r=>r.user_id);return c;}
export function getCampaign(id) { const db=ensurePromotionTables();return withTargets(db,db.prepare('SELECT * FROM promotion_campaigns WHERE id = ?').get(id)); }
export function listCampaigns({ limit = 20, offset = 0 } = {}) { const db=ensurePromotionTables();const lim=Math.min(100,Math.max(1,Number(limit)||20));const off=Math.max(0,Number(offset)||0);const total=db.prepare('SELECT COUNT(*) AS n FROM promotion_campaigns').get()?.n||0;const campaigns=db.prepare('SELECT * FROM promotion_campaigns ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').all(lim,off).map(r=>withTargets(db,r));return {campaigns,total,limit:lim,offset:off,has_more:off+campaigns.length<total}; }

export function recordPromotionEvent({ campaignId, userId, eventType, channel = 'popup', idempotencyKey, metadata = {} }) {
  if (!EVENT_TYPES.has(eventType)) throw Object.assign(new Error('Unsupported promotion event'), { status: 400 });
  const db = ensurePromotionTables();
  const campaign = db.prepare('SELECT id FROM promotion_campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  const key = cleanText(idempotencyKey, 180);
  if (!key) throw Object.assign(new Error('idempotency_key is required'), { status: 400 });
  const info = db.prepare(`INSERT OR IGNORE INTO promotion_events(id,campaign_id,user_id,event_type,channel,idempotency_key,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), campaignId, userId, eventType, channel === 'whatsapp' ? 'whatsapp' : 'popup', key, JSON.stringify(metadata || {}).slice(0, 4000), new Date().toISOString());
  return { ok: true, duplicate: info.changes === 0 };
}

export function eligibleCampaign(userId) {
  const db = ensurePromotionTables();
  const now = new Date().toISOString();
  const rows = db.prepare(`SELECT c.* FROM promotion_campaigns c WHERE c.state IN ('active','scheduled') AND c.delivery IN ('popup','both') AND (c.starts_at IS NULL OR c.starts_at <= ?) AND (c.ends_at IS NULL OR c.ends_at > ?) AND (c.audience='all' OR EXISTS (SELECT 1 FROM promotion_campaign_targets t WHERE t.campaign_id=c.id AND t.user_id=?)) ORDER BY c.priority DESC,c.created_at ASC`).all(now, now, userId);
  for (const row of rows) {
    const suppressed = db.prepare(`SELECT 1 FROM promotion_events WHERE campaign_id=? AND user_id=? AND event_type='suppressed_by_user' LIMIT 1`).get(row.id, userId);
    if (suppressed) continue;
    const since = row.frequency === 'daily' ? new Date(Date.now() - 86400000).toISOString() : '1970-01-01T00:00:00.000Z';
    const count = db.prepare(`SELECT COUNT(*) n FROM promotion_events WHERE campaign_id=? AND user_id=? AND event_type='delivered' AND created_at>=?`).get(row.id, userId, since)?.n || 0;
    if (row.frequency === 'once' && count > 0) continue;
    if (row.frequency === 'capped' && count >= row.frequency_cap) continue;
    const key = `delivery:${row.id}:${row.frequency === 'daily' ? now.slice(0,10) : count + 1}`;
    recordPromotionEvent({ campaignId: row.id, userId, eventType: 'eligible', idempotencyKey: `eligible:${key}` });
    recordPromotionEvent({ campaignId: row.id, userId, eventType: 'delivered', idempotencyKey: key });
    return hydrate(row);
  }
  return null;
}

export function campaignAnalytics(id, { page = 1, pageSize = 25 } = {}) {
  const db = ensurePromotionTables();
  const campaign = getCampaign(id);
  if (!campaign) return null;
  const safePageSize = Math.max(10, Math.min(Number(pageSize) || 25, 100));
  const eventCount = Number(db.prepare(`SELECT COUNT(*) total FROM promotion_events WHERE campaign_id=?`).get(id)?.total || 0);
  const safePage = Math.max(1, Math.min(Number(page) || 1, Math.max(1, Math.ceil(eventCount / safePageSize))));
  const totals = db.prepare(`SELECT event_type,channel,COUNT(*) total,COUNT(DISTINCT user_id) users FROM promotion_events WHERE campaign_id=? GROUP BY event_type,channel`).all(id);
  const history = db.prepare(`
    SELECT e.id,e.user_id,u.name AS user_name,u.email AS user_email,e.event_type,e.channel,e.metadata_json,e.created_at
    FROM promotion_events e
    LEFT JOIN platform_users u ON u.id=e.user_id
    WHERE e.campaign_id=?
    ORDER BY e.created_at DESC
    LIMIT ? OFFSET ?
  `).all(id, safePageSize, (safePage - 1) * safePageSize).map((row) => ({
    ...row,
    metadata: (() => { try { return JSON.parse(row.metadata_json || '{}'); } catch { return {}; } })(),
  }));
  return { campaign, totals, history, pagination: { page: safePage, page_size: safePageSize, total: eventCount, pages: Math.max(1, Math.ceil(eventCount / safePageSize)) } };
}

export function getPromotionPreferences(userId) {
  const row = ensurePromotionTables().prepare('SELECT whatsapp_consent,updated_at FROM promotion_user_preferences WHERE user_id=?').get(userId);
  return { whatsapp_consent: !!row?.whatsapp_consent, updated_at: row?.updated_at || null };
}
export function setPromotionPreferences(userId, input = {}) {
  const value = input.whatsapp_consent === true ? 1 : 0, now = new Date().toISOString();
  ensurePromotionTables().prepare(`INSERT INTO promotion_user_preferences(user_id,whatsapp_consent,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET whatsapp_consent=excluded.whatsapp_consent,updated_at=excluded.updated_at`).run(userId,value,now);
  return { whatsapp_consent: !!value, updated_at: now };
}

function trackingSecret(){return String(process.env.PROMOTION_TRACKING_SECRET||process.env.SESSION_SECRET||'').trim();}
export function signedPromotionClick(campaignId,userId,url){const secret=trackingSecret();if(!secret)throw new Error('Promotion tracking secret is not configured');const payload=Buffer.from(JSON.stringify({c:campaignId,u:userId,d:url,e:Math.floor(Date.now()/1000)+30*86400})).toString('base64url');const sig=createHmac('sha256',secret).update(payload).digest('base64url');const base=String(process.env.AGENT_OS_PUBLIC_URL||'https://flolah.cloud').replace(/\/$/,'');return `${base}/api/public/promotions/click?t=${encodeURIComponent(`${payload}.${sig}`)}`;}
export function resolvePromotionClick(token){const[p,s]=String(token||'').split('.'),secret=trackingSecret();if(!p||!s||!secret)throw Object.assign(new Error('Invalid tracking link'),{status:400});const expected=createHmac('sha256',secret).update(p).digest(),got=Buffer.from(s,'base64url');if(got.length!==expected.length||!timingSafeEqual(got,expected))throw Object.assign(new Error('Invalid tracking link'),{status:400});let data;try{data=JSON.parse(Buffer.from(p,'base64url'));}catch{throw Object.assign(new Error('Invalid tracking link'),{status:400});}if(data.e<Math.floor(Date.now()/1000))throw Object.assign(new Error('Tracking link expired'),{status:410});safeUrl(data.d);return data;}

function campaignMessage(c,userId) {
  const blocks = JSON.parse(c.content_json || '[]');
  const copy = blocks.filter((b) => ['heading','paragraph','disclosure'].includes(b.type)).map((b) => b.text).filter(Boolean).join('\n\n');
  const cta = blocks.find((b) => b.type === 'cta' && b.url);
  const link=cta?signedPromotionClick(c.id,userId,cta.url):'';
  return `[Flolah announcement${c.advertiser ? ` · ${c.advertiser}` : ''}]\n\n${copy}\n\n${c.disclosure}${cta ? `\n\n${cta.label || 'Learn more'}: ${link}` : ''}`.slice(0, 12000);
}

export function assertPromotionMediaSignature(buffer, mimeType) {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const mime = String(mimeType || '').toLowerCase();
  const ascii = (start, end) => b.subarray(start, end).toString('ascii');
  const valid =
    (mime === 'image/png' && b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) ||
    (mime === 'image/jpeg' && b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
    (mime === 'image/gif' && b.length >= 6 && /^GIF8[79]a$/.test(ascii(0, 6))) ||
    (mime === 'image/webp' && b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') ||
    ((mime === 'video/mp4' || mime === 'video/quicktime') && b.length >= 12 && ascii(4, 8) === 'ftyp') ||
    (mime === 'video/webm' && b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3);
  if (!valid) throw new Error(`Media content does not match ${mime || 'declared type'}`);
  return true;
}

async function readLimitedBody(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error(`Media exceeds ${maxBytes} bytes`);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Media exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export async function fetchPromotionMedia(block, { fetchImpl = fetch } = {}) {
  const expectedKind = String(block?.type || '').toLowerCase();
  if (!['image', 'video'].includes(expectedKind)) throw new Error('Only image and video blocks can be sent to WhatsApp');
  let current = await assertSafePublicUrl(block?.url);
  let response;
  for (let redirects = 0; redirects <= PROMOTION_MEDIA_REDIRECTS; redirects += 1) {
    response = await fetchImpl(current, {
      redirect: 'manual',
      headers: { Accept: expectedKind === 'image' ? 'image/*' : 'video/*' },
      signal: AbortSignal.timeout(PROMOTION_MEDIA_TIMEOUT_MS),
    });
    if (![301,302,303,307,308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location || redirects === PROMOTION_MEDIA_REDIRECTS) throw new Error('Too many or invalid media redirects');
    current = await assertSafePublicUrl(new URL(location, current).toString());
  }
  if (!response?.ok) throw new Error(`Media download failed with HTTP ${response?.status || 0}`);
  const mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const allowed = ALLOWED_PROMOTION_MEDIA.get(mimeType);
  if (!allowed || allowed.kind !== expectedKind) throw new Error(`Unsupported ${expectedKind} content type: ${mimeType || 'missing'}`);
  const buffer = await readLimitedBody(response, MAX_PROMOTION_MEDIA_BYTES);
  if (!buffer.length) throw new Error('Media response was empty');
  assertPromotionMediaSignature(buffer, mimeType);
  return {
    kind: allowed.kind,
    bytes: buffer.length,
    filename: `promotion-${String(block.mediaKey || randomUUID()).replace(/[^a-z0-9_-]/gi, '').slice(0, 80)}.${allowed.ext}`,
    mimeType,
    bufferBase64: buffer.toString('base64'),
    mediaKey: String(block.mediaKey || ''),
  };
}

export async function dispatchDueWhatsappPromotions() {
  const db = ensurePromotionTables();
  const now = new Date().toISOString();
  const campaigns = db.prepare(`SELECT * FROM promotion_campaigns WHERE state IN ('active','scheduled') AND delivery IN ('whatsapp','both') AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?)`).all(now, now);
  const results = [];
  for (const c of campaigns) {
    const users = c.audience === 'selected'
      ? db.prepare(`SELECT u.id FROM platform_users u JOIN promotion_campaign_targets t ON t.user_id=u.id WHERE t.campaign_id=? AND u.enabled=1 AND u.role='ceo'`).all(c.id)
      : db.prepare(`SELECT id FROM platform_users WHERE enabled=1 AND role='ceo'`).all();
    const blocks = JSON.parse(c.content_json || '[]');
    const mediaBlocks = blocks
      .map((block, index) => ({ ...block, index, mediaKey: `b${index}` }))
      .filter((block) => ['image', 'video'].includes(block.type) && block.url);
    for (const u of users) {
      if (!getPromotionPreferences(u.id).whatsapp_consent) {
        results.push({ campaign_id: c.id, user_id: u.id, skipped: 'no_consent' });
        continue;
      }
      const sent = db.prepare(`SELECT 1 FROM promotion_events WHERE campaign_id=? AND user_id=? AND event_type='whatsapp_sent' LIMIT 1`).get(c.id,u.id);
      if (sent && c.frequency === 'once') continue;
      const day = now.slice(0,10);
      const daySent = db.prepare(`SELECT COUNT(*) n FROM promotion_events WHERE campaign_id=? AND user_id=? AND event_type='whatsapp_sent' AND created_at>=?`).get(c.id,u.id,`${day}T00:00:00.000Z`)?.n || 0;
      if (c.frequency === 'daily' && daySent) continue;
      const total = db.prepare(`SELECT COUNT(*) n FROM promotion_events WHERE campaign_id=? AND user_id=? AND event_type='whatsapp_sent'`).get(c.id,u.id)?.n || 0;
      if (c.frequency === 'capped' && total >= c.frequency_cap) continue;
      const agent = db.prepare(`SELECT a.id FROM agents a JOIN user_agents ua ON ua.agent_id=a.id WHERE ua.user_id=? AND ua.enabled=1 ORDER BY a.is_coo DESC LIMIT 1`).get(u.id);
      const key = `wa:${c.id}:${u.id}:${c.frequency === 'daily' ? day : total + 1}`;
      recordPromotionEvent({ campaignId:c.id,userId:u.id,eventType:'whatsapp_queued',channel:'whatsapp',idempotencyKey:`${key}:queued` });
      const mediaFiles = [];
      let mediaPrepareFailed = false;
      for (const block of mediaBlocks) {
        const mediaEventKey = `${key}:media:${block.mediaKey}`;
        recordPromotionEvent({ campaignId:c.id,userId:u.id,eventType:'whatsapp_media_queued',channel:'whatsapp',idempotencyKey:`${mediaEventKey}:queued`,metadata:{ kind:block.type } });
        try {
          mediaFiles.push(await fetchPromotionMedia(block));
        } catch (error) {
          mediaPrepareFailed = true;
          recordPromotionEvent({ campaignId:c.id,userId:u.id,eventType:'whatsapp_media_failed',channel:'whatsapp',idempotencyKey:`${mediaEventKey}:failed:prepare`,metadata:{ kind:block.type,reason:String(error.message).slice(0,300) } });
        }
      }
      try {
        const out = await announceOnAgentChannel({ ownerUserId:u.id,agentId:agent?.id,channel:'whatsapp',text:campaignMessage(c,u.id),idempotencyKey:key,mediaFiles });
        for (const item of out?.media_results || []) {
          recordPromotionEvent({ campaignId:c.id,userId:u.id,eventType:item.ok?'whatsapp_media_sent':'whatsapp_media_failed',channel:'whatsapp',idempotencyKey:`${key}:media:${item.mediaKey}:${item.ok?'sent':'failed:send'}`,metadata:{ kind:item.kind,reason:item.error||'' } });
        }
        const mediaSendFailed = (out?.media_results || []).some((item) => !item.ok) || (mediaBlocks.length !== (out?.media_results || []).length);
        const ok = !!out?.ok && !out?.skipped && !mediaPrepareFailed && !mediaSendFailed;
        recordPromotionEvent({ campaignId:c.id,userId:u.id,eventType:ok?'whatsapp_sent':'whatsapp_failed',channel:'whatsapp',idempotencyKey:`${key}:${ok?'sent':`failed:${Date.now()}`}`,metadata:{ reason:out?.reason||out?.error||(ok?'':'media_delivery_failed') } });
        results.push({ campaign_id:c.id,user_id:u.id,ok,reason:out?.reason,media_sent:out?.media_sent||0,media_expected:mediaBlocks.length });
      } catch (error) {
        recordPromotionEvent({ campaignId:c.id,userId:u.id,eventType:'whatsapp_failed',channel:'whatsapp',idempotencyKey:`${key}:failed:${Date.now()}`,metadata:{reason:String(error.message).slice(0,300)} });
        results.push({ campaign_id:c.id,user_id:u.id,ok:false,error:error.message });
      }
    }
  }
  return { ok:true,count:results.length,results };
}
