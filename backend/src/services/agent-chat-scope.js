import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db/schema.js';
import { listAgentsForUser } from './users.js';
import {
  getBalaCeoAuthId,
  getDefaultCeoUserId,
  resolveCeoDataUserId,
} from './job-applicant-ceo.js';
import * as openclaw from '../gateway/openclaw.js';
import { getOpenClawDir } from '../config/openclaw-paths.js';

export function resolveChatOwnerUserId(req, body = {}) {
  if (!req?.authUser?.id) {
    const err = new Error('Authentication required');
    err.status = 401;
    throw err;
  }
  if (req.authUser.role === 'ceo') return req.authUser.id;
  if (req.authUser.role === 'admin') {
    const err = new Error('Admin must impersonate a user to access agent chat');
    err.status = 403;
    throw err;
  }
  const err = new Error('CEO role required');
  err.status = 403;
  throw err;
}

export function chatOwnerIdsForRead(authUserId) {
  const dataUserId = resolveCeoDataUserId(authUserId);
  return [...new Set([authUserId, dataUserId].filter(Boolean))];
}

export function userCanAccessAgent(authUser, agentId) {
  if (!authUser?.id || !agentId) return false;
  if (authUser.role === 'admin' && !authUser.impersonation) return false;
  const agents = listAgentsForUser(authUser.id);
  return agents.some((a) => a.id === agentId);
}

export function assertUserAgentAccess(authUser, agentId) {
  const agent = getDb().prepare('SELECT id FROM agents WHERE id = ?').get(agentId);
  if (!agent) {
    const err = new Error('Agent not found');
    err.status = 404;
    throw err;
  }
  if (!userCanAccessAgent(authUser, agentId)) {
    const err = new Error('Agent not found');
    err.status = 404;
    throw err;
  }
}

export function extractOwnerUserIdFromText(text, fallback = undefined) {
  const s = String(text || '');
  const ownerMatch = s.match(/owner_user_id:\s*(\S+)/);
  if (ownerMatch) return ownerMatch[1].replace(/^\[|\]$/g, '');

  const ceoMatch = s.match(/\[?ceo_user_id:\s*([^\]\s]+)/);
  if (ceoMatch) {
    const raw = ceoMatch[1].replace(/^\[|\]$/g, '');
    if (raw === getDefaultCeoUserId()) return getBalaCeoAuthId();
    return raw;
  }

  // Explicit fallback (including null) — callers that pass null want "no match", not "default".
  if (arguments.length >= 2) return fallback;
  return getDefaultCeoUserId();
}

export function clearOpenClawSessionForUser(agentId, openclawAgentId, ownerUserId, threadId = null) {
  const sessionUser = openclaw.sessionUserFor(agentId, ownerUserId, threadId);
  const sessionKey = openclaw.sessionKeyFor(openclawAgentId, sessionUser);
  const sessionsDir = join(getOpenClawDir(), 'agents', openclawAgentId, 'sessions');
  const sessionsJsonPath = join(sessionsDir, 'sessions.json');
  if (!existsSync(sessionsJsonPath)) return;

  try {
    const map = JSON.parse(readFileSync(sessionsJsonPath, 'utf8'));
    const entry = map[sessionKey];
    delete map[sessionKey];
    // Also clear legacy main thread key when rotating threads
    if (threadId && threadId !== 'main') {
      const mainKey = openclaw.sessionKeyFor(
        openclawAgentId,
        openclaw.sessionUserFor(agentId, ownerUserId, 'main')
      );
      delete map[mainKey];
    }
    writeFileSync(sessionsJsonPath, JSON.stringify(map, null, 2), 'utf8');

    if (!entry) return;
    const sessionId =
      typeof entry === 'string'
        ? entry.replace(/\.jsonl$/, '')
        : entry?.sessionId || entry?.id || entry?.file;
    if (!sessionId) return;

    const sessionFile = join(
      sessionsDir,
      String(sessionId).endsWith('.jsonl') ? sessionId : `${sessionId}.jsonl`
    );
    if (existsSync(sessionFile)) rmSync(sessionFile);
  } catch (_) {}
}
