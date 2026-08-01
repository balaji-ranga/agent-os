/**
 * Persist Slack/WhatsApp channel routing outside the parts of openclaw.json that
 * configure/apply scripts rewrite. Prevents deploy drift (creds on disk, no accounts/bindings).
 *
 * Sidecar: $OPENCLAW_DIR/agent-os-channel-routing.json
 * Shape: { version, updatedAt, channels, bindings }
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveOpenClawDir, resolveOpenClawConfigPath } from './openclaw-paths.js';

export const CHANNEL_ROUTING_SIDECAR = 'agent-os-channel-routing.json';
const VERSION = 1;

export function channelRoutingSidecarPath(openclawDir = resolveOpenClawDir()) {
  return join(openclawDir, CHANNEL_ROUTING_SIDECAR);
}

export function extractChannelRouting(config) {
  if (!config || typeof config !== 'object') return { channels: null, bindings: [] };
  const channels =
    config.channels && typeof config.channels === 'object' ? structuredCloneSafe(config.channels) : null;
  const bindings = Array.isArray(config.bindings) ? structuredCloneSafe(config.bindings) : [];
  return { channels, bindings };
}

function structuredCloneSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

/** True when WhatsApp/Slack has at least one account or bindings exist. */
export function hasChannelRouting(routing) {
  if (!routing || typeof routing !== 'object') return false;
  if (Array.isArray(routing.bindings) && routing.bindings.length > 0) return true;
  const ch = routing.channels;
  if (!ch || typeof ch !== 'object') return false;
  for (const key of ['whatsapp', 'slack']) {
    const accounts = ch[key]?.accounts;
    if (accounts && typeof accounts === 'object' && Object.keys(accounts).length > 0) return true;
  }
  return false;
}

export function loadChannelRoutingSidecar(openclawDir = resolveOpenClawDir()) {
  const path = channelRoutingSidecarPath(openclawDir);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return {
      channels: raw.channels && typeof raw.channels === 'object' ? raw.channels : null,
      bindings: Array.isArray(raw.bindings) ? raw.bindings : [],
    };
  } catch (e) {
    console.warn('[openclaw-channel-routing] sidecar read failed:', e?.message || e);
    return null;
  }
}

export function persistChannelRoutingSidecar(routing, openclawDir = resolveOpenClawDir()) {
  if (!hasChannelRouting(routing)) return false;
  if (!existsSync(openclawDir)) mkdirSync(openclawDir, { recursive: true });
  const path = channelRoutingSidecarPath(openclawDir);
  const body = {
    version: VERSION,
    updatedAt: new Date().toISOString(),
    channels: routing.channels || {},
    bindings: Array.isArray(routing.bindings) ? routing.bindings : [],
  };
  writeFileSync(path, JSON.stringify(body, null, 2), 'utf8');
  return true;
}

/**
 * Ensure config.channels / config.bindings are not lost.
 * Prefer in-memory config routing; if empty, restore from sidecar.
 * Always refresh sidecar when routing is present after merge.
 */
export function ensureChannelRoutingOnConfig(config, openclawDir = resolveOpenClawDir()) {
  if (!config || typeof config !== 'object') return { restored: false, source: null };
  const current = extractChannelRouting(config);
  if (hasChannelRouting(current)) {
    persistChannelRoutingSidecar(current, openclawDir);
    return { restored: false, source: 'config' };
  }
  const sidecar = loadChannelRoutingSidecar(openclawDir);
  if (!hasChannelRouting(sidecar)) {
    return { restored: false, source: null };
  }
  if (sidecar.channels) config.channels = structuredCloneSafe(sidecar.channels);
  if (Array.isArray(sidecar.bindings)) config.bindings = structuredCloneSafe(sidecar.bindings);
  persistChannelRoutingSidecar(extractChannelRouting(config), openclawDir);
  const wa = Object.keys(config.channels?.whatsapp?.accounts || {});
  const slack = Object.keys(config.channels?.slack?.accounts || {});
  console.log(
    '[openclaw-channel-routing] restored from sidecar whatsapp=[%s] slack=[%s] bindings=%s',
    wa.join(', ') || '-',
    slack.join(', ') || '-',
    (config.bindings || []).length
  );
  return { restored: true, source: 'sidecar' };
}

/** Standalone restore into openclaw.json (entrypoint / emergency). */
export function restoreChannelRoutingIntoOpenClawJson(opts = {}) {
  const openclawDir = opts.openclawDir || resolveOpenClawDir();
  const configPath = opts.configPath || resolveOpenClawConfigPath();
  if (!existsSync(configPath)) {
    console.warn('[openclaw-channel-routing] openclaw.json missing at', configPath);
    return { ok: false, reason: 'missing-config' };
  }
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.warn('[openclaw-channel-routing] parse failed:', e?.message || e);
    return { ok: false, reason: 'parse-failed' };
  }
  const before = hasChannelRouting(extractChannelRouting(config));
  const result = ensureChannelRoutingOnConfig(config, openclawDir);
  if (!hasChannelRouting(extractChannelRouting(config))) {
    return { ok: true, changed: false, restored: false, before };
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  return {
    ok: true,
    changed: result.restored || !before,
    restored: result.restored,
    source: result.source,
    before,
  };
}
