/**
 * Merge per-CEO agent channel settings into openclaw.json (channels.slack / channels.whatsapp + bindings[]).
 * Also writes ~/.openclaw/agent-os-channel-routing.json so configure/apply can restore after rewrites.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getOpenClawDir, getOpenClawConfigPath } from '../config/openclaw-paths.js';
import { baseOcIdFromAgent, tenantOpenClawAgentId } from './openclaw-tenant.js';
import { readOpenClawConfigSafe, writeOpenClawConfigSafe } from './openclaw-config-safe.js';
import { applyWhatsAppFromPrefixToChannel } from '../../../scripts/lib/openclaw-whatsapp-from-prefix.js';

const CHANNEL_ROUTING_SIDECAR = 'agent-os-channel-routing.json';

function channelRoutingHasAccounts(channels) {
  if (!channels || typeof channels !== 'object') return false;
  for (const key of ['whatsapp', 'slack']) {
    const accounts = channels[key]?.accounts;
    if (accounts && typeof accounts === 'object' && Object.keys(accounts).length > 0) return true;
  }
  return false;
}

function persistChannelRoutingSidecar(config) {
  const dir = getOpenClawDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const channels = config?.channels && typeof config.channels === 'object' ? config.channels : null;
  const bindings = Array.isArray(config?.bindings) ? config.bindings : [];
  if (!channelRoutingHasAccounts(channels) && bindings.length === 0) return;
  const path = join(dir, CHANNEL_ROUTING_SIDECAR);
  writeFileSync(
    path,
    JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        channels: channels || {},
        bindings,
      },
      null,
      2
    ),
    'utf8'
  );
}

export function readOpenClawConfigFile() {
  return readOpenClawConfigSafe();
}

export function writeOpenClawConfigFile(config) {
  const merged = writeOpenClawConfigSafe(config);
  try {
    persistChannelRoutingSidecar(merged);
  } catch (e) {
    console.warn('[openclaw-channels] sidecar persist failed:', e?.message || e);
  }
}

/** Runtime OpenClaw agent id + channel account id for bindings. */
export function channelBindingIds(ownerUserId, agent) {
  const base = baseOcIdFromAgent(agent);
  const runtimeAgentId = tenantOpenClawAgentId(ownerUserId, base);
  return { baseOpenClawId: base, runtimeAgentId, accountId: runtimeAgentId };
}

function normalizeAllowFrom(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => String(v || '').trim()).filter(Boolean))];
}

function upsertBinding(config, { runtimeAgentId, channel, accountId }) {
  if (!Array.isArray(config.bindings)) config.bindings = [];
  const idx = config.bindings.findIndex(
    (b) =>
      String(b?.match?.channel || '').toLowerCase() === channel &&
      String(b?.match?.accountId || '') === accountId
  );
  const entry = {
    agentId: runtimeAgentId,
    match: { channel, accountId },
  };
  if (idx >= 0) config.bindings[idx] = { ...config.bindings[idx], ...entry };
  else config.bindings.push(entry);
}

function removeBinding(config, { channel, accountId }) {
  if (!Array.isArray(config.bindings)) return;
  config.bindings = config.bindings.filter(
    (b) =>
      !(
        String(b?.match?.channel || '').toLowerCase() === channel &&
        String(b?.match?.accountId || '') === accountId
      )
  );
}

function slackAccountPatch(config, accountId, { enabled, dmPolicy, allowFrom, botToken, appToken, teamId }) {
  if (!config.channels) config.channels = {};
  if (!config.channels.slack) config.channels.slack = { enabled: true, accounts: {} };
  if (!config.channels.slack.accounts || typeof config.channels.slack.accounts !== 'object') {
    config.channels.slack.accounts = {};
  }
  const prev = config.channels.slack.accounts[accountId] || {};
  const next = {
    ...prev,
    enabled: enabled !== false,
    dmPolicy: dmPolicy || prev.dmPolicy || 'pairing',
    allowFrom: normalizeAllowFrom(allowFrom ?? prev.allowFrom),
  };
  if (teamId) next.teamId = String(teamId).trim();
  if (botToken) next.botToken = botToken;
  if (appToken) next.appToken = appToken;
  config.channels.slack.accounts[accountId] = next;
  config.channels.slack.enabled = Object.values(config.channels.slack.accounts).some((a) => a?.enabled !== false);
}

function whatsappAccountPatch(config, accountId, { enabled, dmPolicy, allowFrom, groupPolicy, groupAllowFrom }) {
  if (!config.channels) config.channels = {};
  if (!config.channels.whatsapp) config.channels.whatsapp = { enabled: true, accounts: {} };
  if (!config.channels.whatsapp.accounts || typeof config.channels.whatsapp.accounts !== 'object') {
    config.channels.whatsapp.accounts = {};
  }
  const prev = config.channels.whatsapp.accounts[accountId] || {};
  const allow = normalizeAllowFrom(allowFrom ?? prev.allowFrom);
  // DMs use dmPolicy/allowFrom. Groups are a separate OpenClaw policy stack — without an
  // explicit groupPolicy, OpenClaw can still accept @g.us traffic and stage media before
  // the agent reply is gated. Default: disabled so only allowlisted/paired DMs are ingested.
  const gpRaw = String(groupPolicy || prev.groupPolicy || 'disabled').trim().toLowerCase();
  const gp = ['disabled', 'allowlist', 'open'].includes(gpRaw) ? gpRaw : 'disabled';
  const next = {
    ...prev,
    enabled: enabled !== false,
    dmPolicy: dmPolicy || prev.dmPolicy || 'pairing',
    allowFrom: allow,
    groupPolicy: gp,
  };
  if (gp === 'allowlist') {
    const gAllow = normalizeAllowFrom(groupAllowFrom ?? prev.groupAllowFrom ?? allow);
    next.groupAllowFrom = gAllow.length ? gAllow : allow;
  } else if (next.groupAllowFrom != null && gp === 'disabled') {
    // Keep prior list if present, but policy disabled means OpenClaw will not ingest groups.
  }
  config.channels.whatsapp.accounts[accountId] = next;
  // Channel-level default also blocks groups for any account that omits groupPolicy.
  if (config.channels.whatsapp.groupPolicy == null || config.channels.whatsapp.groupPolicy === 'open') {
    config.channels.whatsapp.groupPolicy = 'disabled';
  }
  applyWhatsAppFromPrefixToChannel(config.channels.whatsapp);
  config.channels.whatsapp.enabled = Object.values(config.channels.whatsapp.accounts).some(
    (a) => a?.enabled !== false
  );
}

/**
 * Apply or update a CEO agent channel in openclaw.json.
 * @returns {{ configPath: string, runtimeAgentId: string, accountId: string }}
 */
export function mergeAgentChannelIntoOpenClaw({
  ownerUserId,
  agent,
  channel,
  config = {},
  secrets = {},
  enabled = true,
}) {
  const ch = String(channel || '').toLowerCase();
  if (ch !== 'slack' && ch !== 'whatsapp') {
    throw Object.assign(new Error(`Unsupported channel "${channel}"`), { status: 400 });
  }

  const { runtimeAgentId, accountId } = channelBindingIds(ownerUserId, agent);
  const oc = readOpenClawConfigFile();

  if (ch === 'slack') {
    slackAccountPatch(oc, accountId, {
      enabled,
      dmPolicy: config.dmPolicy || config.mode || 'pairing',
      allowFrom: config.allowFrom,
      botToken: secrets.botToken,
      appToken: secrets.appToken,
      teamId: config.teamId,
    });
  } else {
    whatsappAccountPatch(oc, accountId, {
      enabled,
      dmPolicy: config.dmPolicy || config.mode || 'pairing',
      allowFrom: config.allowFrom,
      groupPolicy: config.groupPolicy,
      groupAllowFrom: config.groupAllowFrom,
    });
  }

  if (enabled) upsertBinding(oc, { runtimeAgentId, channel: ch, accountId });
  else removeBinding(oc, { channel: ch, accountId });

  writeOpenClawConfigFile(oc);
  console.info(
    '[openclaw-channels] merged %s account=%s agent=%s enabled=%s',
    ch,
    accountId,
    runtimeAgentId,
    enabled
  );
  return { configPath: getOpenClawConfigPath(), runtimeAgentId, accountId };
}

/** Disable channel account + remove binding (keeps account stub for re-enable). */
export function disableAgentChannelInOpenClaw({ ownerUserId, agent, channel }) {
  return mergeAgentChannelIntoOpenClaw({
    ownerUserId,
    agent,
    channel,
    config: {},
    secrets: {},
    enabled: false,
  });
}

/** Remove account entry and binding entirely. */
export function removeAgentChannelFromOpenClaw({ ownerUserId, agent, channel }) {
  const ch = String(channel || '').toLowerCase();
  const { accountId } = channelBindingIds(ownerUserId, agent);
  const oc = readOpenClawConfigFile();
  removeBinding(oc, { channel: ch, accountId });
  if (ch === 'slack' && oc.channels?.slack?.accounts) delete oc.channels.slack.accounts[accountId];
  if (ch === 'whatsapp' && oc.channels?.whatsapp?.accounts) delete oc.channels.whatsapp.accounts[accountId];
  writeOpenClawConfigFile(oc);
  console.info('[openclaw-channels] removed %s account=%s', ch, accountId);
  return { configPath: getOpenClawConfigPath(), accountId };
}
