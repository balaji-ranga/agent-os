/**
 * Generic Voice channel sessions: mint owner-BYOK OpenAI Realtime ephemeral keys,
 * tool-invoke bridge (existing content tools), hangup wrap-up via OpenClaw chat.
 * Not a call-center ACD. PSTN is deferred to a telephony MCP.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db/schema.js';
import { getLlmConfig } from '../config/llm.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import { getToolMeta } from './content-tools-meta.js';
import { invokeContentToolHttp } from './content-tool-http-invoke.js';
import { assertAndConsumeToolRateLimit } from './tool-api-rate-limits.js';
import { assertCallerMayUseTool, getAgentToolGrants } from './openclaw-agent-tools.js';
import { ensureTenantOpenClawAgent, tenantOpenClawAgentId } from './openclaw-tenant.js';
import * as openclaw from '../gateway/openclaw.js';
import { registerOpenClawSessionOwner } from './tool-owner-scope.js';
import { ensureCeoAgentChannelsSchema } from './ceo-agent-channels.js';
import { tryResolveUserApiKey } from './user-api-keys.js';

const SPEECH_LIVE_DENY = new Set(['speech_stt', 'speech_tts', 'list_inbound_attachments']);
/** Public widget: lookups only — guests must not create CRM/Kanban/email/goals. */
const GUEST_VOICE_ALLOW = new Set([
  'master_data_rag',
  'master_data_list_documents',
  'master_data_list_tables',
  'master_data_list_rows',
  'crm_status',
  'crm_list_people',
  'crm_list_companies',
  'crm_list_opportunities',
  'crm_list_leads',
  'crm_list_notes',
  'crm_list_tasks',
]);
const GUEST_MINT_WINDOW_MS = 60_000;
const GUEST_MINT_PER_OWNER = 8;
const guestMintHits = new Map();

const SESSION_TTL_MS = 15 * 60 * 1000;
const TRANSCRIPT_MAX_CHARS = 24_000;
const VOICE_INVITE_TTL_SECONDS = 10 * 60;

function hashToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

function newId(prefix) {
  return `${prefix}_${randomBytes(10).toString('hex')}`;
}

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

export function ensureVoiceSessionsSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ceo_voice_sessions (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      channel_id TEXT,
      public_slug TEXT,
      token_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      transcript_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      ended_at TEXT,
      expires_at TEXT,
      is_guest INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ceo_voice_sessions_owner
      ON ceo_voice_sessions(owner_user_id, agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ceo_voice_sessions_token ON ceo_voice_sessions(token_hash);
  `);
  try {
    db.exec(`ALTER TABLE ceo_voice_sessions ADD COLUMN is_guest INTEGER DEFAULT 0`);
  } catch (_) {}
}

function isRealtimeCapableBase(baseUrl) {
  const u = String(baseUrl || '').toLowerCase();
  if (!u) return false;
  if (u.includes('openrouter') || u.includes('ollama') || u.includes('deepseek')) return false;
  if (u.includes('localhost') || u.includes('127.0.0.1')) return false;
  return u.includes('api.openai.com') || u.includes('openai.com');
}

function stripV1(baseUrl) {
  return String(baseUrl || '')
    .replace(/\/v1\/?$/, '')
    .replace(/\/$/, '');
}

function canonicalRealtimeModel(raw) {
  const s = String(raw || '').trim();
  if (/gpt-4o-realtime-preview/i.test(s)) return 'gpt-realtime';
  if (/realtime/i.test(s)) return s;
  return '';
}

function pickRealtimeModel(endpointModel) {
  return (
    canonicalRealtimeModel(endpointModel) ||
    canonicalRealtimeModel(process.env.OPENAI_REALTIME_MODEL) ||
    'gpt-realtime'
  );
}

function ownerVaultOpenAiCandidates(ownerUserId) {
  const names = ['Platform_BYOK', 'openAI_key', 'OPENAI_API_KEY'];
  for (const keyName of names) {
    const apiKey = String(tryResolveUserApiKey(ownerUserId, keyName) || '').trim();
    if (!apiKey) continue;
    return [
      {
        baseUrl: 'https://api.openai.com',
        apiKey,
        model: process.env.OPENAI_REALTIME_MODEL || '',
        source: 'owner_vault_openai',
      },
    ];
  }
  return [];
}

function toRealtimeOption(c) {
  return {
    ok: true,
    baseUrl: stripV1(c.baseUrl),
    apiKey: c.apiKey,
    model: pickRealtimeModel(c.model),
    source: c.source,
  };
}

/**
 * Platform OpenAI secondary / Realtime env first (deploy/.env), then owner vault, then Profile.
 * Chat can stay on DeepSeek primary; Realtime still needs api.openai.com.
 */
export function resolveRealtimeConfig(ownerUserId) {
  const cfg = getLlmConfig(ownerUserId);
  const envRtBase = String(process.env.OPENAI_REALTIME_BASE_URL || '').trim();
  const envRtKey = String(process.env.OPENAI_REALTIME_API_KEY || '').trim();
  const envSecBase = String(process.env.OPENAI_SECONDARY_BASE_URL || '').trim();
  const envSecKey = String(process.env.OPENAI_SECONDARY_API_KEY || '').trim();

  const candidates = [];
  if (envRtBase && envRtKey) {
    candidates.push({
      baseUrl: envRtBase,
      apiKey: envRtKey,
      model: process.env.OPENAI_REALTIME_MODEL,
      source: 'env_realtime',
    });
  }
  if (envSecBase && envSecKey) {
    candidates.push({
      baseUrl: envSecBase,
      apiKey: envSecKey,
      model: process.env.OPENAI_SECONDARY_MODEL || process.env.OPENAI_REALTIME_MODEL,
      source: 'env_secondary',
    });
  }
  candidates.push(...ownerVaultOpenAiCandidates(ownerUserId));
  if (cfg?.secondary?.baseUrl && cfg?.secondary?.apiKey) {
    candidates.push({
      baseUrl: cfg.secondary.baseUrl,
      apiKey: cfg.secondary.apiKey,
      model: cfg.secondary.model,
      source: cfg.using_byok ? 'owner_byok_secondary' : 'platform_secondary',
    });
  }
  if (cfg?.primary?.baseUrl && cfg?.primary?.apiKey) {
    candidates.push({
      baseUrl: cfg.primary.baseUrl,
      apiKey: cfg.primary.apiKey,
      model: cfg.primary.model,
      source: cfg.using_byok ? 'owner_byok_primary' : 'platform_primary',
    });
  }

  const options = [];
  const seen = new Set();
  for (const c of candidates) {
    if (!isRealtimeCapableBase(c.baseUrl) && c.source !== 'env_realtime') continue;
    if (c.source === 'env_realtime' && !isRealtimeCapableBase(c.baseUrl) && !/openai/i.test(c.baseUrl)) {
      continue;
    }
    const dedupe = `${stripV1(c.baseUrl)}:${String(c.apiKey || '').slice(-8)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    options.push(toRealtimeOption(c));
  }
  if (!options.length) {
    return {
      ok: false,
      error:
        'Realtime Voice needs an OpenAI Realtime-capable key. OpenRouter, Ollama, and DeepSeek cannot mint WebRTC sessions. Set an OpenAI key in API Keys (vault), or platform OPENAI_SECONDARY_* / OPENAI_REALTIME_* to api.openai.com.',
      status: 503,
    };
  }
  return { ok: true, options, ...options[0] };
}

function toolParametersFor(name) {
  const common = { type: 'object', additionalProperties: true, properties: {} };
  if (name === 'master_data_rag') {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Keywords from the caller question' },
        top_k: { type: 'number' },
      },
      required: ['query'],
    };
  }
  if (name.startsWith('crm_list_')) {
    return {
      type: 'object',
      additionalProperties: false,
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
    };
  }
  if (name === 'crm_create_person') {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        company_id: { type: 'string' },
      },
      required: ['name'],
    };
  }
  if (name === 'crm_create_lead' || name === 'crm_create_opportunity') {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        amount: { type: 'number' },
        company_id: { type: 'string' },
      },
      required: ['name'],
    };
  }
  if (name === 'kanban_create_task') {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['title'],
    };
  }
  if (name === 'notify_ceo') {
    return {
      type: 'object',
      additionalProperties: false,
      properties: { message: { type: 'string' }, title: { type: 'string' } },
      required: ['message'],
    };
  }
  if (name === 'agent_goal_create') {
    return {
      type: 'object',
      additionalProperties: false,
      properties: { prompt: { type: 'string' }, title: { type: 'string' } },
      required: ['prompt'],
    };
  }
  return common;
}

function realtimeToolsForAgent(agentId, { guest = false } = {}) {
  const grants = getAgentToolGrants(agentId) || [];
  let names = grants.filter((n) => n && !SPEECH_LIVE_DENY.has(n));
  if (guest) names = names.filter((n) => GUEST_VOICE_ALLOW.has(n));
  return names.map((name) => {
    const meta = getToolMeta(name);
    return {
      type: 'function',
      name,
      description: String(meta?.purpose || meta?.display_name || name).slice(0, 400),
      parameters: toolParametersFor(name),
    };
  });
}

function readSoulSnippet(workspacePath) {
  const p = join(workspacePath, 'SOUL.md');
  if (!existsSync(p)) return '';
  try {
    return readFileSync(p, 'utf8').slice(0, 4000);
  } catch {
    return '';
  }
}

function assertAgentForOwner(ownerUserId, agentId) {
  const row = getDb()
    .prepare(
      `SELECT a.* FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
       WHERE a.id = ?`
    )
    .get(String(ownerUserId || '').trim(), String(agentId || '').trim());
  if (!row) {
    throw Object.assign(new Error('AI employee not found or not entitled'), { status: 404 });
  }
  return row;
}

export function getVoiceChannelForAgent(ownerUserId, agentId) {
  ensureCeoAgentChannelsSchema();
  const row = getDb()
    .prepare(
      `SELECT * FROM ceo_agent_channels
       WHERE owner_user_id = ? AND agent_id = ? AND channel = 'voice'
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(String(ownerUserId || '').trim(), String(agentId || '').trim());
  return row || null;
}

export function getPublishedVoiceBySlug(slug) {
  ensureCeoAgentChannelsSchema();
  const s = String(slug || '').trim().toLowerCase();
  if (!s) return null;
  const row = getDb()
    .prepare(
      `SELECT * FROM ceo_agent_channels
       WHERE channel = 'voice'
         AND LOWER(status) = 'enabled'
         AND json_extract(config_json, '$.published') IN (1, '1', 'true', true)
         AND LOWER(COALESCE(json_extract(config_json, '$.public_slug'), '')) = ?`
    )
    .get(s);
  if (!row) return null;
  const config = parseJson(row.config_json, {});
  const agent = getDb().prepare('SELECT id, name, role FROM agents WHERE id = ?').get(row.agent_id);
  return { row, config, agent };
}

async function mintOpenAiRealtimeSession({ realtime, instructions, tools, voice, ownerUserId }) {
  const url = `${realtime.baseUrl}/v1/realtime/client_secrets`;
  const session = {
    type: 'realtime',
    model: realtime.model,
    instructions: String(instructions || '').slice(0, 8000),
    tools: tools || [],
    tool_choice: 'auto',
    audio: {
      output: { voice: voice || 'alloy' },
      input: { transcription: { model: 'whisper-1' } },
    },
  };
  const headers = {
    Authorization: `Bearer ${realtime.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (ownerUserId) {
    headers['OpenAI-Safety-Identifier'] = createHash('sha256')
      .update(`flolah:${ownerUserId}`)
      .digest('hex');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ session }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || `Realtime session mint failed (${res.status})`;
    console.warn('[voice] client_secret mint failed status=%s model=%s', res.status, realtime.model);
    throw Object.assign(new Error(typeof msg === 'string' ? msg : 'Realtime session mint failed'), {
      status: res.status >= 400 && res.status < 500 ? res.status : 502,
    });
  }
  const secret = data?.value || data?.client_secret?.value || data?.client_secret;
  if (!secret) {
    throw Object.assign(new Error('Realtime provider did not return an ephemeral client secret'), {
      status: 502,
    });
  }
  console.info('[voice] client_secret minted model=%s', realtime.model);
  return {
    client_secret: secret,
    expires_at: data?.expires_at || data?.client_secret?.expires_at || null,
    session: { id: data?.id || data?.session?.id || null, model: data?.session?.model || realtime.model },
  };
}

function assertGuestMintBudget(ownerUserId) {
  const key = String(ownerUserId || '').trim();
  const now = Date.now();
  const row = guestMintHits.get(key) || { n: 0, t: now };
  if (now - row.t > GUEST_MINT_WINDOW_MS) {
    row.n = 0;
    row.t = now;
  }
  row.n += 1;
  guestMintHits.set(key, row);
  if (row.n > GUEST_MINT_PER_OWNER) {
    throw Object.assign(new Error('Too many public voice sessions for this company'), { status: 429 });
  }
}

export async function createVoiceSession({ ownerUserId, agentId, channelId = null, publicSlug = null, guest = false }) {
  ensureVoiceSessionsSchema();
  const owner = String(ownerUserId || '').trim();
  if (guest) assertGuestMintBudget(owner);
  const agent = assertAgentForOwner(owner, agentId);
  const resolved = resolveRealtimeConfig(owner);
  if (!resolved.ok) {
    throw Object.assign(new Error(resolved.error), { status: resolved.status || 503 });
  }
  const options = Array.isArray(resolved.options) && resolved.options.length ? resolved.options : [resolved];

  const ensured = ensureTenantOpenClawAgent(agent, owner);
  const soul = readSoulSnippet(ensured.workspacePath);
  const instructions = [
    soul || `You are ${agent.name}, a live voice support employee.`,
    'Speak in short sentences. Use tools for FAQs (master_data_rag) and CRM lookups before creating records.',
    'Never invent policy. Never ask the guest for CEO credentials.',
  ].join('\n\n');
  const tools = realtimeToolsForAgent(agent.id, { guest: !!guest });
  let minted = null;
  let realtime = options[0];
  let lastMintErr = null;
  for (const opt of options) {
    try {
      minted = await mintOpenAiRealtimeSession({
        realtime: opt,
        instructions,
        tools,
        ownerUserId: owner,
      });
      realtime = opt;
      break;
    } catch (e) {
      lastMintErr = e;
      if (Number(e.status) === 401 || Number(e.status) === 403) {
        console.warn('[voice] mint skipped source=%s status=%s', opt.source, e.status);
        continue;
      }
      throw e;
    }
  }
  if (!minted) {
    throw lastMintErr || Object.assign(new Error('Realtime session mint failed'), { status: 502 });
  }

  const sessionId = newId('vs');
  const token = `vst_${randomBytes(24).toString('hex')}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  getDb()
    .prepare(
      `INSERT INTO ceo_voice_sessions
        (id, owner_user_id, agent_id, channel_id, public_slug, token_hash, status, transcript_json, expires_at, is_guest)
       VALUES (?, ?, ?, ?, ?, ?, 'open', '[]', ?, ?)`
    )
    .run(
      sessionId,
      owner,
      agent.id,
      channelId || null,
      publicSlug || null,
      hashToken(token),
      expiresAt,
      guest ? 1 : 0
    );

  console.info(
    '[voice] session minted id=%s owner=%s agent=%s guest=%s source=%s model=%s tools=%s',
    sessionId,
    owner,
    agent.id,
    guest ? 1 : 0,
    realtime.source,
    realtime.model,
    tools.length
  );

  return {
    session_id: sessionId,
    session_token: token,
    expires_at: expiresAt,
    agent: { id: agent.id, name: agent.name, role: agent.role },
    realtime: {
      model: realtime.model,
      webrtc_url: `${realtime.baseUrl}/v1/realtime/calls`,
      client_secret: minted.client_secret,
      expires_at: minted.expires_at,
    },
    instructions_preview: instructions.slice(0, 200),
  };
}

function loadOpenSession(sessionToken) {
  ensureVoiceSessionsSchema();
  const token = String(sessionToken || '').trim();
  if (!token) return null;
  const row = getDb()
    .prepare(`SELECT * FROM ceo_voice_sessions WHERE token_hash = ?`)
    .get(hashToken(token));
  if (!row) return null;
  if (row.status !== 'open') return null;
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
    getDb().prepare(`UPDATE ceo_voice_sessions SET status = 'expired' WHERE id = ?`).run(row.id);
    return null;
  }
  return row;
}

export async function invokeVoiceSessionTool({ sessionToken, toolName, args }) {
  const session = loadOpenSession(sessionToken);
  if (!session) {
    throw Object.assign(new Error('Voice session expired or invalid'), { status: 401 });
  }
  const name = String(toolName || '').trim();
  if (!name) throw Object.assign(new Error('tool_name required'), { status: 400 });
  if (name === 'speech_stt' || name === 'speech_tts') {
    throw Object.assign(new Error('speech_* is not used on the live Voice path'), { status: 400 });
  }
  const guest = Number(session.is_guest) === 1;
  const allowed = new Set(realtimeToolsForAgent(session.agent_id, { guest }).map((t) => t.name));
  if (!allowed.has(name)) {
    throw Object.assign(new Error('Tool not allowed on this Voice session'), { status: 403 });
  }

  const openclawId = tenantOpenClawAgentId(session.owner_user_id, session.agent_id);
  const grant = assertCallerMayUseTool(openclawId, name);
  if (!grant.ok) {
    throw Object.assign(new Error(grant.error || 'Tool not granted'), { status: 403 });
  }
  const limit = assertAndConsumeToolRateLimit({
    ownerUserId: session.owner_user_id,
    toolName: name,
    actor: 'voice',
  });
  if (!limit.ok) {
    throw Object.assign(new Error(limit.error || 'Tool rate limit'), {
      status: limit.status || 429,
      code: limit.code,
    });
  }

  const params = args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {};
  delete params.ceo_user_id;
  delete params.ceoUserId;
  delete params.owner_user_id;
  delete params.ownerUserId;

  const result = await invokeContentToolHttp(name, params, session.owner_user_id, {
    agentId: session.agent_id,
    openclawAgentId: openclawId,
    timeoutMs: 45000,
  });
  const clipped = JSON.parse(JSON.stringify(result ?? {}));
  let payload = clipped;
  try {
    const raw = JSON.stringify(clipped);
    if (raw.length > 6000) payload = { truncated: true, preview: raw.slice(0, 6000) };
  } catch {
    payload = { ok: true };
  }
  console.info(
    '[voice] tool ok session=%s owner=%s agent=%s tool=%s guest=%s',
    session.id,
    session.owner_user_id,
    session.agent_id,
    name,
    guest ? 1 : 0
  );
  return { ok: true, tool_name: name, result: payload };
}

function clipTranscript(turns) {
  const list = Array.isArray(turns) ? turns : [];
  const compact = list
    .map((t) => ({
      role: String(t.role || t.speaker || 'user').slice(0, 24),
      text: String(t.text || t.content || '').slice(0, 2000),
    }))
    .filter((t) => t.text.trim())
    .slice(-80);
  let json = JSON.stringify(compact);
  if (json.length > TRANSCRIPT_MAX_CHARS) {
    json = JSON.stringify(compact.slice(-20));
  }
  return { compact, json };
}

export async function endVoiceSession({ sessionToken, transcript = [] }) {
  const session = loadOpenSession(sessionToken);
  if (!session) {
    throw Object.assign(new Error('Voice session expired or invalid'), { status: 401 });
  }
  const { compact, json } = clipTranscript(transcript);
  getDb()
    .prepare(
      `UPDATE ceo_voice_sessions
       SET status = 'ended', ended_at = datetime('now'), transcript_json = ?
       WHERE id = ?`
    )
    .run(json, session.id);

  const guest = Number(session.is_guest) === 1;
  console.info(
    '[voice] session ended id=%s owner=%s agent=%s turns=%s guest=%s',
    session.id,
    session.owner_user_id,
    session.agent_id,
    compact.length,
    guest ? 1 : 0
  );

  let wrap = { queued: false };
  if (guest) {
    wrap = { queued: false, skipped: 'guest_no_tool_wrapup' };
  } else if (compact.length) {
    try {
      wrap = await runVoiceWrapUp({
        ownerUserId: session.owner_user_id,
        agentId: session.agent_id,
        transcript: compact,
        sessionId: session.id,
      });
    } catch (e) {
      console.warn('[voice] wrap-up failed session=%s: %s', session.id, e?.message || e);
      wrap = { queued: false, error: e?.message || String(e) };
    }
  }
  return { ok: true, session_id: session.id, wrap_up: wrap };
}

async function runVoiceWrapUp({ ownerUserId, agentId, transcript, sessionId }) {
  const agent = assertAgentForOwner(ownerUserId, agentId);
  const ensured = ensureTenantOpenClawAgent(agent, ownerUserId);
  const body = transcript.map((t) => `${t.role}: ${t.text}`).join('\n').slice(0, TRANSCRIPT_MAX_CHARS);
  const userContent = [
    '[Voice call ended — wrap-up]',
    `session_id: ${sessionId}`,
    'Transcript:',
    body,
    '',
    'Summarize facts only. RAG FAQs if needed. Dedup then CRM/Kanban. notify_ceo only for true escalation. Prefer agent_goal_create if follow-up is multi-step (quote agr-… and end the turn).',
  ].join('\n');

  const threadId = `voice-wrap-${sessionId}`;
  const sessionUser = openclaw.sessionUserFor(agentId, ownerUserId, threadId);
  const sessionKey = openclaw.sessionKeyFor(ensured.openclawAgentId, sessionUser);
  registerOpenClawSessionOwner(sessionKey, ownerUserId);
  const { content } = await openclaw.chatCompletions(
    ensured.openclawAgentId,
    [{ role: 'user', content: userContent }],
    sessionUser,
    false,
    { timeoutMs: 120000 }
  );
  console.info('[voice] wrap-up chat ok session=%s agent=%s chars=%s', sessionId, agentId, String(content || '').length);
  return { queued: true, reply_chars: String(content || '').length };
}

export function publicVoicePagePayload(slug) {
  const pub = getPublishedVoiceBySlug(slug);
  if (!pub) return null;
  return {
    slug: String(slug).toLowerCase(),
    agent: pub.agent ? { id: pub.agent.id, name: pub.agent.name, role: pub.agent.role } : null,
    channel_id: pub.row.id,
    status: pub.row.status,
  };
}

function voiceInviteSecret() {
  const secret = String(process.env.SESSION_SECRET || process.env.PROMOTION_TRACKING_SECRET || '').trim();
  if (!secret) throw Object.assign(new Error('Voice invitation signing is not configured'), { status: 503 });
  return secret;
}

/** Short-lived owner + agent + channel-bound URL for sharing a private call handoff. */
export function createVoiceInvite(ownerUserId, agentId, { ttlSeconds = VOICE_INVITE_TTL_SECONDS } = {}) {
  const owner = String(ownerUserId || '').trim();
  const agent = assertAgentForOwner(owner, agentId);
  const channel = getVoiceChannelForAgent(owner, agent.id);
  if (!channel || String(channel.status).toLowerCase() !== 'enabled') {
    throw Object.assign(new Error('This employee does not have an enabled Voice channel'), { status: 400 });
  }
  const config = parseJson(channel.config_json, {});
  if (!config.public_slug) throw Object.assign(new Error('Voice channel has no published route'), { status: 400 });
  const payload = Buffer.from(JSON.stringify({
    o: owner,
    a: agent.id,
    c: channel.id,
    s: String(config.public_slug).toLowerCase(),
    e: Math.floor(Date.now() / 1000) + Math.max(60, Math.min(Number(ttlSeconds) || VOICE_INVITE_TTL_SECONDS, 3600)),
    n: randomBytes(8).toString('hex'),
  })).toString('base64url');
  const signature = createHmac('sha256', voiceInviteSecret()).update(payload).digest('base64url');
  const token = `${payload}.${signature}`;
  const base = getPublicBaseUrl().replace(/\/api$/i, '');
  return { token, url: `${base}/p/voice-invite/${encodeURIComponent(token)}`, expires_at: new Date(JSON.parse(Buffer.from(payload, 'base64url')).e * 1000).toISOString(), agent: { id: agent.id, name: agent.name, role: agent.role } };
}

export function resolveVoiceInvite(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) throw Object.assign(new Error('Invalid voice invitation'), { status: 400 });
  const expected = createHmac('sha256', voiceInviteSecret()).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Object.assign(new Error('Invalid voice invitation'), { status: 400 });
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw Object.assign(new Error('Invalid voice invitation'), { status: 400 }); }
  if (!data.e || data.e < Math.floor(Date.now() / 1000)) throw Object.assign(new Error('Voice invitation expired'), { status: 410 });
  const pub = getPublishedVoiceBySlug(data.s);
  if (!pub || pub.row.id !== data.c || pub.row.owner_user_id !== data.o || pub.row.agent_id !== data.a) throw Object.assign(new Error('Voice invitation is no longer available'), { status: 404 });
  return { data, pub };
}

export function voiceInvitePagePayload(token) {
  const { data, pub } = resolveVoiceInvite(token);
  return { invite: true, expires_at: new Date(data.e * 1000).toISOString(), agent: pub.agent ? { id: pub.agent.id, name: pub.agent.name, role: pub.agent.role } : null, channel_id: pub.row.id, status: pub.row.status };
}

export function voicePublicUrl(slug) {
  const base = getPublicBaseUrl().replace(/\/api$/i, '');
  return `${base}/p/voice/${encodeURIComponent(slug)}`;
}
