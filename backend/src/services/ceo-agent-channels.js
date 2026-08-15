/**
 * Per-CEO Slack / WhatsApp channel enablement for agents.
 */
import { randomBytes } from 'crypto';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db/schema.js';
import { getOpenClawDir } from '../config/openclaw-paths.js';
import {
  createUserApiKey,
  getUserApiKeyRow,
  tryResolveUserApiKey,
  updateUserApiKey,
  ensureUserApiKeysSchema,
} from './user-api-keys.js';
import { ensureTenantOpenClawAgent } from './openclaw-tenant.js';
import {
  mergeAgentChannelIntoOpenClaw,
  disableAgentChannelInOpenClaw,
  removeAgentChannelFromOpenClaw,
  channelBindingIds,
} from './openclaw-channels-config.js';
import { openclawAdminRpc } from '../gateway/openclaw-admin-rpc.js';

const CHANNELS = new Set(['slack', 'whatsapp']);
const STATUSES = new Set(['draft', 'pairing', 'enabled', 'disabled']);

/** In-memory WhatsApp QR cache keyed by channel id (data URLs are large; not persisted). */
const whatsappQrCache = new Map();

export function ensureCeoAgentChannelsSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ceo_agent_channels (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      config_json TEXT DEFAULT '{}',
      vault_refs_json TEXT DEFAULT '{}',
      last_test_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(owner_user_id, agent_id, channel)
    );
    CREATE INDEX IF NOT EXISTS idx_ceo_agent_channels_owner
      ON ceo_agent_channels(owner_user_id, agent_id, updated_at DESC);
  `);
}

function newChannelId() {
  return `ch_${randomBytes(10).toString('hex')}`;
}

function parseJson(raw, fallback = {}) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function vaultKeyNames(agentId) {
  const id = String(agentId || '').trim();
  return {
    slackBotToken: `slack-bot-token-${id}`,
    slackAppToken: `slack-app-token-${id}`,
  };
}

function upsertVaultKey(ownerUserId, keyName, secret) {
  ensureUserApiKeysSchema();
  const value = String(secret || '').trim();
  if (!value) return null;
  const existing = getUserApiKeyRow(ownerUserId, keyName);
  if (existing) return updateUserApiKey(ownerUserId, existing.id, { apiKey: value });
  return createUserApiKey(ownerUserId, { keyName, apiKey: value });
}

function assertAgentGrantedToCeo(ownerUserId, agentId) {
  const row = getDb()
    .prepare(
      `SELECT a.* FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
       WHERE a.id = ?`
    )
    .get(String(ownerUserId || '').trim(), String(agentId || '').trim());
  if (!row) {
    throw Object.assign(new Error('Agent not found or not granted to this CEO'), { status: 404 });
  }
  return row;
}

function getRow(ownerUserId, channelId) {
  ensureCeoAgentChannelsSchema();
  return (
    getDb()
      .prepare(`SELECT * FROM ceo_agent_channels WHERE id = ? AND owner_user_id = ?`)
      .get(String(channelId || '').trim(), String(ownerUserId || '').trim()) || null
  );
}

function hydrateChannel(row) {
  if (!row) return null;
  const config = parseJson(row.config_json, {});
  const vaultRefs = parseJson(row.vault_refs_json, {});
  const keys = vaultKeyNames(row.agent_id);
  const hasSlackBot = !!tryResolveUserApiKey(row.owner_user_id, vaultRefs.slackBotToken || keys.slackBotToken);
  const hasSlackApp = !!tryResolveUserApiKey(row.owner_user_id, vaultRefs.slackAppToken || keys.slackAppToken);
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    agent_id: row.agent_id,
    channel: row.channel,
    status: row.status,
    config,
    vault_refs: vaultRefs,
    credentials_present: {
      slack_bot_token: hasSlackBot,
      slack_app_token: hasSlackApp,
    },
    last_test_at: row.last_test_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listAgentChannels(ownerUserId, { agentId } = {}) {
  ensureCeoAgentChannelsSchema();
  const owner = String(ownerUserId || '').trim();
  let sql = `SELECT * FROM ceo_agent_channels WHERE owner_user_id = ?`;
  const params = [owner];
  if (agentId) {
    sql += ` AND agent_id = ?`;
    params.push(String(agentId).trim());
  }
  sql += ` ORDER BY updated_at DESC`;
  return getDb()
    .prepare(sql)
    .all(...params)
    .map(hydrateChannel);
}

export function getAgentChannelForOwner(ownerUserId, channelId) {
  return hydrateChannel(getRow(ownerUserId, channelId));
}

/** True when this CEO agent's WhatsApp account has linked auth files on disk. */
export function isWhatsAppSessionPaired(ownerUserId, agentId) {
  const agent = assertAgentGrantedToCeo(ownerUserId, agentId);
  const { accountId } = channelBindingIds(ownerUserId, agent);
  return !!whatsappSessionDir(accountId);
}

function normalizeChannelInput(body = {}) {
  const channel = String(body.channel || '').trim().toLowerCase();
  if (!CHANNELS.has(channel)) {
    throw Object.assign(new Error('channel must be slack or whatsapp'), { status: 400 });
  }
  return channel;
}

function normalizeConfigInput(config = {}) {
  const out = { ...config };
  if (out.mode && !out.dmPolicy) out.dmPolicy = out.mode;
  if (out.dmPolicy) {
    const p = String(out.dmPolicy).trim().toLowerCase();
    if (!['pairing', 'allowlist', 'open', 'disabled'].includes(p)) {
      throw Object.assign(new Error('dmPolicy must be pairing, allowlist, open, or disabled'), { status: 400 });
    }
    out.dmPolicy = p;
  }
  if (out.allowFrom != null) {
    out.allowFrom = Array.isArray(out.allowFrom)
      ? out.allowFrom.map((v) => String(v).trim()).filter(Boolean)
      : String(out.allowFrom)
          .split(/[\n,;]+/)
          .map((v) => v.trim())
          .filter(Boolean);
  }
  if (out.groupPolicy != null) {
    const gp = String(out.groupPolicy).trim().toLowerCase();
    if (!['disabled', 'allowlist', 'open'].includes(gp)) {
      throw Object.assign(new Error('groupPolicy must be disabled, allowlist, or open'), { status: 400 });
    }
    out.groupPolicy = gp;
  }
  if (out.groupAllowFrom != null) {
    out.groupAllowFrom = Array.isArray(out.groupAllowFrom)
      ? out.groupAllowFrom.map((v) => String(v).trim()).filter(Boolean)
      : String(out.groupAllowFrom)
          .split(/[\n,;]+/)
          .map((v) => v.trim())
          .filter(Boolean);
  }
  if (out.teamId != null) out.teamId = String(out.teamId).trim();
  return out;
}

function storeCredentials(ownerUserId, agentId, channel, credentials = {}) {
  const keys = vaultKeyNames(agentId);
  const refs = {};
  if (channel === 'slack') {
    const bot = credentials.slackBotToken ?? credentials.botToken ?? credentials.bot_token;
    const app = credentials.slackAppToken ?? credentials.appToken ?? credentials.app_token;
    if (bot) {
      upsertVaultKey(ownerUserId, keys.slackBotToken, bot);
      refs.slackBotToken = keys.slackBotToken;
    }
    if (app) {
      upsertVaultKey(ownerUserId, keys.slackAppToken, app);
      refs.slackAppToken = keys.slackAppToken;
    }
  }
  return refs;
}

export function createAgentChannel(ownerUserId, body = {}) {
  ensureCeoAgentChannelsSchema();
  const owner = String(ownerUserId || '').trim();
  const agentId = String(body.agentId ?? body.agent_id ?? '').trim();
  if (!agentId) throw Object.assign(new Error('agentId is required'), { status: 400 });
  assertAgentGrantedToCeo(owner, agentId);
  const channel = normalizeChannelInput(body);
  const config = normalizeConfigInput(body.config || {});

  const existing = getDb()
    .prepare(`SELECT id FROM ceo_agent_channels WHERE owner_user_id = ? AND agent_id = ? AND channel = ?`)
    .get(owner, agentId, channel);
  if (existing) {
    throw Object.assign(new Error(`A ${channel} channel already exists for this agent`), { status: 409 });
  }

  const vaultRefs = {
    ...vaultKeyNames(agentId),
    ...storeCredentials(owner, agentId, channel, body.credentials || body),
  };

  const id = newChannelId();
  getDb()
    .prepare(
      `INSERT INTO ceo_agent_channels
        (id, owner_user_id, agent_id, channel, status, config_json, vault_refs_json, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, datetime('now'))`
    )
    .run(id, owner, agentId, channel, JSON.stringify(config), JSON.stringify(vaultRefs));

  console.info('[agent-channels] created id=%s owner=%s agent=%s channel=%s', id, owner, agentId, channel);
  return hydrateChannel(getRow(owner, id));
}

export function updateAgentChannel(ownerUserId, channelId, patch = {}) {
  const row = getRow(ownerUserId, channelId);
  if (!row) throw Object.assign(new Error('Channel not found'), { status: 404 });

  const config = normalizeConfigInput({
    ...parseJson(row.config_json, {}),
    ...(patch.config || {}),
  });

  let vaultRefs = parseJson(row.vault_refs_json, {});
  if (patch.credentials) {
    vaultRefs = { ...vaultRefs, ...storeCredentials(row.owner_user_id, row.agent_id, row.channel, patch.credentials) };
  }

  let status = row.status;
  if (patch.status != null) {
    const s = String(patch.status).trim().toLowerCase();
    if (!STATUSES.has(s)) throw Object.assign(new Error('Invalid status'), { status: 400 });
    status = s;
  }

  getDb()
    .prepare(
      `UPDATE ceo_agent_channels SET
         config_json = ?, vault_refs_json = ?, status = ?, updated_at = datetime('now')
       WHERE id = ? AND owner_user_id = ?`
    )
    .run(JSON.stringify(config), JSON.stringify(vaultRefs), status, row.id, row.owner_user_id);

  console.info('[agent-channels] updated id=%s status=%s', row.id, status);
  return hydrateChannel(getRow(row.owner_user_id, row.id));
}

export function deleteAgentChannel(ownerUserId, channelId) {
  const row = getRow(ownerUserId, channelId);
  if (!row) throw Object.assign(new Error('Channel not found'), { status: 404 });
  const agent = assertAgentGrantedToCeo(row.owner_user_id, row.agent_id);
  try {
    removeAgentChannelFromOpenClaw({ ownerUserId: row.owner_user_id, agent, channel: row.channel });
  } catch (e) {
    console.warn('[agent-channels] openclaw remove on delete failed id=%s:', row.id, e?.message || e);
  }
  getDb().prepare(`DELETE FROM ceo_agent_channels WHERE id = ? AND owner_user_id = ?`).run(row.id, row.owner_user_id);
  console.info('[agent-channels] deleted id=%s', row.id);
  return { deleted: true, id: row.id };
}

function resolveSlackSecrets(ownerUserId, row) {
  const refs = parseJson(row.vault_refs_json, {});
  const keys = vaultKeyNames(row.agent_id);
  const botRef = refs.slackBotToken || keys.slackBotToken;
  const appRef = refs.slackAppToken || keys.slackAppToken;
  const bot = tryResolveUserApiKey(ownerUserId, botRef);
  const app = tryResolveUserApiKey(ownerUserId, appRef);
  return {
    botToken: bot?.value || '',
    appToken: app?.value || '',
    missing: [!bot?.value && 'slack bot token', !app?.value && 'slack app token'].filter(Boolean),
  };
}

/**
 * Re-merge all non-disabled CEO agent channels into openclaw.json.
 * Deploy/OpenClaw rewrites can drop channels/bindings while Baileys creds remain on disk.
 * @returns {{ synced: number, accounts: string[] }}
 */
export function syncEnabledAgentChannelsToOpenClaw() {
  ensureCeoAgentChannelsSchema();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM ceo_agent_channels
       WHERE LOWER(status) IN ('enabled', 'pairing')
       ORDER BY updated_at ASC`
    )
    .all();
  const accounts = [];
  for (const row of rows) {
    try {
      const agent = assertAgentGrantedToCeo(row.owner_user_id, row.agent_id);
      ensureTenantOpenClawAgent(agent, row.owner_user_id);
      const config = parseJson(row.config_json, {});
      let secrets = {};
      if (row.channel === 'slack') {
        const resolved = resolveSlackSecrets(row.owner_user_id, row);
        if (resolved.missing.length) {
          console.warn(
            '[agent-channels] sync skip slack id=%s missing=%s',
            row.id,
            resolved.missing.join(',')
          );
          continue;
        }
        secrets = { botToken: resolved.botToken, appToken: resolved.appToken };
      }
      const merged = mergeAgentChannelIntoOpenClaw({
        ownerUserId: row.owner_user_id,
        agent,
        channel: row.channel,
        config,
        secrets,
        enabled: true,
      });
      accounts.push(`${row.channel}:${merged.accountId}`);
      if (row.channel === 'whatsapp' && row.status === 'pairing') {
        const sessionDir = whatsappSessionDir(merged.accountId);
        if (whatsappSessionHasAuthFiles(sessionDir)) {
          db.prepare(
            `UPDATE ceo_agent_channels SET status = 'enabled', updated_at = datetime('now')
             WHERE id = ? AND owner_user_id = ?`
          ).run(row.id, row.owner_user_id);
        }
      }
    } catch (e) {
      console.warn('[agent-channels] sync failed id=%s: %s', row.id, e?.message || e);
    }
  }
  if (accounts.length) {
    console.info('[agent-channels] synced %s channel(s) into openclaw.json: %s', accounts.length, accounts.join(', '));
  }
  return { synced: accounts.length, accounts };
}

export function applyAgentChannel(ownerUserId, channelId) {
  const row = getRow(ownerUserId, channelId);
  if (!row) throw Object.assign(new Error('Channel not found'), { status: 404 });
  const agent = assertAgentGrantedToCeo(row.owner_user_id, row.agent_id);
  const config = parseJson(row.config_json, {});
  const channel = row.channel;

  ensureTenantOpenClawAgent(agent, row.owner_user_id);

  let secrets = {};
  if (channel === 'slack') {
    const resolved = resolveSlackSecrets(row.owner_user_id, row);
    if (resolved.missing.length) {
      throw Object.assign(
        new Error(`Missing credentials: ${resolved.missing.join(', ')}. Save bot and app tokens first.`),
        { status: 400 }
      );
    }
    secrets = { botToken: resolved.botToken, appToken: resolved.appToken };
  }

  const merged = mergeAgentChannelIntoOpenClaw({
    ownerUserId: row.owner_user_id,
    agent,
    channel,
    config,
    secrets,
    enabled: true,
  });

  // WhatsApp: keep enabled when Baileys auth already exists; only new applies start in pairing.
  let nextStatus = 'enabled';
  if (channel === 'whatsapp') {
    const sessionDir = whatsappSessionDir(merged.accountId);
    nextStatus = whatsappSessionHasAuthFiles(sessionDir) ? 'enabled' : 'pairing';
  }
  getDb()
    .prepare(
      `UPDATE ceo_agent_channels SET status = ?, updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`
    )
    .run(nextStatus, row.id, row.owner_user_id);

  console.info('[agent-channels] applied id=%s status=%s runtimeAgent=%s', row.id, nextStatus, merged.runtimeAgentId);

  return {
    channel: hydrateChannel(getRow(row.owner_user_id, row.id)),
    apply: {
      config_path: merged.configPath,
      runtime_agent_id: merged.runtimeAgentId,
      account_id: merged.accountId,
      gateway_note:
        'Channel config is live after Enable. If messages do not route, restart the messaging gateway container.',
    },
  };
}

export function disableAgentChannel(ownerUserId, channelId) {
  const row = getRow(ownerUserId, channelId);
  if (!row) throw Object.assign(new Error('Channel not found'), { status: 404 });
  const agent = assertAgentGrantedToCeo(row.owner_user_id, row.agent_id);
  disableAgentChannelInOpenClaw({ ownerUserId: row.owner_user_id, agent, channel: row.channel });
  getDb()
    .prepare(
      `UPDATE ceo_agent_channels SET status = 'disabled', updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`
    )
    .run(row.id, row.owner_user_id);
  console.info('[agent-channels] disabled id=%s', row.id);
  return hydrateChannel(getRow(row.owner_user_id, row.id));
}

async function testSlack(botToken) {
  const res = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: '',
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    return { ok: false, error: data.error || 'Slack auth.test failed', team: null, user: null };
  }
  return { ok: true, team: data.team || null, user: data.user || null, team_id: data.team_id || null };
}

function whatsappSessionHasAuthFiles(dir) {
  if (!existsSync(dir)) return false;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  if (!entries.length) return false;
  // Baileys / WhatsApp Web auth — require real credential files, not empty account folders.
  const authMarkers = new Set([
    'creds.json',
    'credentials.json',
    'creds.json.bak',
    'app-state-sync-key',
    'app-state-sync-version',
    'session-',
  ]);
  return entries.some((name) => {
    const n = String(name || '');
    if (authMarkers.has(n)) return true;
    if (n.startsWith('session-') || n.startsWith('app-state-sync-')) return true;
    if (n.endsWith('.json') && /cred|session|auth|device/i.test(n)) return true;
    return false;
  });
}

/** True only when this account has linked WhatsApp auth files (not empty parent dirs). */
function whatsappSessionDir(accountId) {
  const base = join(getOpenClawDir(), 'credentials', 'whatsapp');
  const candidates = [join(base, accountId)];
  // Only fall back to default when that is the configured account.
  if (!accountId || accountId === 'default') candidates.push(join(base, 'default'));
  for (const dir of candidates) {
    if (whatsappSessionHasAuthFiles(dir)) return dir;
  }
  return null;
}

export async function testAgentChannel(ownerUserId, channelId) {
  const row = getRow(ownerUserId, channelId);
  if (!row) throw Object.assign(new Error('Channel not found'), { status: 404 });

  let result;
  if (row.channel === 'slack') {
    const { botToken, missing } = resolveSlackSecrets(row.owner_user_id, row);
    if (missing.length) {
      throw Object.assign(new Error(`Missing credentials: ${missing.join(', ')}`), { status: 400 });
    }
    result = await testSlack(botToken);
  } else if (row.channel === 'whatsapp') {
    const agent = assertAgentGrantedToCeo(row.owner_user_id, row.agent_id);
    const { accountId } = channelBindingIds(row.owner_user_id, agent);
    const sessionDir = whatsappSessionDir(accountId);
    result = {
      ok: !!sessionDir,
      paired: !!sessionDir,
      session_dir: sessionDir ? sessionDir.replace(/\\/g, '/') : null,
      hint: sessionDir
        ? 'WhatsApp is linked — you can message this agent from the paired phone.'
        : 'Not linked yet. Open the QR step and scan with WhatsApp on your phone.',
    };
  } else {
    throw Object.assign(new Error('Unsupported channel'), { status: 400 });
  }

  const now = new Date().toISOString();
  getDb()
    .prepare(`UPDATE ceo_agent_channels SET last_test_at = ?, updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`)
    .run(now, row.id, row.owner_user_id);

  if (row.channel === 'whatsapp' && result.ok && row.status === 'pairing') {
    getDb()
      .prepare(`UPDATE ceo_agent_channels SET status = 'enabled' WHERE id = ? AND owner_user_id = ?`)
      .run(row.id, row.owner_user_id);
  }

  console.info('[agent-channels] test id=%s channel=%s ok=%s', row.id, row.channel, result.ok);
  return { ok: result.ok, result, channel: hydrateChannel(getRow(row.owner_user_id, row.id)) };
}

function markWhatsAppEnabledIfPaired(ownerUserId, channelId, sessionDir) {
  if (!sessionDir) return;
  const row = getRow(ownerUserId, channelId);
  if (!row || row.channel !== 'whatsapp') return;
  if (row.status === 'pairing' || row.status === 'draft') {
    getDb()
      .prepare(
        `UPDATE ceo_agent_channels SET status = 'enabled', updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`
      )
      .run(channelId, ownerUserId);
    console.info('[agent-channels] whatsapp paired → enabled id=%s', channelId);
  }
}

function buildWhatsAppQrResponse(ownerUserId, channelId, extras = {}) {
  const row = getRow(ownerUserId, channelId);
  if (!row) throw Object.assign(new Error('Channel not found'), { status: 404 });
  if (row.channel !== 'whatsapp') {
    throw Object.assign(new Error('QR is only available for WhatsApp channels'), { status: 400 });
  }
  const agent = assertAgentGrantedToCeo(row.owner_user_id, row.agent_id);
  const { accountId, runtimeAgentId } = channelBindingIds(row.owner_user_id, agent);
  const sessionDir = whatsappSessionDir(accountId);
  markWhatsAppEnabledIfPaired(ownerUserId, channelId, sessionDir);
  const cached = whatsappQrCache.get(channelId) || {};
  const qrDataUrl = extras.qr_data_url ?? cached.qr_data_url ?? null;
  const connected = extras.connected === true || !!sessionDir;
  return {
    status: connected || sessionDir ? 'paired' : qrDataUrl ? 'awaiting_scan' : 'awaiting_qr',
    account_id: accountId,
    runtime_agent_id: runtimeAgentId,
    session_dir: sessionDir ? sessionDir.replace(/\\/g, '/') : null,
    qr_available: !!qrDataUrl && !sessionDir,
    qr_data_url: sessionDir ? null : qrDataUrl,
    connected: connected || !!sessionDir,
    message:
      extras.message ||
      (sessionDir
        ? 'Phone linked. Send a WhatsApp message to this number to chat with the agent.'
        : qrDataUrl
          ? 'Scan this QR with WhatsApp on your phone (Linked devices).'
          : 'Click “Show QR code” to generate a pairing code.'),
    channel: hydrateChannel(getRow(ownerUserId, channelId)),
  };
}

export function getWhatsAppQrStatus(ownerUserId, channelId) {
  return buildWhatsAppQrResponse(ownerUserId, channelId);
}

/**
 * Start WhatsApp Web QR login via gateway admin RPC.
 * @param {string} ownerUserId
 * @param {string} channelId
 * @param {{ force?: boolean }} [opts]
 */
export async function startWhatsAppQrLogin(ownerUserId, channelId, opts = {}) {
  const row = getRow(ownerUserId, channelId);
  if (!row) throw Object.assign(new Error('Channel not found'), { status: 404 });
  if (row.channel !== 'whatsapp') {
    throw Object.assign(new Error('QR login is only for WhatsApp'), { status: 400 });
  }
  const agent = assertAgentGrantedToCeo(row.owner_user_id, row.agent_id);
  const { accountId } = channelBindingIds(row.owner_user_id, agent);

  const force = opts.force === true;
  console.info('[agent-channels] whatsapp QR start id=%s account=%s force=%s', channelId, accountId, force);

  let payload;
  try {
    const rpc = await openclawAdminRpc(
      'web.login.start',
      {
        force,
        timeoutMs: 30000,
        accountId,
      },
      { timeoutMs: 60000 }
    );
    payload = rpc?.payload || {};
  } catch (e) {
    const msg = e?.message || String(e);
    const hint =
      /provider is not available|not available/i.test(msg)
        ? ' WhatsApp plugin may be missing on the gateway — ops: install clawhub:@openclaw/whatsapp and enable admin-http-rpc.'
        : '';
    throw Object.assign(new Error(`Could not start WhatsApp QR: ${msg}.${hint}`), {
      status: e.status || 502,
    });
  }

  const qrDataUrl = typeof payload.qrDataUrl === 'string' ? payload.qrDataUrl : null;
  const connected = payload.connected === true;
  if (qrDataUrl) {
    whatsappQrCache.set(channelId, { qr_data_url: qrDataUrl, updated_at: Date.now() });
  }
  if (connected) whatsappQrCache.delete(channelId);

  return buildWhatsAppQrResponse(ownerUserId, channelId, {
    qr_data_url: qrDataUrl,
    connected,
    message:
      typeof payload.message === 'string' && payload.message
        ? payload.message
        : connected
          ? 'Already linked.'
          : qrDataUrl
            ? 'Scan this QR with WhatsApp on your phone (Linked devices).'
            : 'No QR returned — try again, or use Refresh QR.',
  });
}

/**
 * Poll WhatsApp login wait (refreshes QR when rotated).
 */
export async function waitWhatsAppQrLogin(ownerUserId, channelId, opts = {}) {
  const row = getRow(ownerUserId, channelId);
  if (!row) throw Object.assign(new Error('Channel not found'), { status: 404 });
  if (row.channel !== 'whatsapp') {
    throw Object.assign(new Error('QR wait is only for WhatsApp'), { status: 400 });
  }
  const agent = assertAgentGrantedToCeo(row.owner_user_id, row.agent_id);
  const { accountId } = channelBindingIds(row.owner_user_id, agent);
  const cached = whatsappQrCache.get(channelId) || {};
  const currentQr = opts.currentQrDataUrl || cached.qr_data_url || undefined;

  let payload;
  try {
    const rpc = await openclawAdminRpc(
      'web.login.wait',
      {
        timeoutMs: typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 45000,
        accountId,
        ...(currentQr ? { currentQrDataUrl: currentQr } : {}),
      },
      { timeoutMs: 90000 }
    );
    payload = rpc?.payload || {};
  } catch (e) {
    // Timeout / wait abort is normal while user has not scanned yet — return cached QR.
    console.info('[agent-channels] whatsapp QR wait id=%s: %s', channelId, e?.message || e);
    return buildWhatsAppQrResponse(ownerUserId, channelId, {
      message: 'Still waiting for scan…',
    });
  }

  const qrDataUrl = typeof payload.qrDataUrl === 'string' ? payload.qrDataUrl : null;
  const connected = payload.connected === true;
  if (qrDataUrl) {
    whatsappQrCache.set(channelId, { qr_data_url: qrDataUrl, updated_at: Date.now() });
  }
  if (connected) whatsappQrCache.delete(channelId);

  return buildWhatsAppQrResponse(ownerUserId, channelId, {
    qr_data_url: qrDataUrl,
    connected,
    message:
      typeof payload.message === 'string' && payload.message
        ? payload.message
        : connected
          ? 'Phone linked successfully.'
          : undefined,
  });
}
