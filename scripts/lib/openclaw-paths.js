/**
 * Resolve OpenClaw state directory (~/.openclaw or OPENCLAW_DIR).
 * Used by bootstrap scripts so Docker (OPENCLAW_DIR=/root/.openclaw) matches bare-metal (~/.openclaw).
 */
import { join } from 'path';

export function resolveOpenClawDir() {
  if (process.env.OPENCLAW_DIR) return process.env.OPENCLAW_DIR;
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return join(home, '.openclaw');
}

export function resolveOpenClawConfigPath() {
  return process.env.OPENCLAW_CONFIG_PATH || join(resolveOpenClawDir(), 'openclaw.json');
}

export function resolveOpenClawSkillsDir() {
  return join(resolveOpenClawDir(), 'skills');
}

export function resolveOpenClawExtensionsDir() {
  return join(resolveOpenClawDir(), 'extensions');
}

export function resolveOpenClawAgentsDir() {
  return join(resolveOpenClawDir(), 'agents');
}
